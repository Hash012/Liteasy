import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AssistantSessionController } from "../app/controllers/assistant/AssistantSessionController";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createFrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";
import { createAssistantHistoryPersistence } from "../app/features/assistant/assistantHistoryPersistence";
import { ObjectWorkbenchContext } from "../app/features/objects/objectWorkbenchPort";
import type { FrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";

const props = { onGenerateArtifact: () => "unused", selectedSetStatus: { importedCount: 0, selectedCount: 0, selectionLocked: false } };

test("A continues streaming while B is selected; background completion preserves B's draft and focus", async () => {
  const gates = new Map<string, () => void>();
  const api = createAgentApplicationService({ executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: async (input) => {
      await new Promise<void>((resolve) => { gates.set(input.request.input.message.split("\n")[0], resolve); });
      input.reportDelta("only the original conversation"); return { message: `answer:${input.request.input.message.split("\n")[0]}` };
    } });
  const user = userEvent.setup();
  render(<AssistantSessionController {...props} agentClient={createFrontendAgentClient(api)} />);
  const composer = screen.getByPlaceholderText("输入你的问题或命令");
  await user.type(composer, "question A"); await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(gates.has("question A")).toBe(true));
  await user.click(screen.getByRole("button", { name: "新建", exact: true }));
  await user.type(composer, "B's unsent draft");
  const focus = document.activeElement;
  await act(async () => { gates.get("question A")!(); });
  expect(composer).toHaveValue("B's unsent draft"); expect(document.activeElement).toBe(focus);
  expect(screen.queryByText("answer:question A")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "历史", exact: true }));
  await user.click(screen.getByRole("button", { name: "打开会话：question A" }));
  expect(await screen.findByText("answer:question A")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "历史", exact: true }));
  await user.click(screen.getByRole("button", { name: "打开会话：新对话" }));
  expect(composer).toHaveValue("B's unsent draft");
});

test("a workbench task never changes the conversation, caret, attachment or focus", async () => {
  const user = userEvent.setup();
  const view = render(<AssistantSessionController {...props} />);
  const composer = screen.getByPlaceholderText("输入你的问题或命令") as HTMLTextAreaElement;
  await user.type(composer, "draft preserved"); composer.setSelectionRange(2, 8);
  view.rerender(<AssistantSessionController {...props} artifactTasks={[{ id: "tree-1", type: "tree", status: "running", stage: "retrieving_evidence", message: "working", progress: 10,
    origin: { kind: "workflow_entry", entryPoint: "ai_workbench", initiatedBy: { type: "user", id: "local" } } }]} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "任务 1" })).toBeInTheDocument());
  expect(screen.getByLabelText("当前会话")).toHaveAttribute("data-session-kind", "conversation");
  expect(composer).toHaveValue("draft preserved"); expect(composer.selectionStart).toBe(2); expect(composer.selectionEnd).toBe(8);
  expect(composer).toHaveFocus(); expect(screen.queryByText("working")).not.toBeInTheDocument();
});

test("failed send commit never dispatches the Agent and leaves the original input editable", async () => {
  let fail = false;
  const persistence = createAssistantHistoryPersistence({ load: async () => null, save: async () => { if (fail) throw new Error("disk full"); } });
  const send = vi.fn();
  const user = userEvent.setup();
  render(<AssistantSessionController {...props} historyPersistence={persistence} agentClient={{ send } as never} />);
  await waitFor(() => expect(screen.queryByText("正在恢复对话…")).not.toBeInTheDocument());
  const composer = screen.getByPlaceholderText("输入你的问题或命令");
  await user.type(composer, "do not dispatch"); fail = true;
  await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(send).not.toHaveBeenCalled(); expect(composer).toHaveValue("do not dispatch");
  expect(screen.queryByLabelText("你的消息")).not.toBeInTheDocument();
  fail = false;
  fireEvent.blur(window); await act(async () => { await persistence.flush(); });
});

