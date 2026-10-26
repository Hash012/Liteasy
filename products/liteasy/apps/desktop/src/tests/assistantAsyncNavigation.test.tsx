import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AssistantSessionController } from "../app/controllers/assistant/AssistantSessionController";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createFrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";
import { ObjectWorkbenchContext } from "../app/features/objects/objectWorkbenchPort";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { createAssistantHistoryPersistence, type AssistantHistorySnapshot } from "../app/features/assistant/assistantHistoryPersistence";
import { createAssistantSession, type AssistantSessionHistoryItem } from "../app/features/assistant/assistantSessionHistory";
import type { AssistantComposerSuggestion } from "../app/features/assistant/assistant.types";
import { mockFocusLayout } from "./fixtures/mockFocusLayout";

const props = { onGenerateArtifact: () => "", selectedSetStatus: { selectedCount: 0, importedCount: 0, selectionLocked: false } };
const emptyDraft = () => ({ input: "", tokens: [], readerContexts: [] });
const fixture = (): AssistantHistorySnapshot => ({
  version: "liteasy.assistant-history/v1", activeSessionId: "initial", sessions: [{
    ...createAssistantSession({ id: "initial", mode: "qa" }), title: "Initial session", titleSource: "user", titleVersion: 1,
    messages: [{ id: "u", role: "user", content: "Old question" }, { id: "a", role: "assistant", content: "Old answer" }]
  }], draft: emptyDraft()
});
const extra: AssistantComposerSuggestion = { id: "extra", trigger: "@", label: "Extra context",
  token: { id: "extra", kind: "object", label: "Extra context", prompt: "Extra facts" } };
let restore: () => void;
beforeEach(() => { restore = mockFocusLayout(); });
afterEach(() => { restore(); localStorage.clear(); vi.restoreAllMocks(); });

function delayedSend() {
  let release!: () => void;
  let reject!: (error: Error) => void;
  let blocked = true;
  const writes: AssistantHistorySnapshot[] = [];
  const persistence = createAssistantHistoryPersistence({ load: async () => fixture(), save: async snapshot => {
    writes.push(structuredClone(snapshot));
    if (blocked && snapshot.sessions.some(session => session.outbox?.some(entry => entry.state === "pending"))) {
      await new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
    }
  } });
  return { persistence, writes, waiting: () => typeof release === "function",
    finish(error?: Error) { blocked = false; if (error) reject(error); else release(); } };
}

test("a persisted send keeps newer text, attached context and composer undo", async () => {
  const delayed = delayedSend();
  const mounted = render(<AssistantSessionController {...props} contextSuggestions={[extra]} historyPersistence={delayed.persistence} />);
  await screen.findByText("Old answer");
  const input = screen.getByPlaceholderText("输入你的问题或命令");
  fireEvent.change(input, { target: { value: "First submitted message" } });
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(delayed.waiting()).toBe(true));
  expect(delayed.writes.find(snapshot => snapshot.sessions.some(session => session.outbox?.length))?.draft.input).toBe("");
  fireEvent.change(input, { target: { value: "Second draft @Extra" } });
  fireEvent.click(screen.getByRole("button", { name: /@ Extra context/ }));
  const nextDraft = (input as HTMLTextAreaElement).value;
  expect(nextDraft).toContain("Second draft Extra context");
  await act(async () => { delayed.finish(); });
  expect(input).toHaveValue(nextDraft);
  expect(screen.getByRole("button", { name: "预览上下文：Extra context" })).toBeInTheDocument();
  fireEvent.keyDown(input, { key: "z", ctrlKey: true });
  expect(input).toHaveValue("Second draft @Extra");
  expect(screen.queryByRole("button", { name: "预览上下文：Extra context" })).not.toBeInTheDocument();
  mounted.unmount();
});

test("an unchanged submitted draft clears once its save succeeds", async () => {
  const delayed = delayedSend();
  const mounted = render(<AssistantSessionController {...props} historyPersistence={delayed.persistence} />);
  await screen.findByText("Old answer");
  const input = screen.getByPlaceholderText("输入你的问题或命令");
  fireEvent.change(input, { target: { value: "First submitted message" } });
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(delayed.waiting()).toBe(true));
  await act(async () => { delayed.finish(); });
  expect(input).toHaveValue("");
  mounted.unmount();
});

test("an embedded model completing its reply keeps the next question already being typed", async () => {
  let complete!: () => void;
  const gate = new Promise<void>(resolve => { complete = resolve; });
  const settingsStore = createSettingsStore();
  settingsStore.apply({ intent: "update_setting", target: "models.cloud_proxy_endpoint", value: "https://liteasy.example.com/model-proxy" });
  const modelTransport = vi.fn(async () => ({ ok: true, status: 200, json: async () => {
    await gate;
    return { answer: "Embedded reply", execution: { backend: "dev_cloud", mode: "live", provider: "openai" } };
  } }));
  const mounted = render(<AssistantSessionController {...props} settingsStore={settingsStore} modelTransport={modelTransport} />);
  const input = screen.getByPlaceholderText("输入你的问题或命令");
  fireEvent.change(input, { target: { value: "First question" } });
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(modelTransport).toHaveBeenCalled());
  fireEvent.change(input, { target: { value: "Next question" } });
  await act(async () => { complete(); });
  await screen.findByText("Embedded reply");
  expect(input).toHaveValue("Next question");
  mounted.unmount();
});

