import { useState } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { createAgentAssetService, readAgentAssetText } from "../app/features/resource-filesystem/agentAssetService";
import { liteasyPath } from "../app/features/resource-filesystem/liteasyPath";
import type { AgentAsset } from "../app/features/resource-filesystem/agentAsset.types";
import { createResourceReferenceService } from "../app/features/resource-links/resourceReferenceService";
import { ResourceReferencesContext, ReferenceSourceContext, type ResourceReferences } from "../app/features/resource-links/ResourceReferencesContext";
import { headingReference, referenceFragment, referenceHeadings, referenceLines } from "../app/features/resource-links/referenceText";
import { ReferenceContentPicker } from "../app/features/resource-links/ReferenceContentPicker";
import { MarkdownSourceEditor } from "../app/features/markdown/MarkdownSourceEditor";
import { MarkdownContent } from "../app/features/markdown/MarkdownContent";
import { ContextAssetBrowser } from "../app/features/assistant/ContextAssetBrowser";

const text = "# CicN\nintroduction\n## Title1\nfirst explanation\n### Detail\nsecond explanation\n## Title2\nnot selected";
function fixture() {
  const scope = "reference-test";
  const path = liteasyPath(scope, { kind: "external-file", mountId: "vault", path: "notes/CicN.md" });
  const source = liteasyPath(scope, { kind: "external-file", mountId: "vault", path: "notes/index.md" });
  const asset: AgentAsset = { path, title: "CicN.md", kind: "external-file", revision: "v1", capabilities: ["read", "add_context"] };
  let body = text, active = true;
  const read = vi.fn(async () => body);
  const assets = createAgentAssetService({ scopeId: scope, active: () => active, adapters: [{
    id: "notes", accepts: (value) => value.startsWith("liteasy://files/"), search: async ({ query }) => asset.title.toLowerCase().includes(query.toLowerCase()) ? [asset] : [],
    stat: async (value) => { if (value !== path) throw new Error("missing"); return { ...asset }; },
    read: async (value, options) => { if (value !== path) throw new Error("missing"); return readAgentAssetText({ ...asset }, await read(), options); },
  }] });
  const service = createResourceReferenceService({ scope, assets, active: () => active, catalog: () => [asset] });
  const capture = vi.fn(async () => ({ id: "fragment", kind: "object" as const, label: "selected", prompt: "" }));
  const refs: ResourceReferences = { service, capture, open: vi.fn(), suggestions: [{ id: "cicn", trigger: "@", label: "CicN.md", resourcePath: path, category: "笔记", token: { id: "whole", kind: "object", label: "CicN", prompt: "" } }] };
  return { refs, path, source, read, assets, change(value: string) { body = value; asset.revision = "v2"; }, deactivate() { active = false; } };
}

