import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createFrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import { createAssistantHistoryPersistence } from "../app/features/assistant/assistantHistoryPersistence";
import { ObjectWorkbenchContext, type ObjectWorkbenchPort } from "../app/features/objects/objectWorkbenchPort";
import type { ObjectRef } from "../app/features/objects/object.types";
import { makeObjectTransfer, readObjectTransfer, writeObjectTransfer } from "../app/features/object-transfer/objectTransfer";

const lockedPaper = { id: "paper-locked", title: "锁定的研究论文" };
const noteRef: ObjectRef = { objectId: "note-methods", revision: "note-revision-3" };
const paperRef: ObjectRef = { objectId: "source-paper", revision: "paper-revision-2" };

function createContextPort(capturePaperContext = vi.fn(async () => [paperRef])) {
  return {
    receiveContextDrop: vi.fn(async (transfer: DataTransfer) => {
      const packet = readObjectTransfer(transfer);
      if (!packet) throw new Error("expected a real Liteasy object transfer");
      return packet.refs.map((ref) => ({ ref, refs: [ref], title: "方法笔记", kind: "content.note" }));
    }),
    capturePaperContext
  } as unknown as ObjectWorkbenchPort;
}

async function renderRouting(options: {
  locked?: boolean;
  port?: ObjectWorkbenchPort;
  prepare?: (ids: string[]) => Promise<void>;
} = {}) {
  const executeKnowledge = vi.fn(async () => ({ message: "可以先整理资料，再规划幻灯片内容。" }));
  const api = createAgentApplicationService({
    supportsObjectContext: true,
    resolveContext: () => ({}),
    executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge
  });
  const submit = vi.spyOn(api, "submitTurn");
  const onGenerateArtifact = vi.fn(() => "产物任务已启动。");
  const history = createAssistantHistoryPersistence({ load: async () => null, save: async () => undefined });
  const rendered = render(<ObjectWorkbenchContext.Provider value={options.port ?? null}>
    <AssistantPane
      agentClient={createFrontendAgentClient(api)}
      historyPersistence={history}
      onGenerateArtifact={onGenerateArtifact}
      onPreparePapersForContext={options.prepare}
      selectedPapers={options.locked ? [lockedPaper] : []}
      selectedSetStatus={{ selectedCount: options.locked ? 1 : 0, importedCount: options.locked ? 1 : 0, selectionLocked: options.locked ?? false }}
    />
  </ObjectWorkbenchContext.Provider>);
  await waitFor(() => expect(screen.queryByText("正在恢复对话…")).not.toBeInTheDocument());
  return { ...rendered, onGenerateArtifact, submit, executeKnowledge, user: userEvent.setup() };
}

async function dropNote(container: HTMLElement) {
  const payload = new Map<string, string>();
  const transfer = {
    setData: (type: string, content: string) => payload.set(type, content),
    getData: (type: string) => payload.get(type) ?? "",
    get types() { return [...payload.keys()]; }
  } as unknown as DataTransfer;
  writeObjectTransfer(transfer, makeObjectTransfer([noteRef]));
  fireEvent.drop(container.querySelector(".assistant-pane")!, { dataTransfer: transfer });
  expect(await screen.findByRole("button", { name: "移除上下文：方法笔记" })).toBeInTheDocument();
}

test("a normal conversation request to generate PPT enters the artifact workflow with the locked papers", async () => {
  const { user, onGenerateArtifact, submit, executeKnowledge } = await renderRouting({ locked: true });
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "生成PPT");
  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(onGenerateArtifact).toHaveBeenCalledWith("ppt", [lockedPaper.id], expect.stringContaining("生成PPT")));
  expect(await screen.findByText("产物任务已启动。")).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
  expect(executeKnowledge).not.toHaveBeenCalled();
});

test.each([
  ["/制作PPT", "ppt"],
  ["/制作提纲", "tree"]
] as const)("%s accepts a dropped fixed object and retains its reference in the artifact callback", async (command, type) => {
  const { container, user, onGenerateArtifact, submit } = await renderRouting({ port: createContextPort() });
  await dropNote(container);
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), command);
  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(onGenerateArtifact).toHaveBeenCalledWith(type, undefined, expect.stringContaining(command.slice(1)), [noteRef]));
  expect(await screen.findByText("产物任务已启动。")).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
  expect(screen.queryByText(/当前命令尚不支持这些资源/)).not.toBeInTheDocument();
});