test("editing back to the submitted text still preserves the new draft and its undo", async () => {
  const delayed = delayedSend();
  const mounted = render(<AssistantSessionController {...props} historyPersistence={delayed.persistence} />);
  await screen.findByText("Old answer");
  const input = screen.getByPlaceholderText("输入你的问题或命令");
  fireEvent.change(input, { target: { value: "Same text" } });
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(delayed.waiting()).toBe(true));
  fireEvent.change(input, { target: { value: "Changed text" } });
  fireEvent.change(input, { target: { value: "Same text" } });
  await act(async () => { delayed.finish(); });
  expect(input).toHaveValue("Same text");
  fireEvent.keyDown(input, { key: "z", ctrlKey: true });
  expect(input).toHaveValue("Changed text");
  mounted.unmount();
});

test("a failed send preserves later edits and their undo instead of restoring the submitted draft", async () => {
  const delayed = delayedSend();
  const mounted = render(<AssistantSessionController {...props} historyPersistence={delayed.persistence} />);
  await screen.findByText("Old answer");
  const input = screen.getByPlaceholderText("输入你的问题或命令");
  fireEvent.change(input, { target: { value: "First submitted message" } });
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(delayed.waiting()).toBe(true));
  fireEvent.change(input, { target: { value: "Second unsent draft" } });
  await act(async () => { delayed.finish(new Error("disk unavailable")); });
  expect(input).toHaveValue("Second unsent draft");
  expect(screen.queryByText("First submitted message")).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: "z", ctrlKey: true });
  expect(input).toHaveValue("First submitted message");
  mounted.unmount();
});

test("a failed edited-question send keeps the unsaved question in its new branch", async () => {
  const delayed = delayedSend();
  const mounted = render(<AssistantSessionController {...props} historyPersistence={delayed.persistence} />);
  await screen.findByText("Old answer");
  fireEvent.click(screen.getByRole("button", { name: "编辑消息", exact: true }));
  const input = screen.getByPlaceholderText("输入你的问题或命令");
  fireEvent.change(input, { target: { value: "Edited question" } });
  fireEvent.click(screen.getByRole("button", { name: "更新并发送", exact: true }));
  await waitFor(() => expect(delayed.waiting()).toBe(true));
  await act(async () => { delayed.finish(new Error("disk unavailable")); });
  expect(input).toHaveValue("Edited question");
  expect(screen.queryByLabelText("你的消息")).not.toBeInTheDocument();
  mounted.unmount();
});

test.each([false, true])("regeneration preserves a draft typed while its save waits (save fails: %s)", async fail => {
  const delayed = delayedSend();
  const mounted = render(<AssistantSessionController {...props} historyPersistence={delayed.persistence} />);
  await screen.findByText("Old answer");
  fireEvent.click(screen.getByRole("button", { name: "重新生成回复", exact: true }));
  await waitFor(() => expect(delayed.waiting()).toBe(true));
  const input = screen.getByPlaceholderText("输入你的问题或命令");
  fireEvent.change(input, { target: { value: "Unrelated next question" } });
  await act(async () => { delayed.finish(fail ? new Error("disk unavailable") : undefined); });
  expect(input).toHaveValue("Unrelated next question");
  mounted.unmount();
});

test.each([false, true])("send completion preserves another conversation and its draft (save fails: %s)", async fail => {
  const delayed = delayedSend();
  const activeChanged = vi.fn();
  const api = createAgentApplicationService({ executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: () => ({ message: "First conversation reply" }) });
  const mounted = render(<AssistantSessionController {...props} agentClient={createFrontendAgentClient(api)}
    onActiveSessionChange={activeChanged} historyPersistence={delayed.persistence} />);
  await screen.findByText("Old answer");
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), { target: { value: "First submitted message" } });
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  await waitFor(() => expect(delayed.waiting()).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "首页", exact: true }));
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), { target: { value: "Other conversation draft" } });
  const otherSessionId = activeChanged.mock.calls.at(-1)![0].id;
  await act(async () => { delayed.finish(fail ? new Error("disk unavailable") : undefined); });
  expect(activeChanged.mock.calls.at(-1)![0].id).toBe(otherSessionId);
  expect(screen.getByLabelText("助手首页")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("Other conversation draft");
  expect(screen.queryByText("First conversation reply")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "首页", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "历史", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "打开会话：新对话", exact: true }));
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("Other conversation draft");
  fireEvent.click(screen.getByRole("button", { name: "历史", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "打开会话：Initial session", exact: true }));
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue(fail ? "First submitted message" : "");
  if (!fail) expect(screen.getByText("First conversation reply")).toBeInTheDocument();
  mounted.unmount();
});