describe("reference sections and source lines", () => {
  test("includes descendants up to the next peer, independent of soft wraps and CRLF", () => {
    const section = referenceFragment(text.replaceAll("\n", "\r\n"), "Title1");
    expect(section).toMatchObject({ start: 3, end: 6, text: "## Title1\nfirst explanation\n### Detail\nsecond explanation" });
    expect(referenceFragment(text, "L4:6").text).toBe("first explanation\n### Detail\nsecond explanation");
    expect(referenceFragment(text, "Title2").text).toBe("## Title2\nnot selected");
  });
  test("does not treat fenced examples as headings and disambiguates duplicate headings by line", () => {
    const source = "# Main\n```md\n## Example\n```\n## Same\nfirst\n## Same\nsecond";
    const headings = referenceHeadings(source);
    expect(headings.map((h) => h.title)).toEqual(["Main", "Same", "Same"]);
    expect(() => referenceFragment(source, "Same")).toThrow("同名标题");
    expect(headingReference(source, headings[1], true).fragment).toBe("L5:6");
  });
  test("rejects invalid ranges and truncated chapters without silently including unrelated text", () => {
    for (const fragment of ["L0:3", "L3:1", "L1:999", "L1:bad"]) expect(() => referenceFragment(text, fragment)).toThrow();
    expect(() => referenceFragment(text, "Title2", false)).toThrow("尚未完整");
    expect(referenceFragment(text, "Title1", false).end).toBe(6);
    expect(() => referenceLines(text, 7, 8, false)).toThrow();
  });
  test("resolves standard relative paths and file names, rejects cross-scope and changed revisions", async () => {
    const f = fixture();
    expect((await f.refs.service.resolve("CicN#Title1", f.source)).path).toBe(f.path);
    expect((await f.refs.service.resolve("./CicN.md#L1:3", f.source)).path).toBe(f.path);
    await expect(f.refs.service.resolve("../../outside.md", f.source)).rejects.toThrow("挂载目录");
    await expect(f.refs.service.resolve(f.path.replace("reference-test", "other"))).rejects.toThrow("账号");
    const loaded = await f.refs.service.document(f.path);
    f.change("changed");
    await expect(f.refs.service.verify(loaded)).rejects.toThrow("源文件已修改");
    f.deactivate();
    await expect(f.refs.service.document(f.path)).rejects.toThrow("账号");
  });
  test("refuses ambiguous names and preserves the explicit chosen identity", async () => {
    const f = fixture();
    const duplicate = { path: liteasyPath("reference-test", { kind: "external-file", mountId: "other", path: "CicN.md" }), title: "CicN.md" };
    const service = createResourceReferenceService({ scope: "reference-test", assets: f.assets, active: () => true, catalog: () => [{ path: f.path, title: "CicN.md" }, duplicate] });
    await expect(service.resolve("CicN")).rejects.toThrow("多个同名");
    expect(service.link(duplicate, "Title1")).toBe(`${duplicate.path}#Title1|CicN#Title1`);
  });
});

