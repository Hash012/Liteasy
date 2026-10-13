import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { createScopedAssistantHistoryPersistence, parseAssistantHistory, type AssistantHistorySnapshot } from "../app/features/assistant/assistantHistoryPersistence";
import { createAssistantSession } from "../app/features/assistant/assistantSessionHistory";
import { createAssistantSessionService } from "../app/controllers/assistant/assistantSessionService";
import type { AgentEvent } from "../app/features/agent-api/agentApi.types";

const fixture = (): AssistantHistorySnapshot => {
  const session = createAssistantSession({ id: "a" });
  session.messages = [{ id: "u1", role: "user", content: "question" }];
  return { version: "liteasy.assistant-history/v1", activeSessionId: "a", sessions: [session], draft: { input: "", tokens: [], readerContexts: [] } };
};
test("incremental storage rejects a stale title snapshot instead of overwriting another view's messages", async () => {
  const scope = crypto.randomUUID();
  const a = createScopedAssistantHistoryPersistence(scope, () => scope);
  await a.load(); await a.save(fixture());
  const b = createScopedAssistantHistoryPersistence(scope, () => scope);
  const stale = (await b.load())!;
  const next = (await a.load())!;
  next.sessions[0].messages.push({ id: "u2", role: "user", content: "new message" });
  await a.save(next);
  stale.sessions[0].title = "stale title";
  await expect(b.save(stale)).rejects.toThrow("修改");
  const reloaded = (await createScopedAssistantHistoryPersistence(scope, () => scope).load())!;
  expect(reloaded.sessions[0].messages.map((message) => message.id)).toEqual(["u1", "u2"]);
});
test("a send transaction rolls back user message, outbox and cleared draft together", async () => {
  const scope = crypto.randomUUID();
  const storage = createObjectStorage(scope, () => scope);
  let fail = false;
  const repository = createScopedAssistantHistoryPersistence(scope, () => scope, { storage: {
    ...storage, commit: async (changes) => { if (fail) throw new Error("disk full"); await storage.commit(changes); }
  } });
  await repository.load();
  const before = fixture(); before.sessions[0].draft = { input: "keep draft", tokens: [], readerContexts: [] };
  await repository.save(before);
  const submitted = structuredClone(before);
  submitted.sessions[0].messages.push({ id: "u2", role: "user", content: "new question", requestId: "request-2" });
  submitted.sessions[0].draft = { input: "", tokens: [], readerContexts: [] };
  submitted.sessions[0].outbox = [{ requestId: "request-2", userMessageId: "u2", state: "pending", input: {} }];
  fail = true;
  await expect(repository.save(submitted)).rejects.toThrow("disk full");
  const restored = (await createScopedAssistantHistoryPersistence(scope, () => scope).load())!.sessions[0];
  expect(restored.messages).toHaveLength(1); expect(restored.outbox).toBeUndefined(); expect(restored.draft?.input).toBe("keep draft");
  fail = false; await repository.save(submitted);
  expect((await createScopedAssistantHistoryPersistence(scope, () => scope).load())!.sessions[0].outbox?.[0].state).toBe("needs_review");
});
test("migration backs up raw facts, isolates damaged records, and repeats without duplicate messages", async () => {
  const scope = crypto.randomUUID();
  const storage = createObjectStorage(scope, () => scope);
  const raw = fixture(); raw.sessions[0].status = "running";
  (raw.sessions as unknown[]).push({ id: "corrupt" });
  (raw.sessions[0].messages as unknown[]).push({ id: "bad-message" });
  await storage.commit([{ key: "assistant-history/current", expected: null, row: { key: "assistant-history/current", version: "legacy", value: raw } }]);
  const first = (await createScopedAssistantHistoryPersistence(scope, () => scope).load())!;
  expect(first.sessions).toHaveLength(1); expect(first.sessions[0].messages).toHaveLength(1);
  expect(first.sessions[0].status).toBe("unknown"); expect(first.quarantined).toHaveLength(2);
  expect((await storage.get("assistant/v2/legacy-backup"))!.value).toEqual(raw);
  const second = (await createScopedAssistantHistoryPersistence(scope, () => scope).load())!;
  expect(second.sessions[0].messages).toEqual(first.sessions[0].messages);
  expect(second.sessions[0].origin?.kind).toBe("direct_chat");
});
test("a saved index loads only the active body; visiting another session hydrates it on demand", async () => {
  const scope = crypto.randomUUID();
  const repo = createScopedAssistantHistoryPersistence(scope, () => scope);
  await repo.load(); const data = fixture(); data.sessions.push({ ...data.sessions[0], id: "b" });
  await repo.save(data);
  const fresh = createScopedAssistantHistoryPersistence(scope, () => scope);
  const index = (await fresh.load())!;
  expect(index.sessions.find((session) => session.id === "b")?.messages).toEqual([]);
  expect((await fresh.loadSession!("b"))?.messages).toHaveLength(1);
});
test("different view drafts coexist without changing the other view's draft", async () => {
  const scope = crypto.randomUUID();
  const a = createScopedAssistantHistoryPersistence(scope, () => scope, { viewId: "a" });
  await a.load(); const first = fixture(); first.sessions[0].draft = { input: "draft a", tokens: [], readerContexts: [] }; await a.save(first);
  const b = createScopedAssistantHistoryPersistence(scope, () => scope, { viewId: "b" });
  const second = (await b.load())!; second.sessions[0].draft = { input: "draft b", tokens: [], readerContexts: [] }; await b.save(second);
  expect((await createScopedAssistantHistoryPersistence(scope, () => scope, { viewId: "a" }).load())!.sessions[0].draft?.input).toBe("draft a");
  expect((await createScopedAssistantHistoryPersistence(scope, () => scope, { viewId: "b" }).load())!.sessions[0].draft?.input).toBe("draft b");
});
test("event inbox buffers gaps and deduplicates overlap without advancing a discontinuous watermark", () => {
  const owner = createAssistantSessionService("a");
  const applied: string[] = [];
  const event = (sequence: number): AgentEvent => ({ apiVersion: "liteasy.agent/v1", emittedAt: "now", eventId: `event-${sequence}`, sequence, runId: "run-a", sessionId: "runtime-a", type: "assistant.delta", delta: String(sequence) });
  const apply = (event: AgentEvent) => applied.push(event.eventId);
  owner.accept(event(1), apply); owner.accept(event(3), apply); owner.accept(event(3), apply);
  expect(owner.watermark("run-a")).toBe(1); expect(owner.hasGap("run-a")).toBe(true);
  owner.accept(event(2), apply);
  expect(owner.watermark("run-a")).toBe(3); expect(applied).toEqual(["event-1", "event-2", "event-3"]);
  expect(() => owner.accept({ ...event(3), delta: "conflict" } as AgentEvent, apply)).toThrow("身份冲突");
});
test("selection changes never change a scoped run's store and disposal rejects late writes", () => {
  const owner = createAssistantSessionService("a"); owner.select("b");
  owner.withTarget("a", () => owner.store().addMessage({ id: "a1", role: "assistant", content: "belongs to a" }));
  expect(owner.store("b").getState().messages).toEqual([]); expect(owner.store("a").getState().messages).toHaveLength(1);
  owner.dispose(); owner.withTarget("b", () => owner.store().addMessage({ id: "late", role: "assistant", content: "late" }));
  expect(owner.store("b").getState().messages).toEqual([]);
});
test("unknown snapshots retain queued intent and reject future versions without guessing cancellation", () => {
  const raw = fixture(); raw.sessions[0].status = "running";
  raw.sessions[0].messages[0].queuedDelivery = { policy: "after_run" };
  expect(parseAssistantHistory(raw)!.sessions[0].status).toBe("unknown");
  expect(parseAssistantHistory(raw)!.sessions[0].messages[0].queuedDelivery).toEqual({ policy: "after_run" });
  expect(() => parseAssistantHistory({ ...raw, version: "future" })).toThrow("原记录已保留");
});