test("navigating during complete-context validation does not send into the next conversation", async () => {
  let complete!: () => void;
  const validate = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const send = vi.fn();
  const persistence = createAssistantHistoryPersistence({ load: async () => fixture(), save: async () => {} });
  const mounted = render(<ObjectWorkbenchContext.Provider value={{ scopeId: "local", validateCompleteContext: validate } as never}>
    <AssistantSessionController {...props} historyPersistence={persistence} agentClient={{ send } as never}
      contextSuggestions={[{ ...extra, token: { ...extra.token!, requireCompleteContext: true } }]} />
  </ObjectWorkbenchContext.Provider>);
  await screen.findByText("Old answer");
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), { target: { value: "Question @Extra" } });
  fireEvent.click(screen.getByRole("button", { name: /@ Extra context/ }));
  fireEvent.click(screen.getByRole("button", { name: "发送", exact: true }));
  expect(validate).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "首页", exact: true }));
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), { target: { value: "Next conversation draft" } });
  await act(async () => { complete(); });
  expect(send).not.toHaveBeenCalled();
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("Next conversation draft");
  expect(screen.getByLabelText("助手首页")).toBeInTheDocument();
  mounted.unmount();
});

function delayedHistory() {
  const initial = fixture();
  for (const id of ["A", "B"]) initial.sessions.push({ ...createAssistantSession({ id, mode: "qa" }), title: `Session ${id}`, titleSource: "user", titleVersion: 1, messages: [], messagesLoaded: false, messageCount: 2 });
  const releases = new Map<string, (value: AssistantSessionHistoryItem) => void>();
  const persistence = createAssistantHistoryPersistence({ load: async () => initial, save: async () => {} });
  persistence.loadSession = vi.fn((id: string) => new Promise(resolve => { releases.set(id, resolve); }));
  return { persistence, releases, finish(id: string) {
    releases.get(id)!({ ...initial.sessions.find(session => session.id === id)!, messagesLoaded: true, draft: emptyDraft(), messages: [
      { id: `${id}-u`, role: "user", content: `Question ${id}` }, { id: `${id}-a`, role: "assistant", content: `Answer ${id}` }
    ] });
  } };
}

test("the latest clicked history conversation wins when bodies load out of order", async () => {
  const delayed = delayedHistory();
  const mounted = render(<AssistantSessionController {...props} historyPersistence={delayed.persistence} />);
  await screen.findByText("Old answer");
  fireEvent.click(screen.getByRole("button", { name: "历史", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "打开会话：Session A", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "打开会话：Session B", exact: true }));
  expect([...delayed.releases.keys()]).toEqual(["A", "B"]);
  await act(async () => { delayed.finish("B"); });
  expect(screen.getByLabelText("当前会话")).toHaveTextContent("Session B");
  await act(async () => { delayed.finish("A"); });
  expect(screen.getByLabelText("当前会话")).toHaveTextContent("Session B");
  expect(screen.queryByText("Answer A")).not.toBeInTheDocument();
  mounted.unmount();
});

test.each(["首页", "任务"])("navigating to %s cancels a pending history navigation", async destination => {
  const delayed = delayedHistory();
  const mounted = render(<AssistantSessionController {...props} historyPersistence={delayed.persistence} />);
  await screen.findByText("Old answer");
  fireEvent.click(screen.getByRole("button", { name: "历史", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "打开会话：Session A", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: destination, exact: true }));
  await act(async () => { delayed.finish("A"); });
  expect(screen.queryByText("Answer A")).not.toBeInTheDocument();
  if (destination === "首页") expect(screen.getByLabelText("助手首页")).toBeInTheDocument();
  else expect(screen.getByLabelText("历史会话面板")).toHaveTextContent("任务");
  mounted.unmount();
});

test("edits made while a history destination loads survive returning to the source", async () => {
  const delayed = delayedHistory();
  const mounted = render(<AssistantSessionController {...props} historyPersistence={delayed.persistence} />);
  await screen.findByText("Old answer");
  fireEvent.click(screen.getByRole("button", { name: "首页", exact: true }));
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), { target: { value: "Source draft" } });
  fireEvent.click(screen.getByRole("button", { name: "打开会话：Session A", exact: true }));
  fireEvent.change(screen.getByPlaceholderText("输入你的问题或命令"), { target: { value: "Edited while waiting" } });
  await act(async () => { delayed.finish("A"); });
  fireEvent.click(screen.getByRole("button", { name: "历史", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "打开会话：新对话", exact: true }));
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("Edited while waiting");
  mounted.unmount();
});