test("result discussion reuses one conversation and freezes the original result revision across later edits", async () => {
  const ref = { objectId: "result-tree", revision: "r1" };
  const resolve = vi.fn(async () => [{ ref, refs: [ref], title: "saved tree", kind: "artifact.document" }]);
  const send = vi.fn(async (input) => ({ ok: true, data: { apiVersion: "liteasy.agent/v1", createdAt: "now", status: "completed", input,
    idempotencyKey: "fixture", runId: `run-${send.mock.calls.length}`, sessionId: "runtime", events: [{ apiVersion: "liteasy.agent/v1", emittedAt: "now", type: "assistant.message", message: `answer-${send.mock.calls.length}`, sequence: 1, eventId: `event-${send.mock.calls.length}`, runId: `run-${send.mock.calls.length}`, sessionId: "runtime" }] } }));
  const client = { send, subscribe: () => () => {}, createSessionClient: vi.fn(() => client) } as unknown as FrontendAgentClient;
  const task = { id: "tree", artifactId: "artifact-tree", type: "tree" as const, status: "completed" as const, stage: "completed" as const, message: "saved", progress: 100 };
  const shared = { ...props, agentClient: client, artifactTasks: [task] };
  const view = render(<ObjectWorkbenchContext.Provider value={{ scopeId: "local", resolveLiteasyPath: resolve } as never}>
    <AssistantSessionController {...shared} artifactSessionOpenRequest={{ requestId: "one", taskId: task.id }} />
  </ObjectWorkbenchContext.Provider>);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "围绕此结果提问" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "why this result?");
  await user.click(screen.getByRole("button", { name: "发送", exact: true })); await screen.findByText("answer-1");
  expect(send.mock.calls[0][1]).toMatchObject({ contextRefs: [ref] });
  resolve.mockImplementation(async () => [{ ref: { ...ref, revision: "r2" }, refs: [{ ...ref, revision: "r2" }], title: "edited tree", kind: "artifact.document" }]);
  view.rerender(<ObjectWorkbenchContext.Provider value={{ scopeId: "local", resolveLiteasyPath: resolve } as never}>
    <AssistantSessionController {...shared} artifactSessionOpenRequest={{ requestId: "two", taskId: task.id }} />
  </ObjectWorkbenchContext.Provider>);
  await user.click(await screen.findByRole("button", { name: "围绕此结果提问" }));
  expect(screen.getByText("answer-1")).toBeInTheDocument();
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "continue");
  await user.click(screen.getByRole("button", { name: "发送", exact: true })); await screen.findByText("answer-2");
  expect(send.mock.calls[1][1]).toMatchObject({ contextRefs: [ref] }); expect(resolve).toHaveBeenCalledTimes(1);
  expect(client.createSessionClient).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "历史", exact: true }));
  const list = screen.getByLabelText("历史会话面板");
  expect(within(list).getAllByRole("button", { name: /会话：why this result/ })).toHaveLength(1);
});

test("editing an earlier question keeps the original discussion and excludes its later turns from the new branch prompt", async () => {
  const histories: unknown[] = [];
  const api = createAgentApplicationService({ executeCommand: () => ({ events: [], settingsChanged: false }), executeKnowledge: (input) => {
    histories.push(input.conversationHistory); return { message: `reply:${input.request.input.message.split("\n")[0]}` };
  } });
  const user = userEvent.setup();
  render(<AssistantSessionController {...props} agentClient={createFrontendAgentClient(api)} />);
  const composer = screen.getByPlaceholderText("输入你的问题或命令");
  await user.type(composer, "original question"); await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  await screen.findByText("reply:original question");
  await user.type(composer, "later question"); await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  await screen.findByText("reply:later question");
  await user.click(screen.getByRole("button", { name: "编辑：original question" }));
  await user.clear(composer); await user.type(composer, "edited question");
  await user.click(screen.getByRole("button", { name: "更新并发送", exact: true }));
  await screen.findByText("reply:edited question");
  expect(histories.at(-1)).toEqual([]);
  expect(screen.queryByText("reply:later question")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "历史", exact: true }));
  await user.click(screen.getByRole("button", { name: "打开会话：original question" }));
  expect(await screen.findByText("reply:later question")).toBeInTheDocument();
  expect(screen.getByText("reply:original question")).toBeInTheDocument();
});

