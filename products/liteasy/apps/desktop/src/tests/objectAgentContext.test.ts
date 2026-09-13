import { expect, test, vi } from "vitest";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import type { ContextSnapshot } from "../app/features/context/objectContext";
import { usePdfQuickAskController } from "../app/controllers/usePdfQuickAskController";
const snapshot: ContextSnapshot = {
  snapshotId: "snapshot",
  scopeId: "A",
  purpose: "解释",
  createdAt: new Date().toISOString(),
  entries: [],
  tokens: 0,
};

test("old services reject object context before running, rather than ignoring attachments", async () => {
  const execute = vi.fn(async () => ({ message: "must not run" }));
  const api = createAgentApplicationService({
    executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: execute,
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error("session");
  const result = await api.submitTurn({
    sessionId: session.data.sessionId,
    idempotencyKey: "once",
    contextRefs: [{ objectId: "o", revision: "r" }],
    input: { mode: "qa", message: "why" },
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "unsupported_operation" },
  });
  expect(execute).not.toHaveBeenCalled();
});

test("context-aware public runs freeze snapshots and reject mismatched idempotency parameters", async () => {
  const api = createAgentApplicationService({
    supportsObjectContext: true,
    getPrincipalId: () => "A",
    resolveContext: () => ({ objectSnapshot: snapshot }),
    executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: async (input) => ({
      message: input.context.objectSnapshot!.snapshotId,
    }),
  });
  const session = await api.createSession({
    consumer: "frontend",
    principalId: "forged",
  });
  if (!session.ok) throw new Error("session");
  expect(session.data.principalId).toBe("A");
  const request = {
    sessionId: session.data.sessionId,
    idempotencyKey: "once",
    contextRefs: [{ objectId: "o", revision: "r" }],
    input: { mode: "qa" as const, message: "why" },
  };
  const result = await api.submitTurn(request);
  expect(result).toMatchObject({
    ok: true,
    data: { status: "completed", contextSnapshotId: "snapshot" },
  });
  expect(
    await api.submitTurn({
      ...request,
      contextRefs: [{ objectId: "o", revision: "new" }],
    }),
  ).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
});

test("account invalidation propagates cancellation and suppresses late output", async () => {
  let principal = "A";
  let finish!: () => void;
  let signal: AbortSignal | undefined;
  const api = createAgentApplicationService({
    supportsObjectContext: true,
    getPrincipalId: () => principal,
    resolveContext: () => ({ objectSnapshot: snapshot }),
    executeCommand: () => ({ events: [], settingsChanged: false }),
    executeKnowledge: async (input) => {
      signal = input.signal;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      input.reportDelta("late");
      return { message: "late answer" };
    },
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error("session");
  const events: string[] = [];
  api.subscribe(session.data.sessionId, (event) => events.push(event.type));
  const running = api.submitTurn({
    sessionId: session.data.sessionId,
    idempotencyKey: "cancel",
    contextRefs: [{ objectId: "o", revision: "r" }],
    input: { mode: "qa", message: "why" },
  });
  await vi.waitFor(() => expect(signal).toBeDefined());
  principal = "B";
  api.dispose();
  expect(signal?.aborted).toBe(true);
  finish();
  expect(await running).toMatchObject({
    ok: true,
    data: { status: "cancelled" },
  });
  expect(events).not.toContain("assistant.delta");
  expect(events).not.toContain("run.completed");
  expect(
    await api.getRun({ sessionId: session.data.sessionId, runId: "unknown" }),
  ).toMatchObject({ ok: false, error: { code: "session_not_found" } });
});

test("quick ask uses captured references and the public run cancellation signal", async () => {
  const capture = vi.fn(async () => [{ objectId: "fragment", revision: "v1" }]);
  const ask = vi.fn(async () => "answer");
  const abort = new AbortController();
  const request = {
    paper: { id: "paper", title: "Paper" },
    page: 3,
    excerpt: "quote",
    question: "why",
    pageText: "full page",
    abstractText: "abstract",
    signal: abort.signal,
  };
  expect(await usePdfQuickAskController({ capture, ask })(request)).toBe(
    "answer",
  );
  expect(ask).toHaveBeenCalledWith(
    "why",
    [{ objectId: "fragment", revision: "v1" }],
    abort.signal,
  );
  abort.abort();
  await expect(
    usePdfQuickAskController({ capture, ask })(request),
  ).rejects.toThrow("取消");
  expect(capture).toHaveBeenCalledTimes(1);
});
