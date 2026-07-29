import { vi } from "vitest";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import type {
  AgentStateSnapshot,
  AgentStateStore
} from "../app/controllers/agent/agentStatePersistence";
import type { AgentPublicApi } from "../app/features/agent-api/agentApi.types";
import type {
  HumanConfirmationRequest,
  RuntimeExecutionResult
} from "../app/features/agent-runtime/agentRuntime.types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createMemoryStore(initial?: unknown) {
  let saved: unknown = initial ?? null;
  const store: AgentStateStore = {
    load: () => clone(saved),
    save: (snapshot) => {
      saved = clone(snapshot);
    }
  };
  return {
    get snapshot() {
      return saved;
    },
    store
  };
}

let serviceSequence = 0;

function createPersistentService(input: {
  executeCommand?: () => RuntimeExecutionResult | Promise<RuntimeExecutionResult>;
  executeConfirmation?: () => RuntimeExecutionResult | Promise<RuntimeExecutionResult>;
  executeKnowledge?: () => { message: string } | Promise<{ message: string }>;
  onPersistenceError?: (error: Error) => void;
  stateStore: AgentStateStore;
}): AgentPublicApi {
  serviceSequence += 1;
  const serviceId = serviceSequence;
  let idSequence = 0;
  return createAgentApplicationService({
    createId(prefix) {
      idSequence += 1;
      return `${prefix}-${serviceId}-${idSequence}`;
    },
    executeCommand: input.executeCommand ?? (() => ({
      events: [{ message: "command complete", type: "assistant_reply" }],
      settingsChanged: false
    })),
    executeConfirmation: input.executeConfirmation
      ? () => input.executeConfirmation!()
      : undefined,
    executeKnowledge: input.executeKnowledge ?? (() => ({ message: "answer" })),
    now: () => new Date("2026-07-20T00:00:00.000Z"),
    onPersistenceError: input.onPersistenceError,
    stateStore: input.stateStore
  });
}