test("A02-12 legacy messages without origin remain unknown and raw backup supports rollback after repeat migration", async () => {
  const scope = crypto.randomUUID();
  const storage = createObjectStorage(scope, () => scope);
  const raw = fixture();
  delete raw.sessions[0].origin;
  raw.sessions[0].messages.push({ id: "diagnostic", role: "assistant", content: "openai_agents_sdk_result_missing" });
  await storage.commit([{ key: "assistant-history/current", expected: null, row: { key: "assistant-history/current", version: "legacy", value: raw } }]);
  const migrated = (await createScopedAssistantHistoryPersistence(scope, () => scope).load())!;
  const repeated = (await createScopedAssistantHistoryPersistence(scope, () => scope).load())!;
  expect(migrated.sessions[0].origin?.kind).toBe("legacy_unknown");
  expect(migrated.sessions[0].taskBinding).toBeUndefined();
  expect(repeated.sessions[0].messages).toEqual(migrated.sessions[0].messages);
  const backup = (await storage.get("assistant/v2/legacy-backup"))!.value;
  expect(backup).toEqual(raw);
  expect(parseAssistantHistory(backup)!.sessions[0].messages).toEqual(migrated.sessions[0].messages);
});

test("A02-13 separate conversations retain both window drafts and scroll anchors after reopening", async () => {
  const scope = crypto.randomUUID();
  const a = createScopedAssistantHistoryPersistence(scope, () => scope, { viewId: "window-a" });
  await a.load();
  const initial = fixture(); initial.sessions.push({ ...structuredClone(initial.sessions[0]), id: "b" });
  await a.save(initial);
  const b = createScopedAssistantHistoryPersistence(scope, () => scope, { viewId: "window-b" });
  const right = (await b.load())!;
  right.sessions[1] = (await b.loadSession!("b"))!;
  right.activeSessionId = "b";
  right.sessions[1].draft = { input: "draft B", tokens: [], readerContexts: [] };
  right.sessions[1].scrollAnchor = { messageId: "u1", offset: 25 };
  await b.save(right);
  initial.sessions[0].draft = { input: "draft A", tokens: [], readerContexts: [] };
  initial.sessions[0].scrollAnchor = { messageId: "u1", offset: 10 };
  await a.save(initial);
  const restoredA = (await createScopedAssistantHistoryPersistence(scope, () => scope, { viewId: "window-a" }).load())!;
  const restoredB = (await createScopedAssistantHistoryPersistence(scope, () => scope, { viewId: "window-b" }).load())!;
  expect(restoredA.sessions.find((session) => session.id === "a")).toMatchObject({ draft: { input: "draft A" }, scrollAnchor: { offset: 10 } });
  expect(restoredB.sessions.find((session) => session.id === "b")).toMatchObject({ draft: { input: "draft B" }, scrollAnchor: { offset: 25 } });
});
