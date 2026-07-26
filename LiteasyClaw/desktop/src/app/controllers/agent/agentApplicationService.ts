import {
  createAgentCoreSession,
  type AgentCorePreparedTurn,
  type AgentCoreSession
} from "../../features/agent-core/agentCoreSession";
import type {
  AgentRuntimeContextView,
  AgentRuntimeEvent,
  HumanConfirmationRequest,
  RuntimeExecutionResult
} from "../../features/agent-runtime/agentRuntime.types";
import {
  AGENT_API_VERSION,
  type AgentApiError,
  type AgentApiResult,
  type AgentCapability,
  type AgentCitation,
  type AgentEvent,
  type AgentEventListener,
  type AgentEventPayload,
  type AgentJsonValue,
  type AgentPublicApi,
  type AgentRun,
  type AgentSession,
  type AgentWorkflowTraceRecord,
  type CreateAgentSessionRequest,
  type ResolveAgentConfirmationRequest,
  type SubmitAgentTurnRequest
} from "../../features/agent-api/agentApi.types";
import { getRegisteredActionMetadata } from "../../features/skills/actionRegistry";
import {
  projectWorkflowTraceEvents,
  summarizeWorkflowTraceEvents
} from "./agentWorkflowTraceProjection";
import {
  AGENT_STATE_SNAPSHOT_VERSION,
  parseAgentStateSnapshot,
  type AgentStateSnapshot,
  type AgentStateStore
} from "./agentStatePersistence";

export type ResolvedAgentContext = {
  runtimeContext?: AgentRuntimeContextView;
  value?: unknown;
};

export type AgentCommandExecutionInput = {
  context: ResolvedAgentContext;
  coreTurn: AgentCorePreparedTurn;
  request: SubmitAgentTurnRequest;
  reportProgress: (input: { phase: string; progress: number; summary: string }) => void;
  reportDelta: (delta: string) => void;
  reportSubtaskDelta: (input: { delta: string; label: string; subtaskId: string }) => void;
  runId: string;
  signal: AbortSignal;
};

export type AgentKnowledgeExecutionResult = {
  citations?: AgentCitation[];
  confidence?: number;
  message: string;
  metadata?: AgentJsonValue;
  ui?: AgentJsonValue;
};

export type AgentApplicationPorts = {
  createCoreSession?: () => AgentCoreSession;
  createId?: (prefix: "event" | "run" | "session") => string;
  executeCommand: (
    input: AgentCommandExecutionInput
  ) => Promise<RuntimeExecutionResult> | RuntimeExecutionResult;
  executeConfirmation?: (input: {
    confirmation: HumanConfirmationRequest;
    context: ResolvedAgentContext;
    request: ResolveAgentConfirmationRequest;
    runId: string;
    signal: AbortSignal;
  }) => Promise<RuntimeExecutionResult> | RuntimeExecutionResult;
  executeKnowledge: (input: AgentCommandExecutionInput) =>
    | AgentKnowledgeExecutionResult
    | Promise<AgentKnowledgeExecutionResult>;
  listCapabilities?: () => AgentCapability[];
  now?: () => Date;
  onPersistenceError?: (error: Error) => void;
  resolveContext?: (input: {
    request: SubmitAgentTurnRequest;
    session: AgentSession;
  }) => Promise<ResolvedAgentContext> | ResolvedAgentContext;
  stateStore?: AgentStateStore;
};

type StoredSession = {
  core: AgentCoreSession;
  listeners: Set<AgentEventListener>;
  requestRuns: Map<string, string>;
  runs: Map<string, AgentRun>;
  session: AgentSession;
};

type PendingConfirmation = {
  confirmation: HumanConfirmationRequest;
  context: ResolvedAgentContext;
  runId: string;
  sessionId: string;
};

function apiError(
  code: AgentApiError["code"],
  message: string,
  retryable = false,
  details?: AgentJsonValue
): AgentApiResult<never> {
  return {
    error: {
      code,
      details,
      message,
      retryable
    },
    ok: false
  };
}

function asJsonValue(value: unknown): AgentJsonValue {
  return JSON.parse(JSON.stringify(value)) as AgentJsonValue;
}

