import { createAssistantSession, snapshotAssistantSession } from "../app/features/assistant/assistantSessionHistory";
import { parseAssistantHistory } from "../app/features/assistant/assistantHistoryPersistence";
import { createSessionTitleCoordinator, generateSessionTitle } from "../app/features/assistant/assistantSessionTitles";
import type { GenerateAnswerInput } from "../app/features/models/modelGateway";
import type { AssistantSessionHistoryItem } from "../app/features/assistant/assistantSessionHistory";
const turn = () => ({ ...createAssistantSession({ id: "one" }), status: "idle" as const, messages: [
  { id: "u", role: "user" as const, content: "解释论文的注意力机制" },
  { id: "a", role: "assistant" as const, content: "注意力按相关性组合信息。", turnOutcome: "completed" as const }
] });
function setup(generate = vi.fn().mockResolvedValue("注意力机制")) {
  let sessions: AssistantSessionHistoryItem[] = [turn()]; let scope = "local"; let generation = 1;
  const owner = createSessionTitleCoordinator({ getSessions: () => sessions, getScope: () => scope,
    getGeneration: () => generation, generate, update: (id, update) => { sessions = sessions.map(s => s.id === id ? update(s) : s); } });
  return { owner, generate, sessions: () => sessions, change: (patch: Partial<AssistantSessionHistoryItem>) => { sessions = [{ ...sessions[0], ...patch }]; },
    scope: () => { scope = "other"; }, generation: () => { generation++; } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
test("names first completed turn once and preserves model provenance across snapshot and restart", async () => {
  const f = setup(); f.owner.reconcile(); await settle(); expect(f.generate).toHaveBeenCalledTimes(1);
  const named = f.sessions()[0]; expect(named).toMatchObject({ title: "注意力机制", titleSource: "model", titleVersion: 1, titleNaming: { status: "completed", attempts: 1 } });
  const restored = parseAssistantHistory({ version: "liteasy.assistant-history/v1", activeSessionId: named.id, sessions: [named] })!.sessions[0];
  expect(snapshotAssistantSession({ session: restored, state: { mode: "qa", messages: restored.messages, pending: false } }).title).toBe("注意力机制");
  f.owner.reconcile(); await settle(); expect(f.generate).toHaveBeenCalledTimes(1); f.owner.dispose();
});
test("retries once then retains local fallback", async () => {
  const f = setup(vi.fn().mockRejectedValue(new Error("offline"))); f.owner.reconcile(); await settle(); expect(f.generate).toHaveBeenCalledTimes(2);
  expect(f.sessions()[0]).toMatchObject({ title: "解释论文的注意力机制", titleNaming: { status: "fallback", attempts: 2 }, titleSource: "automatic" });
  f.owner.reconcile(); await settle(); expect(f.generate).toHaveBeenCalledTimes(2); f.owner.dispose();
});
test.each(["manual", "archive", "delete", "scope", "generation", "messages", "version", "dispose"])("rejects late title after %s", async (change) => {
  let resolve!: (value: string) => void;
  const f = setup(vi.fn(() => new Promise<string>(done => { resolve = done; }))); f.owner.reconcile(); await settle();
  if (change === "manual") f.change({ title: "人工标题", titleSource: "user", titleVersion: 1 });
  if (change === "archive") f.change({ lifecycle: "archived" });
  if (change === "delete") f.change({ lifecycle: "tombstoned" });
  if (change === "scope") f.scope(); if (change === "generation") f.generation();
  if (change === "messages") f.change({ messages: [...turn().messages, { id: "u2", role: "user", content: "继续" }] });
  if (change === "version") f.change({ titleVersion: 9 }); if (change === "dispose") f.owner.dispose();
  resolve("过时标题"); await settle(); expect(f.sessions()[0].title).not.toBe("过时标题");
  if (change === "manual") expect(f.sessions()[0].title).toBe("人工标题"); f.owner.dispose();
});
test("skips tasks, notices, failures and running turns", async () => {
  for (const patch of [{ kind: "artifact_generation" as const, artifactId: "artifact" }, { status: "running" as const },
    { messages: [turn().messages[0], { ...turn().messages[1], turnOutcome: "failed" as const }] },
    { messages: [turn().messages[0], { ...turn().messages[1], kind: "system_notice" as const }] }]) {
    const f = setup(); f.change(patch); f.owner.reconcile(); await settle(); expect(f.generate).not.toHaveBeenCalled(); f.owner.dispose();
  }
});
test("bounds input and aborts after first generated title line", async () => {
  let request!: GenerateAnswerInput;
  const gateway = { generateAnswer: vi.fn(async (input) => { request = input; input.onDelta!("\"注意力机制\"\n多余说明", "\"注意力机制\"\n多余说明"); input.signal!.throwIfAborted(); throw new Error("unexpected"); }) };
  expect(await generateSessionTitle({ user: "问".repeat(5000), assistant: "答".repeat(5000) }, gateway, { model: "model", provider: "provider" }, new AbortController().signal)).toBe("注意力机制");
  expect(request.prompt.length).toBeLessThan(1900); expect(request.signal!.aborted).toBe(true); expect(request).not.toHaveProperty("tools");
});


test("timeouts abort the actual request and reject the title task", async () => {
  vi.useFakeTimers();
  try {
    let signal!: AbortSignal;
    const gateway = { generateAnswer: vi.fn((input: GenerateAnswerInput) => new Promise<never>((_resolve, reject) => {
      signal = input.signal!;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })) };
    const result = generateSessionTitle({ user: "问题", assistant: "回答" }, gateway, { model: "m", provider: "p" }, new AbortController().signal);
    const rejected = expect(result).rejects.toThrow("title_timeout");
    await vi.advanceTimersByTimeAsync(12000); await rejected;
    expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test("switching the selected conversation cannot redirect a pending title", async () => {
  let resolve!: (value: string) => void;
  let sessions: AssistantSessionHistoryItem[] = [turn(), { ...createAssistantSession({ id: "two" }), title: "第二会话" }];
  const owner = createSessionTitleCoordinator({ getSessions: () => sessions, getScope: () => "local", getGeneration: () => 1,
    generate: () => new Promise<string>(done => { resolve = done; }),
    update: (id, update) => { sessions = sessions.map(s => s.id === id ? update(s) : s); } });
  owner.reconcile(); sessions = [sessions[1], sessions[0]]; owner.reconcile(); resolve("第一会话的主题"); await settle();
  expect(sessions.find(s => s.id === "one")?.title).toBe("第一会话的主题");
  expect(sessions.find(s => s.id === "two")?.title).toBe("第二会话"); owner.dispose();
});

test("restored pending attempts do not reset the finite retry budget", async () => {
  const f = setup(vi.fn().mockRejectedValue(new Error("offline")));
  f.change({ titleNaming: { policy: "first-answer/v1", status: "pending", attempts: 1, messageFingerprint: "previous" } });
  f.owner.reconcile(); await settle(); expect(f.generate).toHaveBeenCalledTimes(1);
  expect(f.sessions()[0].titleNaming?.status).toBe("fallback"); f.owner.dispose();
});
