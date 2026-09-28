import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();
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
    await user.type(screen.getByRole("textbox", { name: "搜索全部上下文资产" }), "注意力 原文 只读");
    expect(screen.queryByRole("checkbox", { name: "选择 实验记录" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "选择 注意力论文原文" }));
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
    await user.click(screen.getByRole("checkbox", { name: "选择 注意力论文原文" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在读取预览");
    await user.click(screen.getByRole("checkbox", { name: "选择 实验记录" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("文件暂不可读");
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
    expect(screen.getByText("已选 0 项")).toBeInTheDocument();
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

it("finds an editable note by part of its name and adds it directly from its preview", async () => {
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
  expect(screen.getAllByText("可编辑")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "加入对话" }));
  await waitFor(() => expect(add).toHaveBeenCalledWith(token("CicN")));
  expect(close).toHaveBeenCalledOnce();
});