function asJsonRecord(value: Record<string, unknown>): Record<string, AgentJsonValue> {
  return asJsonValue(value) as Record<string, AgentJsonValue>;
}

function cloneAttachments(
  attachments: SubmitAgentTurnRequest["attachments"]
): SubmitAgentTurnRequest["attachments"] {
  return attachments ? asJsonValue(attachments) as SubmitAgentTurnRequest["attachments"] : undefined;
}

function stableJsonValue(value: AgentJsonValue): AgentJsonValue {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entry]) => [key, stableJsonValue(entry)])
    );
  }

  return value;
}

function sameAttachments(
  left: SubmitAgentTurnRequest["attachments"],
  right: SubmitAgentTurnRequest["attachments"]
) {
  return JSON.stringify(stableJsonValue(asJsonValue(left ?? []))) ===
    JSON.stringify(stableJsonValue(asJsonValue(right ?? [])));
}

function getRecordValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function getOptionalString(value: unknown, key: string): string | undefined {
  const candidate = getRecordValue(value, key);
  return typeof candidate === "string" ? candidate : undefined;
}

function getWorkflowTraceFromMetadata(metadata: AgentJsonValue | undefined): AgentJsonValue | undefined {
  const artifactWorkflow = getRecordValue(metadata, "artifactWorkflow");
  const workflowTrace = getRecordValue(artifactWorkflow, "workflowTrace");
  return getRecordValue(workflowTrace, "internalOnly") === true
    ? asJsonValue(workflowTrace)
    : undefined;
}

function isHumanConfirmation(event: AgentRuntimeEvent): event is HumanConfirmationRequest {
  return event.type === "confirmation_request" && "confirmationId" in event;
}

function isCancelled(run: AgentRun) {
  return run.status === "cancelled";
}

function mapPlan(event: Extract<AgentRuntimeEvent, { type: "plan_preview" }>) {
  return {
    actionIds: event.plan.actions.map((action) => action.actionId),
    planId: event.plan.planId,
    requiresConfirmation: event.plan.requiresConfirmation,
    riskLevel: event.plan.riskLevel,
    summary: event.plan.summary
  };
}

function mapRuntimeEvent(event: AgentRuntimeEvent): AgentEventPayload[] {
  switch (event.type) {
    case "plan_preview":
      return [{ plan: mapPlan(event), type: "plan.preview" }];
    case "progress_started":
      return [{ ...event, type: "progress.started" }];
    case "ui_dsl_ready":
      return [{ document: asJsonValue(event.document), type: "ui.render" }];
    case "assistant_reply":
      return [{ message: event.message, type: "assistant.message" }];
    case "clarification_request":
      return [
        {
          candidates: event.candidates?.map((candidate) => ({
            actionId: candidate.actionId,
            label: candidate.label
          })),
          kind: event.kind,
          missing: [...event.missing],
          question: event.question,
          type: "clarification.required"
        }
      ];
    case "confirmation_request":
      if (!isHumanConfirmation(event)) {
        return [
          {
            action: {
              actionId: event.action.actionId,
              arguments: asJsonRecord(event.action.payload)
            },
            type: "action.requested"
          }
        ];
      }
      return [
        {
          action: {
            actionId: event.action.actionId,
            arguments: asJsonRecord(event.action.payload)
          },
          confirmationId: event.confirmationId,
          summary: event.summary,
          traceId: event.traceId,
          type: "confirmation.required"
        }
      ];
    case "action_request":
      return [
        {
          action: {
            actionId: event.action.actionId,
            arguments: asJsonRecord(event.action.payload)
          },
          type: "action.requested"
        }
      ];
    case "action_failed":
      return [
        {
          actionId: event.action.actionId,
          message: event.message,
          recovery: event.recovery,
          type: "action.failed"
        }
      ];
    case "task_request":
      return [{ task: asJsonValue(event.task), type: "task.requested" }];
    case "task_created":
      return [{ task: asJsonValue(event.task), type: "task.created" }];
    case "artifact_request":
      return [{ artifact: asJsonValue(event.artifact), type: "artifact.requested" }];
    case "runtime_error":
      return [
        {
          message: event.message,
          recovery: event.recovery,
          type: "run.failed"
        }
      ];
  }
}