test.each([
  ["/制作PPT", "ppt"],
  ["/制作提纲", "tree"]
] as const)("%s prepares and captures locked papers before generating from mixed fixed references", async (command, type) => {
  let finishPreparation!: () => void;
  let finishCapture!: (refs: ObjectRef[]) => void;
  const prepare = vi.fn(() => new Promise<void>((resolve) => { finishPreparation = resolve; }));
  const capture = vi.fn(() => new Promise<ObjectRef[]>((resolve) => { finishCapture = resolve; }));
  const { container, user, onGenerateArtifact, submit } = await renderRouting({
    locked: true, port: createContextPort(capture), prepare
  });
  await dropNote(container);
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), command);
  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(prepare).toHaveBeenCalledWith([lockedPaper.id]));
  expect(capture).not.toHaveBeenCalled();
  expect(onGenerateArtifact).not.toHaveBeenCalled();
  await act(async () => { finishPreparation(); });
  await waitFor(() => expect(capture).toHaveBeenCalledWith([lockedPaper.id]));
  expect(onGenerateArtifact).not.toHaveBeenCalled();
  await act(async () => { finishCapture([paperRef]); });
  await waitFor(() => expect(onGenerateArtifact).toHaveBeenCalledWith(type, [lockedPaper.id], expect.stringContaining(command.slice(1)), [noteRef, paperRef]));
  expect(submit).not.toHaveBeenCalled();
});

test("an explanatory question about generating PPT stays in ordinary question answering", async () => {
  const { user, onGenerateArtifact, submit, executeKnowledge } = await renderRouting({ locked: true });
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "如何生成PPT？");
  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
    input: expect.objectContaining({ mode: "qa", message: expect.stringContaining("如何生成PPT？") })
  })));
  expect(await screen.findByText("可以先整理资料，再规划幻灯片内容。")).toBeInTheDocument();
  expect(executeKnowledge).toHaveBeenCalledTimes(1);
  expect(onGenerateArtifact).not.toHaveBeenCalled();
});

test("a pasted Liteasy Path becomes fixed object context in the public Agent request", async () => {
  const port = { ...createContextPort(), scopeId: "device" };
  port.resolveLiteasyPath = vi.fn(async () => [{ ref: noteRef, refs: [noteRef], title: "路径笔记", kind: "content.note" as const }]);
  const { user, submit } = await renderRouting({ port });
  const composer = screen.getByPlaceholderText("输入你的问题或命令");
  fireEvent.paste(composer, { clipboardData: { getData: () => "liteasy://objects/note-methods?scope=device&revision=note-revision-3" } });
  expect(await screen.findByRole("button", { name: "移除上下文：路径笔记" })).toBeInTheDocument();
  expect(composer).toHaveValue("");
  await user.type(composer, "分析这份笔记");
  await user.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
    contextRefs: [noteRef]
  })));
});

test("paper paths prepare full text before capture and keep send disabled while reading", async () => {
  const port = { ...createContextPort(), scopeId: "device" };
  port.resolveLiteasyPath = vi.fn(async () => [{ ref: paperRef, refs: [paperRef], title: "论文全文", kind: "source.document" as const }]);
  let finish!: () => void;
  const prepare = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { user } = await renderRouting({ port, prepare });
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "分析全文");
  fireEvent.paste(screen.getByPlaceholderText("输入你的问题或命令"), { clipboardData: { getData: () => "liteasy://papers/paper-locked?scope=device" } });
  await waitFor(() => expect(prepare).toHaveBeenCalledWith([lockedPaper.id]));
  expect(port.resolveLiteasyPath).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "发送" })).toBeDisabled();
  await act(async () => { finish(); });
  expect(await screen.findByRole("button", { name: "移除上下文：论文全文" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发送" })).toBeEnabled();
});

test("cross-account and missing resource paths produce no context chip", async () => {
  const port = { ...createContextPort(), scopeId: "device" };
  port.resolveLiteasyPath = vi.fn(async () => { throw new Error("原文件已删除"); });
  const { user } = await renderRouting({ port });
  await user.click(screen.getByText("通过 Liteasy Path 添加上下文"));
  const input = screen.getByRole("textbox", { name: "添加上下文的 Liteasy Path" });
  await user.type(input, "liteasy://objects/note-methods?scope=other&revision=r");
  await user.click(screen.getByRole("button", { name: "读取并加入上下文" }));
  expect(await screen.findByText(/属于其他账户/)).toBeInTheDocument();
  expect(port.resolveLiteasyPath).not.toHaveBeenCalled();
  await user.clear(input);
  await user.type(input, "liteasy://objects/note-methods?scope=device&revision=r");
  await user.click(screen.getByRole("button", { name: "读取并加入上下文" }));
  expect(await screen.findByText("原文件已删除")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^移除上下文/ })).not.toBeInTheDocument();
});
