import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import type { AssistantContextToken } from "../app/features/assistant/assistant.types";
import { ObjectWorkbenchContext, type ObjectWorkbenchPort } from "../app/features/objects/objectWorkbenchPort";
import { ASSET_CONTEXT_MIME } from "../app/features/object-transfer/assetContextTransfer";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createFrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";

const note: AssistantContextToken = { id: "note", label: "CicN", kind: "object", prompt: "", detail: "已固定版本",
  contextRefs: [{ objectId: "cicn", revision: "v1" }] };

function setup(resolve = vi.fn(async () => note)) {
  const api = createAgentApplicationService({ supportsObjectContext: true, resolveContext: () => ({}),
    executeCommand: () => ({ events: [], settingsChanged: false }), executeKnowledge: async () => ({ message: "已处理。" }) });
  const submit = vi.spyOn(api, "submitTurn");
  const generate = vi.fn(() => "已启动生成。");
  const attachment = { ref: note.contextRefs![0], refs: note.contextRefs, title: note.label, kind: "content.note" };
  const port = { scopeId: "local", resolveLiteasyPath: vi.fn(async () => [attachment]),
    receiveContextDrop: vi.fn(async () => [attachment]) } as unknown as ObjectWorkbenchPort;
  const view = render(<ObjectWorkbenchContext.Provider value={port}>
    <AssistantPane agentClient={createFrontendAgentClient(api)} onGenerateArtifact={generate}
      contextSuggestions={[{ id: "note", label: "CicN", trigger: "@", resolveToken: resolve },
        { id: "paper", label: "Cicada", trigger: "@", token: { ...note, id: "paper", label: "Cicada" } }]}
      selectedSetStatus={{ importedCount: 0, selectedCount: 0, selectionLocked: false }} />
  </ObjectWorkbenchContext.Provider>);
  const input = screen.getByPlaceholderText("输入你的问题或命令") as HTMLTextAreaElement;
  return { ...view, input, submit, generate, user: userEvent.setup() };
}

function placeCaret(input: HTMLTextAreaElement, value: string, caret: number) {
  fireEvent.change(input, { target: { value } });
  input.focus();
  input.setSelectionRange(caret, caret);
  fireEvent.select(input);
}

test.each(["mention", "browser", "path", "drop"])("%s inserts the name in prose and sends the same text with pinned context", async (source) => {
  const { input, user, submit, container } = setup();
  placeCaret(input, source === "mention" ? "往 @CicN 里面写入 hello" : "往 里面写入 hello", source === "mention" ? 7 : 2);
  if (source === "mention") await user.click(screen.getByRole("button", { name: /^@ CicN/ }));
  else if (source === "browser") {
    await user.click(screen.getByRole("button", { name: "添加上下文" }));
    await user.click(screen.getByRole("checkbox", { name: "选择 CicN" }));
    await user.click(screen.getByRole("button", { name: "添加所选（1）" }));
  } else if (source === "path") fireEvent.paste(input, { clipboardData: { getData: () => "liteasy://objects/cicn?scope=local" } });
  else fireEvent.drop(input, { dataTransfer: { types: [ASSET_CONTEXT_MIME], getData: (type: string) => type === ASSET_CONTEXT_MIME ? "asset" : "" } });
  await waitFor(() => expect(input).toHaveValue("往 CicN 里面写入 hello"));
  expect(container.querySelector(".assistant-input-highlight .assistant-inline-context")).toHaveTextContent("CicN");
  if (source === "browser") await user.click(screen.getAllByRole("button", { name: "返回对话" })[0]);
  await user.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("已处理。");
  expect(submit.mock.calls[0][0]).toMatchObject({ input: { message: "往 CicN 里面写入 hello" }, contextRefs: note.contextRefs });
  expect(container.querySelector(".assistant-user-message-content strong.assistant-inline-context")).toHaveTextContent("CicN");
  await user.click(screen.getByRole("button", { name: "编辑：往 CicN 里面写入 hello" }));
  expect(input).toHaveValue("往 CicN 里面写入 hello");
  expect(screen.getByRole("button", { name: "移除上下文：CicN" })).toBeInTheDocument();
});