function defaultCapabilities(): AgentCapability[] {
  return getRegisteredActionMetadata().map((capability) => ({
    actionId: capability.actionId,
    estimatedCost: capability.estimatedCost,
    estimatedLatencyMs: capability.estimatedLatencyMs,
    inputSchema: asJsonValue(capability.inputSchema),
    label: capability.label,
    requiredContext: [...capability.requiredContext],
    requiresConfirmation: capability.requiresConfirmation,
    reversible: capability.reversible,
    riskLevel: capability.riskLevel
  }));
}

export function createAgentApplicationService(
  ports: AgentApplicationPorts
): AgentPublicApi {
  const sessions = new Map<string, StoredSession>();
  const workflowTraces: AgentWorkflowTraceRecord[] = [];
  const pendingConfirmations = new Map<string, PendingConfirmation>();
  const abortControllers = new Map<string, AbortController>();
  const now = ports.now ?? (() => new Date());
  let fallbackId = 0;
  let hydrationPromise: Promise<void> | null = null;
  let persistenceQueue = Promise.resolve();

  const createId = (prefix: "event" | "run" | "session") => {
    if (ports.createId) {
      return ports.createId(prefix);
    }
    fallbackId += 1;
    return `${prefix}-${now().getTime()}-${fallbackId}`;
  };

  const getStoredSession = (sessionId: string) => {
    const stored = sessions.get(sessionId);
    if (!stored) {
      return apiError("session_not_found", `Agent session not found: ${sessionId}`);
    }
    if (stored.session.status === "closed") {
      return apiError("session_closed", `Agent session is closed: ${sessionId}`);
    }
    return { data: stored, ok: true } as const;
  };

  const emit = (stored: StoredSession, run: AgentRun, payload: AgentEventPayload) => {
    const event = {
      ...payload,
      apiVersion: AGENT_API_VERSION,
      emittedAt: now().toISOString(),
      eventId: createId("event"),
      runId: run.runId,
      sequence: run.events.length + 1,
      sessionId: stored.session.sessionId
    } as AgentEvent;
    run.events.push(event);
    stored.listeners.forEach((listener) => listener(event));
    return event;
  };

  const createSnapshot = (): AgentStateSnapshot => ({
    pendingConfirmations: [...pendingConfirmations.values()].map((pending) => ({
      confirmation: asJsonValue(pending.confirmation) as unknown as HumanConfirmationRequest,
      runId: pending.runId,
      sessionId: pending.sessionId
    })),
    savedAt: now().toISOString(),
    sessions: [...sessions.values()].map((stored) => ({
      runs: [...stored.runs.values()].map((run) =>
        asJsonValue({
          ...run,
          // Delta events are transient transport data. The completed answer is persisted once
          // in assistant.message, avoiding a duplicate token log in the lightweight snapshot.
          events: run.events.filter(
            (event) =>
              event.type !== "assistant.delta" && event.type !== "analysis.subtask.delta"
          )
        }) as unknown as AgentRun
      ),
      session: asJsonValue(stored.session) as unknown as AgentSession
    })),
    version: AGENT_STATE_SNAPSHOT_VERSION,
    workflowTraces: workflowTraces.map((trace) =>
      asJsonValue(trace) as unknown as AgentWorkflowTraceRecord
    )
  });

  const reportPersistenceError = (error: unknown) => {
    const normalized =
      error instanceof Error ? error : new Error("Unknown Agent state persistence error");
    ports.onPersistenceError?.(normalized);
  };

  const persistState = async () => {
    if (!ports.stateStore) {
      return;
    }
    const snapshot = createSnapshot();
    persistenceQueue = persistenceQueue
      .then(() => ports.stateStore!.save(snapshot))
      .catch(reportPersistenceError);
    await persistenceQueue;
  };

  const hydrateState = async () => {
    if (!ports.stateStore) {
      return;
    }
    let loaded: unknown;
    try {
      loaded = await ports.stateStore.load();
    } catch (error) {
      reportPersistenceError(error);
      return;
    }
    if (!loaded) {
      return;
    }
    const snapshot = parseAgentStateSnapshot(loaded);
    if (!snapshot) {
      reportPersistenceError(new Error("Stored Agent state snapshot is invalid"));
      return;
    }

    let repairedInterruptedRun = false;
    snapshot.sessions.forEach(({ runs, session }) => {
      const stored: StoredSession = {
        core: ports.createCoreSession?.() ?? createAgentCoreSession(),
        listeners: new Set(),
        requestRuns: new Map(),
        runs: new Map(),
        session: { ...session }
      };
      runs.forEach((persistedRun) => {
        const run: AgentRun = {
          ...persistedRun,
          events: persistedRun.events.map((event) => ({ ...event })),
          input: { ...persistedRun.input }
        };
        stored.runs.set(run.runId, run);
        stored.requestRuns.set(run.idempotencyKey, run.runId);
        if (run.status === "running") {
          repairedInterruptedRun = true;
          run.status = "failed";
          run.completedAt = now().toISOString();
          emit(stored, run, {
            message: "Agent 运行因应用重启而中断。",
            recovery: "请重新提交该请求；原幂等键仍指向这次已中断运行。",
            type: "run.failed"
          });
        }
      });
      sessions.set(stored.session.sessionId, stored);
    });
    workflowTraces.splice(
      0,
      workflowTraces.length,
      ...(snapshot.workflowTraces ?? []).map((trace) =>
        asJsonValue(trace) as unknown as AgentWorkflowTraceRecord
      )
    );

    snapshot.pendingConfirmations.forEach((pending) => {
      const stored = sessions.get(pending.sessionId);
      const run = stored?.runs.get(pending.runId);
      if (
        stored?.session.status === "active" &&
        run?.status === "waiting_confirmation"
      ) {
        pendingConfirmations.set(pending.confirmation.confirmationId, {
          ...pending,
          context: {}
        });
      }
    });

    if (repairedInterruptedRun) {
      await persistState();
    }
  };

  const ensureHydrated = () => {
    if (!hydrationPromise) {
      hydrationPromise = hydrateState();
    }
    return hydrationPromise;
  };

  const finishRun = (
    stored: StoredSession,
    run: AgentRun,
    status: "completed" | "failed"
  ) => {
    if (run.status === "cancelled") {
      return;
    }
    run.status = status;
    run.completedAt = now().toISOString();
    if (status === "completed") {
      emit(stored, run, { type: "run.completed" });
    }
    abortControllers.delete(run.runId);
  };

  const applyRuntimeResult = (
    stored: StoredSession,
    run: AgentRun,
    context: ResolvedAgentContext,
    result: RuntimeExecutionResult
  ) => {
    let hasFailure = false;
    let hasClarification = false;
    let hasConfirmation = false;

    result.events.forEach((runtimeEvent) => {
      if (isHumanConfirmation(runtimeEvent)) {
        pendingConfirmations.set(runtimeEvent.confirmationId, {
          confirmation: runtimeEvent,
          context,
          runId: run.runId,
          sessionId: stored.session.sessionId
        });
        hasConfirmation = true;
      }
      if (runtimeEvent.type === "clarification_request") {
        hasClarification = true;
      }
      if (runtimeEvent.type === "runtime_error" || runtimeEvent.type === "action_failed") {
        hasFailure = true;
      }
      mapRuntimeEvent(runtimeEvent).forEach((event) => emit(stored, run, event));
    });

    if (hasConfirmation) {
      run.status = "waiting_confirmation";
    } else if (hasClarification) {
      run.status = "waiting_clarification";
    } else {
      finishRun(stored, run, hasFailure ? "failed" : "completed");
    }
  };

  const recordWorkflowTrace = (
    stored: StoredSession,
    run: AgentRun,
    metadata: AgentJsonValue | undefined
  ) => {
    const trace = getWorkflowTraceFromMetadata(metadata);
    if (!trace) {
      return;
    }
    const existingIndex = workflowTraces.findIndex(
      (record) => record.runId === run.runId && record.sessionId === stored.session.sessionId
    );
    const record: AgentWorkflowTraceRecord = {
      artifactId: getOptionalString(trace, "artifactId"),
      capturedAt: now().toISOString(),
      internalOnly: true,
      runId: run.runId,
      sessionId: stored.session.sessionId,
      trace,
      traceId: getOptionalString(trace, "traceId") ?? `workflow-trace:${run.runId}`,
      version: getOptionalString(trace, "version")
    };
    if (existingIndex >= 0) {
      workflowTraces[existingIndex] = record;
    } else {
      workflowTraces.push(record);
    }
  };

  const listScopedWorkflowTraces = (sessionId: string, runId?: string) =>
    workflowTraces.filter((trace) =>
      trace.sessionId === sessionId && (!runId || trace.runId === runId)
    );

  return {
    async createSession(input: CreateAgentSessionRequest) {
      await ensureHydrated();
      if (!input.consumer) {
        return apiError("invalid_request", "consumer is required");
      }
      if (input.clientSessionId) {
        const existing = [...sessions.values()].find(
          ({ session }) =>
            session.status === "active" &&
            session.clientSessionId === input.clientSessionId &&
            session.consumer === input.consumer &&
            session.principalId === input.principalId
        );
        if (existing) {
          return { data: existing.session, ok: true };
        }
      }
      const sessionId = createId("session");
      const session: AgentSession = {
        apiVersion: AGENT_API_VERSION,
        clientSessionId: input.clientSessionId,
        consumer: input.consumer,
        createdAt: now().toISOString(),
        principalId: input.principalId,
        sessionId,
        status: "active"
      };
      sessions.set(sessionId, {
        core: ports.createCoreSession?.() ?? createAgentCoreSession(),
        listeners: new Set(),
        requestRuns: new Map(),
        runs: new Map(),
        session
      });
      await persistState();
      return { data: session, ok: true };
    },

    async closeSession(sessionId: string) {
      await ensureHydrated();
      const result = getStoredSession(sessionId);
      if (!result.ok) {
        return result;
      }
      const stored = result.data;
      stored.runs.forEach((run) => {
        if (!["cancelled", "completed", "failed"].includes(run.status)) {
          abortControllers.get(run.runId)?.abort("session closed");
          pendingConfirmations.forEach((pending, confirmationId) => {
            if (pending.runId === run.runId) {
              pendingConfirmations.delete(confirmationId);
            }
          });
          run.status = "cancelled";
          run.completedAt = now().toISOString();
          emit(stored, run, { reason: "session closed", type: "run.cancelled" });
          abortControllers.delete(run.runId);
        }
      });
      stored.session.status = "closed";
      stored.listeners.clear();
      await persistState();
      return { data: stored.session, ok: true };
    },

    async submitTurn(request: SubmitAgentTurnRequest) {
      await ensureHydrated();
      const sessionResult = getStoredSession(request.sessionId);
      if (!sessionResult.ok) {
        return sessionResult;
      }
      if (!request.idempotencyKey.trim() || !request.input.message.trim()) {
        return apiError(
          "invalid_request",
          "idempotencyKey and input.message must be non-empty"
        );
      }

      const stored = sessionResult.data;
      const existingRunId = stored.requestRuns.get(request.idempotencyKey);
      if (existingRunId) {
        const existingRun = stored.runs.get(existingRunId)!;
        if (
          existingRun.input.message !== request.input.message ||
          existingRun.input.mode !== request.input.mode ||
          existingRun.input.artifactType !== request.input.artifactType ||
          !sameAttachments(existingRun.attachments, request.attachments)
        ) {
          return apiError(
            "idempotency_conflict",
            "idempotencyKey was already used for a different turn"
          );
        }
        return { data: existingRun, ok: true };
      }

      const runId = createId("run");
      const run: AgentRun = {
        apiVersion: AGENT_API_VERSION,
        attachments: cloneAttachments(request.attachments),
        createdAt: now().toISOString(),
        events: [],
        idempotencyKey: request.idempotencyKey,
        input: { ...request.input },
        runId,
        sessionId: request.sessionId,
        status: "running"
      };
      stored.runs.set(runId, run);
      stored.requestRuns.set(request.idempotencyKey, runId);
      const abortController = new AbortController();
      abortControllers.set(runId, abortController);
      emit(stored, run, {
        idempotencyKey: request.idempotencyKey,
        inputMode: request.input.mode,
        message: request.input.message,
        type: "run.started"
      });
      await persistState();

      try {
        const context = (await ports.resolveContext?.({
          request,
          session: stored.session
        })) ?? {};
        if (run.status === "cancelled") {
          await persistState();
          return { data: run, ok: true };
        }
        const prepared = stored.core.prepareTurn({
          message: request.input.message,
          mode: request.input.mode,
          runtimeContext: context.runtimeContext
        });
        if (!prepared.ok) {
          applyRuntimeResult(stored, run, context, {
            events: prepared.events,
            settingsChanged: false
          });
          await persistState();
          return { data: run, ok: true };
        }
        emit(stored, run, { type: "context.prepared" });

        const executionInput: AgentCommandExecutionInput = {
          context,
          coreTurn: prepared.turn,
          reportProgress(progress) {
            emit(stored, run, {
              phase: progress.phase,
              planId: runId,
              progress: progress.progress,
              summary: progress.summary,
              traceId: `trace-${runId}`,
              type: "progress.started"
            });
          },
          reportDelta(delta) {
            emit(stored, run, { delta, type: "assistant.delta" });
          },
          reportSubtaskDelta(input) {
            emit(stored, run, { ...input, type: "analysis.subtask.delta" });
          },
          request,
          runId,
          signal: abortController.signal
        };
        if (request.input.mode === "command") {
          const runtimeResult = await ports.executeCommand(executionInput);
          if (isCancelled(run)) {
            await persistState();
            return { data: run, ok: true };
          }
          stored.core.observeRuntimeTurn({
            events: runtimeResult.events,
            turn: prepared.turn
          });
          applyRuntimeResult(stored, run, context, runtimeResult);
        } else {
          const knowledgeResult = await ports.executeKnowledge(executionInput);
          if (isCancelled(run)) {
            await persistState();
            return { data: run, ok: true };
          }
          stored.core.observeKnowledgeTurn({
            summary: knowledgeResult.message,
            turn: prepared.turn
          });
          emit(stored, run, {
            citations: knowledgeResult.citations,
            confidence: knowledgeResult.confidence,
            message: knowledgeResult.message,
            metadata: knowledgeResult.metadata,
            type: "assistant.message"
          });
          recordWorkflowTrace(stored, run, knowledgeResult.metadata);
          if (knowledgeResult.ui) {
            emit(stored, run, {
              document: knowledgeResult.ui,
              type: "ui.render"
            });
          }
          finishRun(stored, run, "completed");
        }
      } catch (error) {
        if (!isCancelled(run)) {
          const message = error instanceof Error ? error.message : "Unknown agent execution error";
          emit(stored, run, { message, type: "run.failed" });
          finishRun(stored, run, "failed");
        }
      }
      await persistState();
      return { data: run, ok: true };
    },

    async resolveConfirmation(request: ResolveAgentConfirmationRequest) {
      await ensureHydrated();
      const sessionResult = getStoredSession(request.sessionId);
      if (!sessionResult.ok) {
        return sessionResult;
      }
      const pending = pendingConfirmations.get(request.confirmationId);
      if (!pending) {
        return apiError(
          "confirmation_not_found",
          `Confirmation not found: ${request.confirmationId}`
        );
      }
      if (pending.sessionId !== request.sessionId) {
        return apiError("confirmation_not_found", "Confirmation does not belong to this session");
      }
      const stored = sessionResult.data;
      const run = stored.runs.get(pending.runId);
      if (!run) {
        return apiError("run_not_found", `Agent run not found: ${pending.runId}`);
      }
      pendingConfirmations.delete(request.confirmationId);
      emit(stored, run, {
        confirmationId: request.confirmationId,
        decision: request.decision,
        type: "confirmation.resolved"
      });
      if (request.decision === "reject") {
        emit(stored, run, {
          message: `已取消：${pending.confirmation.plan.summary}`,
          type: "assistant.message"
        });
        finishRun(stored, run, "completed");
        await persistState();
        return { data: run, ok: true };
      }
      if (!ports.executeConfirmation) {
        emit(stored, run, {
          message: "This Agent host does not provide confirmation execution.",
          type: "run.failed"
        });
        finishRun(stored, run, "failed");
        await persistState();
        return { data: run, ok: true };
      }

      run.status = "running";
      const abortController = new AbortController();
      abortControllers.set(run.runId, abortController);
      await persistState();
      try {
        const runtimeResult = await ports.executeConfirmation({
          confirmation: pending.confirmation,
          context: pending.context,
          request,
          runId: run.runId,
          signal: abortController.signal
        });
        if (!isCancelled(run)) {
          applyRuntimeResult(stored, run, pending.context, runtimeResult);
        }
      } catch (error) {
        if (!isCancelled(run)) {
          emit(stored, run, {
            message: error instanceof Error ? error.message : "Confirmation execution failed",
            type: "run.failed"
          });
          finishRun(stored, run, "failed");
        }
      }
      await persistState();
      return { data: run, ok: true };
    },

    async cancelRun({ reason, runId, sessionId }) {
      await ensureHydrated();
      const sessionResult = getStoredSession(sessionId);
      if (!sessionResult.ok) {
        return sessionResult;
      }
      const stored = sessionResult.data;
      const run = stored.runs.get(runId);
      if (!run) {
        return apiError("run_not_found", `Agent run not found: ${runId}`);
      }
      if (["cancelled", "completed", "failed"].includes(run.status)) {
        return { data: run, ok: true };
      }
      abortControllers.get(runId)?.abort(reason);
      pendingConfirmations.forEach((pending, confirmationId) => {
        if (pending.runId === runId) {
          pendingConfirmations.delete(confirmationId);
        }
      });
      run.status = "cancelled";
      run.completedAt = now().toISOString();
      emit(stored, run, { reason, type: "run.cancelled" });
      abortControllers.delete(runId);
      await persistState();
      return { data: run, ok: true };
    },

    async getRun({ runId, sessionId }) {
      await ensureHydrated();
      const sessionResult = getStoredSession(sessionId);
      if (!sessionResult.ok) {
        return sessionResult;
      }
      const run = sessionResult.data.runs.get(runId);
      if (!run) {
        return apiError("run_not_found", `Agent run not found: ${runId}`);
      }
      return { data: run, ok: true };
    },

    async listWorkflowTraces({ runId, sessionId }) {
      await ensureHydrated();
      const sessionResult = getStoredSession(sessionId);
      if (!sessionResult.ok) {
        return sessionResult;
      }
      if (runId && !sessionResult.data.runs.has(runId)) {
        return apiError("run_not_found", `Agent run not found: ${runId}`);
      }
      return {
        data: listScopedWorkflowTraces(sessionId, runId)
          .map((trace) => asJsonValue(trace) as unknown as AgentWorkflowTraceRecord),
        ok: true
      };
    },

    async listWorkflowTraceEvents({ runId, sessionId }) {
      await ensureHydrated();
      const sessionResult = getStoredSession(sessionId);
      if (!sessionResult.ok) {
        return sessionResult;
      }
      if (runId && !sessionResult.data.runs.has(runId)) {
        return apiError("run_not_found", `Agent run not found: ${runId}`);
      }
      return {
        data: listScopedWorkflowTraces(sessionId, runId)
          .flatMap(projectWorkflowTraceEvents),
        ok: true
      };
    },

    async listWorkflowTraceSummaries({ runId, sessionId }) {
      await ensureHydrated();
      const sessionResult = getStoredSession(sessionId);
      if (!sessionResult.ok) {
        return sessionResult;
      }
      if (runId && !sessionResult.data.runs.has(runId)) {
        return apiError("run_not_found", `Agent run not found: ${runId}`);
      }
      return {
        data: listScopedWorkflowTraces(sessionId, runId)
          .map((trace) => summarizeWorkflowTraceEvents(projectWorkflowTraceEvents(trace))),
        ok: true
      };
    },

    async listCapabilities() {
      return { data: ports.listCapabilities?.() ?? defaultCapabilities(), ok: true };
    },

    subscribe(sessionId: string, listener: AgentEventListener) {
      const stored = sessions.get(sessionId);
      if (!stored || stored.session.status === "closed") {
        return () => undefined;
      }
      stored.listeners.add(listener);
      stored.runs.forEach((run) => {
        if (["waiting_clarification", "waiting_confirmation"].includes(run.status)) {
          run.events.forEach(listener);
        }
      });
      return () => stored.listeners.delete(listener);
    }
  };
}
