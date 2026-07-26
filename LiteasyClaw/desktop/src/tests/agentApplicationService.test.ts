import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import type {
  HumanConfirmationRequest,
  RuntimeExecutionResult
} from "../app/features/agent-runtime/agentRuntime.types";

function createTestService(overrides: {
  executeCommand?: () => RuntimeExecutionResult | Promise<RuntimeExecutionResult>;
  executeConfirmation?: () => RuntimeExecutionResult | Promise<RuntimeExecutionResult>;
  executeKnowledge?: () =>
    | { message: string }
    | Promise<{ message: string }>;
} = {}) {
  let sequence = 0;
  return createAgentApplicationService({
    createId(prefix) {
      sequence += 1;
      return `${prefix}-${sequence}`;
    },
    executeCommand: overrides.executeCommand ?? (() => ({
      events: [{ message: "command complete", type: "assistant_reply" }],
      settingsChanged: false
    })),
    executeConfirmation: overrides.executeConfirmation
      ? () => overrides.executeConfirmation!()
      : undefined,
    executeKnowledge: overrides.executeKnowledge ?? (() => ({ message: "grounded answer" })),
    now: () => new Date("2026-07-19T00:00:00.000Z")
  });
}

async function createSession(api: ReturnType<typeof createTestService>, consumer = "frontend" as const) {
  const result = await api.createSession({ consumer });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

test("runs a knowledge turn through one session and deduplicates retries", async () => {
  let executionCount = 0;
  const api = createTestService({
    executeKnowledge: () => {
      executionCount += 1;
      return { message: "answer with evidence" };
    }
  });
  const session = await createSession(api);
  const observedTypes: string[] = [];
  api.subscribe(session.sessionId, (event) => observedTypes.push(event.type));

  const request = {
    idempotencyKey: "question-1",
    input: { message: "compare papers", mode: "qa" as const },
    sessionId: session.sessionId
  };
  const first = await api.submitTurn(request);
  const retry = await api.submitTurn(request);

  expect(first.ok).toBe(true);
  expect(retry.ok).toBe(true);
  if (!first.ok || !retry.ok) {
    throw new Error("expected successful runs");
  }
  expect(first.data.runId).toBe(retry.data.runId);
  expect(first.data.status).toBe("completed");
  expect(first.data.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  expect(observedTypes).toEqual([
    "run.started",
    "context.prepared",
    "assistant.message",
    "run.completed"
  ]);
  expect(executionCount).toBe(1);

  const conflict = await api.submitTurn({
    ...request,
    input: { ...request.input, message: "different question" }
  });
  expect(conflict).toMatchObject({
    error: { code: "idempotency_conflict" },
    ok: false
  });
});

test("deduplicates idempotent retries with semantically identical attachment metadata", async () => {
  const api = createTestService();
  const session = await createSession(api);
  const first = await api.submitTurn({
    attachments: [
      {
        metadata: {
          paperIds: ["demo-1", "demo-2"],
          scope: "selection"
        },
        source: "selection",
        uri: "liteasy://selection/current"
      }
    ],
    idempotencyKey: "question-with-attachments",
    input: { message: "compare papers", mode: "qa" },
    sessionId: session.sessionId
  });
  const retry = await api.submitTurn({
    attachments: [
      {
        metadata: {
          scope: "selection",
          paperIds: ["demo-1", "demo-2"]
        },
        source: "selection",
        uri: "liteasy://selection/current"
      }
    ],
    idempotencyKey: "question-with-attachments",
    input: { message: "compare papers", mode: "qa" },
    sessionId: session.sessionId
  });

  expect(first.ok).toBe(true);
  expect(retry.ok).toBe(true);
  if (!first.ok || !retry.ok) {
    throw new Error("expected successful runs");
  }
  expect(retry.data.runId).toBe(first.data.runId);
});

test("keeps a risky command pending until the owning session approves it", async () => {
  let confirmationExecutions = 0;
  const confirmation: HumanConfirmationRequest = {
    action: {
      actionId: "workspace.delete_documents",
      payload: { scope: "selected_document_set" }
    },
    confirmationId: "confirmation-risky",
    plan: {
      actions: [
        {
          actionId: "workspace.delete_documents",
          input: { scope: "selected_document_set" }
        }
      ],
      confidence: "high",
      intentId: "workspace.delete_documents",
      planId: "delete-plan",
      requiredContext: ["selected_document_set"],
      requiresConfirmation: true,
      riskLevel: "high",
      summary: "delete selected papers"
    },
    summary: "delete selected papers",
    traceId: "trace-delete-plan",
    type: "confirmation_request"
  };
  const api = createTestService({
    executeCommand: () => ({ events: [confirmation], settingsChanged: false }),
    executeConfirmation: () => {
      confirmationExecutions += 1;
      return {
        events: [{ message: "deleted", type: "assistant_reply" }],
        settingsChanged: false
      };
    }
  });
  const owner = await createSession(api);
  const other = await createSession(api);
  const submitted = await api.submitTurn({
    idempotencyKey: "delete-1",
    input: { message: "delete these papers", mode: "command" },
    sessionId: owner.sessionId
  });

  expect(submitted).toMatchObject({ data: { status: "waiting_confirmation" }, ok: true });
  expect(confirmationExecutions).toBe(0);

  const crossSession = await api.resolveConfirmation({
    confirmationId: confirmation.confirmationId,
    decision: "approve",
    sessionId: other.sessionId
  });
  expect(crossSession).toMatchObject({
    error: { code: "confirmation_not_found" },
    ok: false
  });

  const approved = await api.resolveConfirmation({
    confirmationId: confirmation.confirmationId,
    decision: "approve",
    sessionId: owner.sessionId
  });
  expect(approved).toMatchObject({ data: { status: "completed" }, ok: true });
  expect(confirmationExecutions).toBe(1);
  if (approved.ok) {
    expect(approved.data.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "confirmation.required",
        "confirmation.resolved",
        "assistant.message",
        "run.completed"
      ])
    );
  }
});

test("cancellation wins over a late knowledge executor result", async () => {
  let resolveKnowledge: ((value: { message: string }) => void) | undefined;
  const api = createTestService({
    executeKnowledge: () => new Promise((resolve) => {
      resolveKnowledge = resolve;
    })
  });
  const session = await createSession(api);
  let runId = "";
  api.subscribe(session.sessionId, (event) => {
    runId = event.runId;
  });

  const submittedPromise = api.submitTurn({
    idempotencyKey: "slow-1",
    input: { message: "slow question", mode: "qa" },
    sessionId: session.sessionId
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(runId).not.toBe("");

  const cancelled = await api.cancelRun({
    reason: "user stopped",
    runId,
    sessionId: session.sessionId
  });
  expect(cancelled).toMatchObject({ data: { status: "cancelled" }, ok: true });
  resolveKnowledge?.({ message: "late answer" });
  const submitted = await submittedPromise;

  expect(submitted).toMatchObject({ data: { status: "cancelled" }, ok: true });
  if (submitted.ok) {
    expect(submitted.data.events.map((event) => event.type)).not.toContain("run.completed");
    expect(submitted.data.events.at(-1)?.type).toBe("run.cancelled");
  }
});
