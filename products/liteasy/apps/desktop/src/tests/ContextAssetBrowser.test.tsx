import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextAssetBrowser } from "../app/features/assistant/ContextAssetBrowser";
import type { AssistantComposerSuggestion, AssistantContextToken } from "../app/features/assistant/assistant.types";

const token = (id: string): AssistantContextToken => ({ id, label: id, kind: "object", prompt: "" });
const assets: AssistantComposerSuggestion[] = [
  { id: "source", label: "注意力论文原文", trigger: "@", category: "原文", projectId: "attention", projectTitle: "注意力研究",
    description: "论文识别出的文字", readOnly: true, preview: "Attention is all you need.", token: token("source") },
  { id: "note", label: "实验记录", trigger: "@", category: "笔记", projectId: "vision", projectTitle: "视觉研究",
    description: "对比实验与观察", token: token("note") },
];

describe("ContextAssetBrowser", () => {
  it("keeps cross-project selections through filters and adds them without sending", async () => {
    const add = vi.fn();
    let completeSource!: (value: AssistantContextToken) => void;
    const source = new Promise<AssistantContextToken>((resolve) => { completeSource = resolve; });
    render(<ContextAssetBrowser suggestions={[{ ...assets[0], token: undefined, resolveToken: () => source }, assets[1]]}
      onClose={vi.fn()} onAddContextToken={add} />);
    // Initialize after Dialog so user-event preserves Keyborg's focus wrapper.
    // Slow clicks also exercise Tabster's deferred accessibility update.
    const user = userEvent.setup({ delay: 80 });
    const filters = await screen.findByRole("navigation", { name: "上下文资产筛选" });
    await user.click(within(filters).getByRole("button", { name: /注意力研究/ }));
    expect(screen.queryByRole("checkbox", { name: "选择 实验记录" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "选择 注意力论文原文" }));
    await user.click(within(filters).getByRole("button", { name: /视觉研究/ }));
    await user.click(screen.getByRole("checkbox", { name: "选择 实验记录" }));
    expect(screen.getByText("待加入 2 项")).toBeInTheDocument();
    const addButton = screen.getByRole("button", { name: "添加所选（2）" });
    await user.click(addButton);
    expect(addButton).toBeDisabled();
    expect(add).not.toHaveBeenCalled();
    await act(async () => { completeSource(token("source")); });
    // Callback completion precedes the rendered status and modal accessibility updates.
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("已添加 2 项上下文");
      expect(screen.getByRole("dialog", { name: "上下文资产浏览器" })).toBeInTheDocument();
    });
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls.map(([value]) => value.id)).toEqual(["source", "note"]);
  });

  it("searches metadata, previews on demand and does not offer fictional assets", async () => {
    const loadPreview = vi.fn(async () => ({ text: "真实识别正文", images: [{ url: "data:image/png;base64,cHJldmlldw==", label: "注意力论文原文" }] }));
    const { rerender } = render(<ContextAssetBrowser suggestions={[{ ...assets[0], loadPreview }, assets[1]]} onClose={vi.fn()} />);
    const user = userEvent.setup();
    expect(loadPreview).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: "搜索全部上下文资产" }), "注意力 原文");
    expect(screen.queryByRole("checkbox", { name: "选择 实验记录" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "选择 注意力论文原文" }));
    expect(loadPreview).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "预览 注意力论文原文" }));
    expect(await screen.findByText("真实识别正文")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "注意力论文原文" })).toHaveAttribute("src", "data:image/png;base64,cHJldmlldw==");
    expect(loadPreview).toHaveBeenCalledOnce();
    rerender(<ContextAssetBrowser suggestions={[]} onClose={vi.fn()} />);
    expect(screen.getByText("还没有可添加的资产")).toBeInTheDocument();
    expect(screen.queryByText("真实识别正文")).not.toBeInTheDocument();
  });

  it("discards late previews when selection changes and retries a failed read", async () => {
    let complete!: (value: { text: string }) => void;
    const delayed = () => new Promise<{ text: string }>((resolve) => { complete = resolve; });
    const retry = vi.fn().mockRejectedValueOnce(new Error("文件暂不可读")).mockResolvedValue({ text: "重新读取的笔记" });
    render(<ContextAssetBrowser suggestions={[{ ...assets[0], loadPreview: delayed }, { ...assets[1], loadPreview: retry }]} onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "预览 注意力论文原文" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在读取预览");
    await user.click(screen.getByRole("button", { name: "预览 实验记录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("预览暂不可用，请重试。");
    await act(async () => { complete({ text: "已切走的原文" }); });
    expect(screen.queryByText("已切走的原文")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试预览" }));
    expect(await screen.findByText("重新读取的笔记")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retains only failed selections and exposes the resolver error for a retry", async () => {
    const resolve = vi.fn().mockRejectedValueOnce(new Error("文件暂时不可用")).mockResolvedValue(token("note"));
    const add = vi.fn();
    render(<ContextAssetBrowser suggestions={[assets[0], { ...assets[1], token: undefined, resolveToken: resolve }]}
      onClose={vi.fn()} onResolveContextToken={async (read) => { add(await read()); return true; }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "选择 注意力论文原文" }));
    await user.click(screen.getByRole("checkbox", { name: "选择 实验记录" }));
    await user.click(screen.getByRole("button", { name: "添加所选（2）" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("实验记录：文件暂时不可用");
    expect(screen.getByRole("checkbox", { name: "选择 注意力论文原文" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 实验记录" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "添加所选（1）" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已添加 1 项上下文"));
    expect(add).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("discards an in-flight asset when it disappears from the current catalog", async () => {
    let complete!: (value: AssistantContextToken) => void;
    const add = vi.fn();
    const resolveToken = () => new Promise<AssistantContextToken>((resolve) => { complete = resolve; });
    const { rerender } = render(<ContextAssetBrowser suggestions={[{ ...assets[0], token: undefined, resolveToken }]}
      onClose={vi.fn()} onAddContextToken={add} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "选择 注意力论文原文" }));
    await user.click(screen.getByRole("button", { name: "添加所选（1）" }));
    rerender(<ContextAssetBrowser suggestions={[]} onClose={vi.fn()} onAddContextToken={add} />);
    await act(async () => { complete(token("source")); });
    expect(add).not.toHaveBeenCalled();
    expect(screen.getByText("待加入 1 项")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("资产或当前会话已变化");
  });

  it("creates a separate source copy and allows a note in a project that cannot yet be attached", async () => {
    const copy = vi.fn(async () => token("copy"));
    const createNote = vi.fn(async () => token("new-note"));
    const add = vi.fn();
    render(<ContextAssetBrowser suggestions={[{ ...assets[0], createEditableCopy: copy }, {
      id: "project", label: "空项目", category: "项目", trigger: "@", unavailableReason: "项目暂无可读取内容", createNote,
    }]} onClose={vi.fn()} onAddContextToken={add} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "预览 注意力论文原文" }));
    await user.click(screen.getByRole("button", { name: "创建可编辑副本" }));
    expect(await screen.findByRole("status")).toHaveTextContent("已创建可编辑副本并加入上下文");
    expect(add).toHaveBeenCalledWith(token("copy"));
    expect(assets[0].preview).toBe("Attention is all you need.");
    await user.click(screen.getByRole("button", { name: "预览 空项目" }));
    expect(screen.getByRole("checkbox", { name: "选择 空项目" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "新建项目笔记" }), "进一步核对实验结果");
    await user.click(screen.getByRole("button", { name: "保存并加入上下文" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已保存项目笔记并加入上下文"));
    expect(createNote).toHaveBeenCalledWith("进一步核对实验结果");
    expect(add).toHaveBeenCalledWith(token("new-note"));
  });
});

it("finds an editable note by part of its name and adds it through the single batch action", async () => {
  const add = vi.fn();
  const close = vi.fn();
  const resolve = vi.fn(async () => token("CicN"));
  render(<ContextAssetBrowser suggestions={[{ id: "cicn", trigger: "@", label: "CicN", category: "笔记",
    readOnly: false, description: "Cicada 论文笔记", resolveToken: resolve }, ...assets]}
    onClose={close} onAddContextToken={add} />);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox", { name: "搜索全部上下文资产" }), "cic");
  expect(screen.getByRole("button", { name: "预览 CicN" })).toBeVisible();
  expect(resolve).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "预览 CicN" }));
  expect(screen.getByText("可编辑")).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "选择此资产" }));
  await user.click(screen.getByRole("button", { name: "添加所选（1）" }));
  await waitFor(() => expect(add).toHaveBeenCalledWith(token("CicN")));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("已添加 1 项上下文");
});

it("opens with a compact list and no empty details pane, and selects all filtered pages", async () => {
  const read = vi.fn();
  const many = Array.from({ length: 75 }, (_, index) => ({ ...assets[0], id: `image-${index}`, label: `图 ${index}`, category: "图片", loadPreview: read, token: token(`image-${index}`) }));
  render(<ContextAssetBrowser suggestions={many} onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  expect(screen.queryByRole("complementary", { name: "资产预览" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "列表" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("checkbox", { name: "全选筛选结果" }));
  expect(screen.getByText("待加入 75 项")).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
});

it("keeps unavailable selected items reviewable outside the current query", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<ContextAssetBrowser suggestions={assets} onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  await user.click(screen.getByRole("checkbox", { name: "选择 实验记录" }));
  await user.type(screen.getByRole("textbox", { name: "搜索全部上下文资产" }), "没有匹配");
  rerender(<ContextAssetBrowser suggestions={assets.map((asset) => asset.id === assets[1].id ? { ...asset, unavailableReason: "来源已断开" } : asset)} onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  await user.click(screen.getByRole("checkbox", { name: "只看已选" }));
  expect(screen.queryByRole("checkbox", { name: "选择 实验记录" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看待选" }));
  expect(within(screen.getByLabelText("全部待选资产")).getByRole("checkbox", { name: "实验记录" })).toBeChecked();
  expect(screen.getAllByText("来源已断开").length).toBeGreaterThan(0);
});

it("resolves aliases before merging and keeps different fixed versions", async () => {
  const add = vi.fn();
  const reference = (revision: string): AssistantContextToken => ({ id: crypto.randomUUID(), label: "同名", kind: "object", prompt: "", contextRefs: [{ objectId: "canonical", revision }] });
  render(<ContextAssetBrowser suggestions={["first", "alias", "revision"].map((id, index) => ({ id, trigger: "@", label: id, category: "笔记", resolveToken: async () => reference(index === 2 ? "r2" : "r1") }))} onClose={vi.fn()} onAddContextToken={add} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("checkbox", { name: "全选筛选结果" }));
  await user.click(screen.getByRole("button", { name: "添加所选（3）" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已添加 2 项上下文"));
  expect(add.mock.calls.map(([value]) => value.contextRefs)).toEqual([[{ objectId: "canonical", revision: "r1" }], [{ objectId: "canonical", revision: "r2" }]]);
  expect(screen.getByText("待加入 0 项")).toBeInTheDocument();
});

it("group select includes matching leaves only, leaving hidden members untouched", async () => {
  const suggestions = [{ ...assets[0], searchMetadata: { tags: ["keep"] } }, { ...assets[1], projectId: assets[0].projectId, projectTitle: assets[0].projectTitle, searchMetadata: { tags: ["hidden"] } }];
  render(<ContextAssetBrowser suggestions={suggestions} initialQuery="tag:keep" onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "资料分组" }));
  await user.click(screen.getByRole("option", { name: "按项目" }));
  await user.click(screen.getByRole("checkbox", { name: "全选 注意力研究 的筛选结果" }));
  expect(screen.getByText("待加入 1 项")).toBeInTheDocument();
  await user.clear(screen.getByRole("textbox", { name: "搜索全部上下文资产" }));
  expect(screen.getByRole("checkbox", { name: "选择 实验记录" })).not.toBeChecked();
});

it("extends a Shift selection through the current sorted visible rows", async () => {
  render(<ContextAssetBrowser suggestions={["C", "A", "B"].map((label) => ({ id: label, label, trigger: "@", category: "笔记", token: token(label) }))} onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("checkbox", { name: "选择 A", exact: true }));
  await user.keyboard("{Shift>}");
  await user.click(screen.getByRole("checkbox", { name: "选择 C", exact: true }));
  await user.keyboard("{/Shift}");
  expect(screen.getByRole("checkbox", { name: "选择 B", exact: true })).toBeChecked();
  expect(screen.getByText("待加入 3 项")).toBeInTheDocument();
});

it("restores query, grouping and sort within an account without carrying them to another account", async () => {
  const user = userEvent.setup();
  const first = assets.map((asset) => ({ ...asset, scopeId: "catalog-preferences-one" }));
  const second = assets.map((asset) => ({ ...asset, scopeId: "catalog-preferences-two" }));
  localStorage.removeItem("liteasy:context-browser:catalog-preferences-one");
  localStorage.removeItem("liteasy:context-browser:catalog-preferences-two");
  const { rerender, unmount } = render(<ContextAssetBrowser suggestions={first} onClose={vi.fn()} />);
  await user.type(screen.getByRole("textbox", { name: "搜索全部上下文资产" }), "注意力");
  await user.click(screen.getByRole("combobox", { name: "资料分组" }));
  await user.click(screen.getByRole("option", { name: "按项目" }));
  await user.click(screen.getByRole("combobox", { name: "资料排序" }));
  await user.click(screen.getByRole("option", { name: "最近修改" }));
  rerender(<ContextAssetBrowser suggestions={second} onClose={vi.fn()} />);
  expect(screen.getByRole("textbox", { name: "搜索全部上下文资产" })).toHaveValue("");
  unmount();
  render(<ContextAssetBrowser suggestions={first} onClose={vi.fn()} />);
  expect(screen.getByRole("textbox", { name: "搜索全部上下文资产" })).toHaveValue("注意力");
  expect(screen.getByRole("combobox", { name: "资料分组" })).toHaveTextContent("按项目");
  expect(screen.getByRole("combobox", { name: "资料排序" })).toHaveTextContent("最近修改");
});

beforeEach(() => { for (const key of Object.keys(localStorage)) if (key.startsWith("liteasy:context-picker:")) localStorage.removeItem(key); });

test("restored missing selection and legacy errors never expose machine IDs or old titles", async () => {
  const { draftStateKey } = await import("../app/features/context-picker/pickerState");
  const key = draftStateKey("local", "library", "context", "lost-assets");
  localStorage.setItem(key, JSON.stringify({ schemaVersion: 1,
    intents: [{ id: "old-selection", catalogRevision: "old", policy: "items", exclusions: [], members: [{ id: "internal-asset-secret" }] }],
    receipts: {}, errors: { "0": "internal-asset-secret：资产已不可用" } }));
  const view = render(<ContextAssetBrowser suggestions={[]} targetDraftId="lost-assets" onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  expect(screen.queryByText(/internal-asset-secret/)).not.toBeInTheDocument();
  expect(screen.getByText("上次添加的部分资料未成功，请核对所选资料后重试。")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: /加入所选|添加所选/ }));
  expect(screen.getByText("所选资料已不可用，请重新选择。")).toBeVisible();
  view.unmount();
  render(<ContextAssetBrowser suggestions={[]} targetDraftId="lost-assets" onClose={vi.fn()} onAddContextToken={vi.fn()} />);
  expect(screen.queryByText(/internal-asset-secret/)).not.toBeInTheDocument();
  expect(screen.getByText("所选资料已不可用，请重新选择。")).toBeVisible();
});