describe("shared reference UI", () => {
  test("auto-pairs brackets, edits a chapter link, keeps the text and undo in the source editor", async () => {
    const f = fixture();
    function Editor() { const [value, change] = useState(""); return <MarkdownSourceEditor documentKey="note" value={value} onChange={change} />; }
    render(<ResourceReferencesContext.Provider value={f.refs}><Editor /></ResourceReferencesContext.Provider>);
    const user = userEvent.setup();
    const editor = screen.getByRole("textbox", { name: "Markdown 源码" });
    await user.type(editor, "{[}{[}");
    expect(editor).toHaveValue("[[]]");
    const field = await screen.findByRole("textbox", { name: "引用的文件或论文" });
    await user.type(field, "CicN");
    await user.click(await screen.findByRole("button", { name: "Title1 L3–6" }));
    await user.click(screen.getByRole("button", { name: "插入引用", exact: true }));
    await waitFor(() => expect(editor).toHaveValue("[[CicN#Title1]]"));
    expect(editor).toHaveFocus();
    expect((editor as HTMLTextAreaElement).selectionStart).toBe(15);
    await user.keyboard("{Control>}z{/Control}");
    expect(editor).toHaveValue("[[CicN]]");
  });
  test("the rounded plus uses the context browser and inserts a chosen line range", async () => {
    const f = fixture();
    function Editor() { const [value, change] = useState(""); return <MarkdownSourceEditor documentKey="note" value={value} onChange={change} />; }
    render(<ResourceReferencesContext.Provider value={f.refs}><Editor /></ResourceReferencesContext.Provider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "插入文件引用" }));
    await user.click(await screen.findByRole("button", { name: "浏览文件并选择引用内容" }));
    const browser = await screen.findByRole("dialog", { name: "上下文资产浏览器" });
    expect(within(browser).getByText("插入文件引用")).toBeInTheDocument();
    await user.click(within(browser).getByRole("button", { name: "预览 CicN.md" }));
    await user.click(await within(browser).findByRole("button", { name: "选择第 3 行" }));
    fireEvent.click(within(browser).getByRole("button", { name: "选择第 6 行" }), { shiftKey: true });
    await user.click(within(browser).getByRole("button", { name: "插入选中片段引用" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Markdown 源码" })).toHaveValue("[[CicN#L3:6]]"));
    expect(f.refs.capture).not.toHaveBeenCalled();
  });
  test("typing closing brackets skips the generated pair instead of duplicating it", async () => {
    const f = fixture();
    function Editor() { const [value, change] = useState(""); return <MarkdownSourceEditor documentKey="note" value={value} onChange={change} />; }
    render(<ResourceReferencesContext.Provider value={f.refs}><Editor /></ResourceReferencesContext.Provider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "插入文件引用" }));
    await user.type(await screen.findByRole("textbox", { name: "引用的文件或论文" }), "CicN]]");
    expect(screen.getByRole("textbox", { name: "Markdown 源码" })).toHaveValue("[[CicN]]");
  });
  test("AI content picker sends exactly the selected text and refuses a later source change", async () => {
    const f = fixture(), chosen = vi.fn();
    render(<ResourceReferencesContext.Provider value={f.refs}><ReferenceContentPicker path={f.path} onChoose={chosen} /></ResourceReferencesContext.Provider>);
    const user = userEvent.setup();
    const line = await screen.findByText("first explanation");
    const range = document.createRange(); range.setStart(line.firstChild!, 6); range.setEnd(line.firstChild!, 17);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent.mouseUp(line);
    await user.click(screen.getByRole("button", { name: "插入引用", exact: true }));
    expect(chosen.mock.calls[0][1]).toMatchObject({ text: "explanation", fragment: "L4:4" });
    chosen.mockClear(); f.change("# Replaced\nNo longer the same text");
    await user.click(screen.getByRole("button", { name: "插入引用", exact: true }));
    expect(await screen.findByRole("alert")).toHaveTextContent("源文件已修改");
    expect(chosen).not.toHaveBeenCalled();
  });
  test("AI browser can attach a heading through the existing guarded context callback", async () => {
    const f = fixture(), added = vi.fn();
    render(<ResourceReferencesContext.Provider value={f.refs}><ContextAssetBrowser suggestions={f.refs.suggestions} onClose={vi.fn()} onResolveContextToken={async (resolve) => { added(await resolve()); }} /></ResourceReferencesContext.Provider>);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "预览 CicN.md" }));
    await user.click(screen.getByRole("button", { name: "打开内容，选择章节或文字" }));
    await user.click(await screen.findByRole("button", { name: "Title1 L3–6" }));
    await user.click(screen.getByRole("button", { name: "将选中片段加入对话" }));
    await waitFor(() => expect(added).toHaveBeenCalledOnce());
    expect(f.refs.capture).toHaveBeenCalledWith(expect.objectContaining({ text }), expect.objectContaining({ start: 3, end: 6, text: "## Title1\nfirst explanation\n### Detail\nsecond explanation" }));
  });
  test("renders manual wiki links, headings, line embeds and standard Markdown with shared previews", async () => {
    const f = fixture();
    render(<ResourceReferencesContext.Provider value={f.refs}><ReferenceSourceContext.Provider value={f.source}>
      <MarkdownContent value={'[[CicN#Title1|章节]]\n\n![[CicN#L4:4]]\n\n[笔记](./CicN.md#Title2)\n\n`[[CicN]]`\n\n```md\n[[CicN]]\n```'} />
    </ReferenceSourceContext.Provider></ResourceReferencesContext.Provider>);
    const user = userEvent.setup();
    expect(await screen.findByText("first explanation")).toBeVisible();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    await user.hover(screen.getByRole("link", { name: "章节" }));
    const preview = await screen.findByLabelText("引用内容预览");
    expect(await within(preview).findByText("second explanation")).toBeVisible();
    expect(within(preview).queryByText("not selected")).toBeNull();
    await user.click(within(preview).getByRole("button", { name: "关闭引用预览" }));
    await user.click(screen.getByRole("link", { name: "笔记" }));
    await waitFor(() => expect(f.refs.open).toHaveBeenCalledWith(f.path));
  });
  test("does not pair wiki syntax in code or during IME composition", async () => {
    function Editor() { const [value, change] = useState("```md\n"); return <MarkdownSourceEditor documentKey="note" value={value} onChange={change} />; }
    render(<Editor />);
    const editor = screen.getByRole("textbox", { name: "Markdown 源码" });
    const user = userEvent.setup(); await user.click(editor); await user.keyboard("{Control>}{End}{/Control}{[}{[}");
    expect(editor).toHaveValue("```md\n[[");
    fireEvent.compositionStart(editor);
    fireEvent.change(editor, { target: { value: "中文[[", selectionStart: 4, selectionEnd: 4 } });
    fireEvent.compositionEnd(editor);
    expect(editor).toHaveValue("中文[[");
  });
});