test("batch additions preserve order at the original caret and do not duplicate attachments", async () => {
  const { input, user } = setup();
  placeCaret(input, "比较 的内容", 3);
  await user.click(screen.getByRole("button", { name: "添加上下文" }));
  await user.click(screen.getByRole("checkbox", { name: "选择 CicN" }));
  await user.click(screen.getByRole("checkbox", { name: "选择 Cicada" }));
  await user.click(screen.getByRole("button", { name: "添加所选（2）" }));
  await waitFor(() => expect(input).toHaveValue("比较 CicN Cicada 的内容"));
  // The picker remains modal for batch additions; the composer is deliberately
  // hidden from the accessibility tree until the user returns to the chat.
  await user.click(screen.getAllByRole("button", { name: "返回对话" })[0]);
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^移除上下文：/ })).toHaveLength(2));
});

test("resolving a mention retains text typed while waiting and inserts nothing on failure", async () => {
  let finish!: (token: AssistantContextToken) => void;
  const resolve = vi.fn(() => new Promise<AssistantContextToken>((done) => { finish = done; }));
  const { input, user } = setup(resolve);
  placeCaret(input, "往 @CicN 里面写入", 7);
  await user.click(screen.getByRole("button", { name: /^@ CicN/ }));
  fireEvent.change(input, { target: { value: "请往 @CicN 里面写入 hello" } });
  await act(async () => { finish(note); });
  expect(input).toHaveValue("请往 CicN 里面写入 hello");
  await user.click(screen.getByRole("button", { name: "移除上下文：CicN" }));
  expect(input).toHaveValue("请往 CicN 里面写入 hello");
  resolve.mockRejectedValueOnce(new Error("资源读取失败"));
  placeCaret(input, "往 @CicN 里面写入", 7);
  await user.click(screen.getByRole("button", { name: /^@ CicN/ }));
  await screen.findByText("资源读取失败");
  expect(input).toHaveValue("往 @CicN 里面写入");
  expect(screen.queryByRole("button", { name: "移除上下文：CicN" })).not.toBeInTheDocument();
});

test("a pending context addition never inserts its name into a different session", async () => {
  let finish!: (token: AssistantContextToken) => void;
  const { input, user } = setup(vi.fn(() => new Promise<AssistantContextToken>((done) => { finish = done; })));
  placeCaret(input, "往 @CicN 里面写入", 7);
  await user.click(screen.getByRole("button", { name: /^@ CicN/ }));
  await user.click(screen.getByRole("button", { name: "新建", exact: true }));
  await user.type(input, "另一段对话");
  await act(async () => { finish(note); });
  expect(input).toHaveValue("另一段对话");
  expect(screen.queryByRole("button", { name: "移除上下文：CicN" })).not.toBeInTheDocument();
});

test("a context name containing 薄读 never becomes a generation command, but explicit generation still works", async () => {
  const { input, user, submit, generate } = setup(vi.fn(async () => ({ ...note, label: "注意力薄读" })));
  await user.type(input, "@CicN");
  await user.click(screen.getByRole("button", { name: /^@ CicN/ }));
  await waitFor(() => expect(input).toHaveValue("注意力薄读 "));
  await user.type(input, "请解释核心方法");
  await user.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByText("已处理。");
  expect(submit.mock.calls[0][0]).toMatchObject({ input: { message: "注意力薄读 请解释核心方法" } });
  expect(generate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "编辑：注意力薄读 请解释核心方法" }));
  fireEvent.change(input, { target: { value: "根据 注意力薄读 生成 PPT" } });
  await user.click(screen.getByRole("button", { name: "更新并发送" }));
  await waitFor(() => expect(generate).toHaveBeenCalledWith("ppt", undefined, expect.stringContaining("根据 注意力薄读 生成 PPT"), note.contextRefs));
});