test("stopping A by its run id leaves the accepted run in B active", async () => {
  const gates = new Map<string, () => void>();
  const signals = new Map<string, AbortSignal>();
  const api = createAgentApplicationService({ executeCommand: () => ({ events: [], settingsChanged: false }), executeKnowledge: async (input) => {
    const question = input.request.input.message.split("\n")[0]; signals.set(question, input.signal);
    await new Promise<void>((resolve) => { gates.set(question, resolve); input.signal.addEventListener("abort", () => resolve(), { once: true }); });
    return { message: `finished:${question}` };
  } });
  const cancel = vi.spyOn(api, "cancelRun");
  const user = userEvent.setup();
  render(<AssistantSessionController {...props} agentClient={createFrontendAgentClient(api)} />);
  const composer = screen.getByPlaceholderText("输入你的问题或命令");
  await user.type(composer, "run A"); await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(signals.has("run A")).toBe(true));
  await user.click(screen.getByRole("button", { name: "新建", exact: true }));
  await user.type(composer, "run B"); await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(signals.has("run B")).toBe(true));
  await user.click(screen.getByRole("button", { name: "历史", exact: true }));
  await user.click(screen.getByRole("button", { name: "打开会话：run A" }));
  await user.click(screen.getByRole("button", { name: "终止", exact: true }));
  await waitFor(() => expect(signals.get("run A")?.aborted).toBe(true));
  expect(signals.get("run B")?.aborted).toBe(false); expect(cancel).toHaveBeenCalledTimes(1);
  await act(async () => { gates.get("run B")!(); });
  await user.click(screen.getByRole("button", { name: "历史", exact: true }));
  await user.click(screen.getByRole("button", { name: "打开会话：run B" }));
  expect(await screen.findByText("finished:run B")).toBeInTheDocument();
});

test("continuous streaming commits partial output without waiting for a pause in tokens", async () => {
  vi.useFakeTimers();
  try {
    let delta!: (value: string) => void;
    let finish!: () => void;
    const save = vi.fn(async () => {});
    const persistence = createAssistantHistoryPersistence({ load: async () => null, save });
    const api = createAgentApplicationService({ executeCommand: () => ({ events: [], settingsChanged: false }), executeKnowledge: async (input) => {
      delta = input.reportDelta;
      await new Promise<void>((resolve) => { finish = resolve; }); return { message: "complete" };
    } });
    render(<AssistantSessionController {...props} historyPersistence={persistence} agentClient={createFrontendAgentClient(api)} />);
    await act(async () => {});
    fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), { target: { value: "stream" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "发送", exact: true })); });
    expect(delta).toBeTypeOf("function");
    save.mockClear();
    for (let index = 0; index < 20; index++) {
      await act(async () => { delta("streamed fragment "); await vi.advanceTimersByTimeAsync(20); });
    }
    expect(save.mock.calls.some(([snapshot]) => snapshot.sessions.some((session: { messages: Array<{ content: string }> }) => session.messages.some((message) => message.content.includes("streamed fragment"))))).toBe(true);
    expect(screen.getByRole("button", { name: "终止", exact: true })).toBeInTheDocument();
    await act(async () => { finish(); });
  } finally { vi.useRealTimers(); }
});

test("A02-04 navigating home and archiving a running conversation retain its live execution", async () => {
  let release!: () => void;
  let signal!: AbortSignal;
  const api = createAgentApplicationService({ executeCommand: () => ({ events: [], settingsChanged: false }), executeKnowledge: async (input) => {
    signal = input.signal;
    await new Promise<void>((resolve) => { release = resolve; });
    return { message: "归档后仍完成" };
  } });
  const cancel = vi.spyOn(api, "cancelRun");
  const user = userEvent.setup();
  render(<AssistantSessionController {...props} agentClient={createFrontendAgentClient(api)} />);
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "归档中的任务");
  await user.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(release).toBeTypeOf("function"));
  await user.click(screen.getByRole("button", { name: "首页", exact: true }));
  await user.click(screen.getByRole("button", { name: "历史", exact: true }));
  await user.click(screen.getByRole("button", { name: "管理 归档中的任务" }));
  await user.click(screen.getByRole("menuitem", { name: "归档并保留运行" }));
  expect(signal.aborted).toBe(false);
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => { release(); });
  await user.click(screen.getByRole("checkbox", { name: "查看归档" }));
  await user.click(screen.getByRole("button", { name: "打开会话：归档中的任务" }));
  expect(await screen.findByText("归档后仍完成")).toBeInTheDocument();
  expect(cancel).not.toHaveBeenCalled();
});