async function createSession(api: AgentPublicApi) {
  const result = await api.createSession({ consumer: "frontend" });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

const confirmation: HumanConfirmationRequest = {
  action: {
    actionId: "workspace.delete_documents",
    payload: { scope: "selected_document_set" }
  },
  confirmationId: "confirmation-persisted",
  plan: {
    actions: [{
      actionId: "workspace.delete_documents",
      input: { scope: "selected_document_set" }
    }],
    confidence: "high",
    intentId: "workspace.delete_documents",
    planId: "persisted-plan",
    requiredContext: ["selected_document_set"],
    requiresConfirmation: true,
    riskLevel: "high",
    summary: "delete selected papers"
  },
  summary: "delete selected papers",
  traceId: "trace-persisted-plan",
  type: "confirmation_request"
};

test("restores completed runs and their idempotency mapping", async () => {
  const memory = createMemoryStore();
  const first = createPersistentService({ stateStore: memory.store });
  const session = await createSession(first);
  const request = {
    idempotencyKey: "persistent-question",
    input: { message: "compare papers", mode: "qa" as const },
    sessionId: session.sessionId
  };
  const completed = await first.submitTurn(request);
  if (!completed.ok) {
    throw new Error(completed.error.message);
  }

  const secondExecution = vi.fn(() => ({ message: "must not run" }));
  const second = createPersistentService({
    executeKnowledge: secondExecution,
    stateStore: memory.store
  });
  const restored = await second.getRun({
    runId: completed.data.runId,
    sessionId: session.sessionId
  });
  const retry = await second.submitTurn(request);

  expect(restored).toMatchObject({ data: { status: "completed" }, ok: true });
  expect(retry).toMatchObject({
    data: { runId: completed.data.runId, status: "completed" },
    ok: true
  });
  expect(secondExecution).not.toHaveBeenCalled();
});

test("persists internal artifact workflow traces as a queryable ledger", async () => {
  const memory = createMemoryStore();
  const first = createPersistentService({
    executeKnowledge: () => ({
      message: "mindmap ready",
      metadata: {
        artifactWorkflow: {
          status: "verified",
          workflowTrace: {
            artifactId: "artifact-mindmap-1",
            internalOnly: true,
            runId: "placeholder-before-service-run",
            steps: [
              {
                completedAt: "2026-07-20T00:00:00.000Z",
                kind: "verification",
                startedAt: "2026-07-20T00:00:00.000Z",
                status: "completed",
                stepId: "1-verification",
                summary: "确定性校验通过"
              }
            ],
            traceId: "mindmap-workflow:placeholder:artifact-mindmap-1",
            version: "liteasy.mindmap-workflow-trace/v1"
          }
        }
      }
    }),
    stateStore: memory.store
  });
  const session = await createSession(first);
  const submitted = await first.submitTurn({
    idempotencyKey: "mindmap-ledger",
    input: { artifactType: "mindmap", message: "生成思维导图", mode: "qa" },
    sessionId: session.sessionId
  });
  if (!submitted.ok) {
    throw new Error(submitted.error.message);
  }

  const firstLedger = await first.listWorkflowTraces({
    runId: submitted.data.runId,
    sessionId: session.sessionId
  });
  const second = createPersistentService({ stateStore: memory.store });
  const restoredLedger = await second.listWorkflowTraces({
    runId: submitted.data.runId,
    sessionId: session.sessionId
  });

  expect(firstLedger).toMatchObject({
    data: [
      {
        artifactId: "artifact-mindmap-1",
        internalOnly: true,
        runId: submitted.data.runId,
        sessionId: session.sessionId,
        traceId: "mindmap-workflow:placeholder:artifact-mindmap-1"
      }
    ],
    ok: true
  });
  expect(restoredLedger).toEqual(firstLedger);
  expect((memory.snapshot as AgentStateSnapshot).workflowTraces).toHaveLength(1);
});

test("projects persisted workflow traces into internal audit events", async () => {
  const memory = createMemoryStore();
  const first = createPersistentService({
    executeKnowledge: () => ({
      message: "mindmap blocked",
      metadata: {
        artifactWorkflow: {
          status: "blocked",
          workflowTrace: {
            artifactId: "artifact-mindmap-2",
            internalOnly: true,
            runId: "placeholder-before-service-run",
            steps: [
              {
                completedAt: "2026-07-20T00:00:01.000Z",
                kind: "verification",
                startedAt: "2026-07-20T00:00:00.000Z",
                status: "blocked",
                stepId: "1-verification",
                summary: "确定性校验未通过"
              }
            ],
            traceId: "mindmap-workflow:placeholder:artifact-mindmap-2",
            version: "liteasy.mindmap-workflow-trace/v1"
          }
        }
      }
    }),
    stateStore: memory.store
  });
  const session = await createSession(first);
  const submitted = await first.submitTurn({
    idempotencyKey: "mindmap-event-projection",
    input: { artifactType: "mindmap", message: "生成思维导图", mode: "qa" },
    sessionId: session.sessionId
  });
  if (!submitted.ok) {
    throw new Error(submitted.error.message);
  }

  const events = await first.listWorkflowTraceEvents({
    runId: submitted.data.runId,
    sessionId: session.sessionId
  });

  expect(events).toMatchObject({
    data: [
      { type: "workflow.started" },
      {
        kind: "verification",
        status: "blocked",
        summary: "确定性校验未通过",
        type: "workflow.step.blocked"
      },
      {
        status: "blocked",
        type: "workflow.blocked"
      }
    ],
    ok: true
  });
});

test("summarizes persisted workflow trace events for internal audits", async () => {
  const memory = createMemoryStore();
  const first = createPersistentService({
    executeKnowledge: () => ({
      message: "mindmap blocked",
      metadata: {
        artifactWorkflow: {
          status: "blocked",
          workflowTrace: {
            artifactId: "artifact-mindmap-3",
            internalOnly: true,
            runId: "placeholder-before-service-run",
            steps: [
              {
                completedAt: "2026-07-20T00:00:01.000Z",
                kind: "verification",
                startedAt: "2026-07-20T00:00:00.000Z",
                status: "blocked",
                stepId: "1-verification",
                summary: "确定性校验未通过"
              },
              {
                completedAt: "2026-07-20T00:00:02.000Z",
                details: {
                  unresolvedIssueCodes: ["missing_selected_paper_coverage"]
                },
                kind: "repair",
                startedAt: "2026-07-20T00:00:01.000Z",
                status: "blocked",
                stepId: "2-repair",
                summary: "没有安全自动修复策略，保持草稿阻断"
              }
            ],
            traceId: "mindmap-workflow:placeholder:artifact-mindmap-3",
            version: "liteasy.mindmap-workflow-trace/v1"
          }
        }
      }
    }),
    stateStore: memory.store
  });
  const session = await createSession(first);
  const submitted = await first.submitTurn({
    idempotencyKey: "mindmap-summary",
    input: { artifactType: "mindmap", message: "生成思维导图", mode: "qa" },
    sessionId: session.sessionId
  });
  if (!submitted.ok) {
    throw new Error(submitted.error.message);
  }

  const summaries = await first.listWorkflowTraceSummaries({
    runId: submitted.data.runId,
    sessionId: session.sessionId
  });

  expect(summaries).toMatchObject({
    data: [
      {
        artifactId: "artifact-mindmap-3",
        blockedStep: {
          kind: "verification",
          stepId: "1-verification",
          summary: "确定性校验未通过"
        },
        failedIssueCodes: ["missing_selected_paper_coverage"],
        repairAttempted: true,
        repairSucceeded: false,
        status: "blocked",
        stepCount: 2
      }
    ],
    ok: true
  });
});

test("projects persisted workflow traces into user-safe public audit summaries", async () => {
  const memory = createMemoryStore();
  const first = createPersistentService({
    executeKnowledge: () => ({
      message: "mindmap blocked",
      metadata: {
        artifactWorkflow: {
          status: "blocked",
          workflowTrace: {
            artifactId: "artifact-mindmap-public",
            internalOnly: true,
            runId: "placeholder-before-service-run",
            steps: [
              {
                completedAt: "2026-07-20T00:00:01.000Z",
                kind: "verification",
                startedAt: "2026-07-20T00:00:00.000Z",
                status: "blocked",
                stepId: "1-verification",
                summary: "确定性校验未通过"
              },
              {
                completedAt: "2026-07-20T00:00:02.000Z",
                details: {
                  unresolvedIssueCodes: ["missing_selected_paper_coverage"]
                },
                kind: "repair",
                startedAt: "2026-07-20T00:00:01.000Z",
                status: "blocked",
                stepId: "2-repair",
                summary: "没有安全自动修复策略，保持草稿阻断"
              }
            ],
            traceId: "mindmap-workflow:placeholder:artifact-mindmap-public",
            version: "liteasy.mindmap-workflow-trace/v1"
          }
        }
      }
    }),
    stateStore: memory.store
  });
  const session = await createSession(first);
  const submitted = await first.submitTurn({
    idempotencyKey: "mindmap-public-summary",
    input: { artifactType: "mindmap", message: "生成思维导图", mode: "qa" },
    sessionId: session.sessionId
  });
  if (!submitted.ok) {
    throw new Error(submitted.error.message);
  }

  const summaries = await first.listPublicWorkflowAuditSummaries({
    runId: submitted.data.runId,
    sessionId: session.sessionId
  });

  expect(summaries).toMatchObject({
    data: [
      {
        auditLevel: "brief",
        disclosure: "public",
        issueLabels: ["选中文献证据覆盖不足"],
        status: "blocked"
      }
    ],
    ok: true
  });
  expect(JSON.stringify(summaries)).not.toContain("placeholder");
  expect(JSON.stringify(summaries)).not.toContain("stepId");
});

test("reconnects a stable frontend client session after restart", async () => {
  const memory = createMemoryStore();
  const first = createPersistentService({ stateStore: memory.store });
  const created = await first.createSession({
    clientSessionId: "assistant-pane",
    consumer: "frontend"
  });
  if (!created.ok) {
    throw new Error(created.error.message);
  }

  const second = createPersistentService({ stateStore: memory.store });
  const reconnected = await second.createSession({
    clientSessionId: "assistant-pane",
    consumer: "frontend"
  });

  expect(reconnected).toMatchObject({
    data: { sessionId: created.data.sessionId },
    ok: true
  });
  expect((memory.snapshot as AgentStateSnapshot).sessions).toHaveLength(1);
});

test("restores pending confirmation without executing it automatically", async () => {
  const memory = createMemoryStore();
  const first = createPersistentService({
    executeCommand: () => ({ events: [confirmation], settingsChanged: false }),
    stateStore: memory.store
  });
  const session = await createSession(first);
  const submitted = await first.submitTurn({
    idempotencyKey: "persistent-command",
    input: { message: "delete papers", mode: "command" },
    sessionId: session.sessionId
  });
  expect(submitted).toMatchObject({
    data: { status: "waiting_confirmation" },
    ok: true
  });

  const executeConfirmation = vi.fn((): RuntimeExecutionResult => ({
    events: [{ message: "deleted", type: "assistant_reply" }],
    settingsChanged: false
  }));
  const second = createPersistentService({
    executeConfirmation,
    stateStore: memory.store
  });
  expect(executeConfirmation).not.toHaveBeenCalled();

  const approved = await second.resolveConfirmation({
    confirmationId: confirmation.confirmationId,
    decision: "approve",
    sessionId: session.sessionId
  });
  expect(approved).toMatchObject({ data: { status: "completed" }, ok: true });
  expect(executeConfirmation).toHaveBeenCalledTimes(1);
});

test("repairs a run that was interrupted by application restart", async () => {
  const memory = createMemoryStore();
  let resolveKnowledge: ((value: { message: string }) => void) | undefined;
  const first = createPersistentService({
    executeKnowledge: () => new Promise((resolve) => {
      resolveKnowledge = resolve;
    }),
    stateStore: memory.store
  });
  const session = await createSession(first);
  const submittedPromise = first.submitTurn({
    idempotencyKey: "interrupted-question",
    input: { message: "long analysis", mode: "qa" },
    sessionId: session.sessionId
  });

  await vi.waitFor(() => {
    const snapshot = memory.snapshot as AgentStateSnapshot;
    expect(snapshot.sessions[0].runs[0].status).toBe("running");
  });
  const restartMemory = createMemoryStore(memory.snapshot);
  const persisted = restartMemory.snapshot as AgentStateSnapshot;
  const runId = persisted.sessions[0].runs[0].runId;
  const second = createPersistentService({ stateStore: restartMemory.store });
  const restored = await second.getRun({ runId, sessionId: session.sessionId });

  expect(restored).toMatchObject({ data: { status: "failed" }, ok: true });
  if (restored.ok) {
    expect(restored.data.events.at(-1)).toMatchObject({
      message: "Agent 运行因应用重启而中断。",
      type: "run.failed"
    });
  }

  resolveKnowledge?.({ message: "old process result" });
  await submittedPromise;
});

test("reports a corrupt snapshot and starts from a clean state", async () => {
  const memory = createMemoryStore({ version: "not-supported" });
  const onPersistenceError = vi.fn();
  const api = createPersistentService({
    onPersistenceError,
    stateStore: memory.store
  });

  const session = await createSession(api);

  expect(session.status).toBe("active");
  expect(onPersistenceError).toHaveBeenCalledWith(
    expect.objectContaining({ message: "Stored Agent state snapshot is invalid" })
  );
  expect(memory.snapshot).toMatchObject({
    sessions: [{ session: { sessionId: session.sessionId } }],
    version: "liteasy.agent-state/v1"
  });
});
