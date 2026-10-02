import { contextRefSchema, redactDiagnostic } from "../../features/context/objectContext";
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
  type AgentExecutionRuntime,
  type AgentJsonValue,
  type AgentManagerActivity,
  type AgentPublicApi,
  type AgentRun,
  type AgentSession,
  type AgentWorkflowTraceRecord,
  type CreateAgentSessionRequest,
  type ResolveAgentConfirmationRequest,
  type SubmitAgentTurnRequest
} from "../../features/agent-api/agentApi.types";
import { createAgentErrorEnvelope } from "../../features/agent-runtime/runtimeObservability";
import { getRegisteredActionMetadata } from "../../features/skills/actionRegistry";
import {
  projectPublicWorkflowAuditSummary,
  projectWorkflowTraceEvents,
  summarizeWorkflowTraceEvents
} from "./agentWorkflowTraceProjection";
import {
  AGENT_STATE_SNAPSHOT_VERSION,
  inspectAgentStateSnapshot,
  type AgentStateSnapshot,
  type AgentStateStore
} from "./agentStatePersistence";
import {
  compactAssistantConversationHistory,
  type AssistantConversationTurn
} from "../../features/assistant/assistantConversationContext";

export type ResolvedAgentContext = {
  objectSnapshot?: import("../../features/context/objectContext").ContextSnapshot;
  runtimeContext?: AgentRuntimeContextView;
  value?: unknown;
};

export type AgentCommandExecutionInput = {
  conversationHistory: AssistantConversationTurn[];
  context: ResolvedAgentContext;
  coreTurn: AgentCorePreparedTurn;
  request: SubmitAgentTurnRequest;
  reportProgress: (input: { phase: string; progress: number; summary: string }) => void;
  reportDelta: (delta: string) => void;
  reportAssetWrite?: (receipt: AgentJsonValue) => void;
  reportContextUsage?: (usage: { usedTokens: number; maxTokens: number; estimated: boolean }) => void;
  reportManagerActivity: (input: AgentManagerActivity) => void;
  reportSubtaskDelta: (input: { delta: string; label: string; subtaskId: string }) => void;
  runId: string;
  signal: AbortSignal;
};

export function collectAgentConversationHistory(
  runs: Iterable<AgentRun>,
  currentRunId?: string
) {
  const turns: AssistantConversationTurn[] = [];
  for (const run of runs) {
    if (run.runId === currentRunId || run.status !== "completed") continue;
    let assistant = "";
    for (const event of run.events) {
      if (event.type === "assistant.message") assistant = event.message;
    }
    if (assistant.trim() && run.input.message.trim()) {
      turns.push({ assistant, user: run.input.message });
    }
  }
  return compactAssistantConversationHistory(turns);
}

export type AgentKnowledgeExecutionResult = {
  citations?: AgentCitation[];
  confidence?: number;
  message: string;
  metadata?: AgentJsonValue;
  ui?: AgentJsonValue;
};

export type AgentManagerExecutionResult =
  | {
      kind: "knowledge";
      result: AgentKnowledgeExecutionResult;
    }
  | {
      kind: "runtime";
      result: RuntimeExecutionResult;
    };

export type AgentApplicationPorts = {
  supportsObjectContext?: boolean;
  getPrincipalId?: () => string;
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
  executeManagerTurn?: (
    input: AgentCommandExecutionInput
  ) => AgentManagerExecutionResult | Promise<AgentManagerExecutionResult>;
  managerRuntime?: AgentExecutionRuntime;
  listCapabilities?: () => AgentCapability[];
  now?: () => Date;
  onPersistenceError?: (error: Error) => void;
  onConversationCompleted?: (input: { message: string; sessionId: string; requestId: string }) => void;
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

function createRunFailureEvent(message: string, recovery?: string): AgentEventPayload {
  return {
    error: createAgentErrorEnvelope({ message, recovery }).error,
    message,
    recovery,
    type: "run.failed"
  };
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
          error: createAgentErrorEnvelope({
            code: "ACTION_EXECUTION_FAILED",
            message: event.message,
            recovery: event.recovery
          }).error,
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
      return [createRunFailureEvent(event.message, event.recovery)];
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
): AgentPublicApi & { dispose(): void } {
  const sessions = new Map<string, StoredSession>();
  const workflowTraces: AgentWorkflowTraceRecord[] = [];
  const pendingConfirmations = new Map<string, PendingConfirmation>();
  const abortControllers = new Map<string, AbortController>();
  const now = ports.now ?? (() => new Date());
  let fallbackId = 0;
  let hydrationPromise: Promise<void> | null = null;
  let persistenceQueue = Promise.resolve();
  let persistenceBlocked: string | null = null;
  const persistenceError = () => apiError("execution_failed", persistenceBlocked ?? "保存失败，原数据已保留。请检查存储后重新打开。");

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
    if (ports.getPrincipalId && stored.session.principalId !== ports.getPrincipalId()) return apiError("session_not_found", "Session is not available for this account");
    if (stored.session.status === "closed") {
      return apiError("session_closed", `Agent session is closed: ${sessionId}`);
    }
    return { data: stored, ok: true } as const;
  };

  const emit = (stored: StoredSession, run: AgentRun, payload: AgentEventPayload) => {
    if (run.status === "cancelled" && payload.type !== "run.cancelled" && payload.type !== "asset.written") return;
    const event = {
      ...payload,
      apiVersion: AGENT_API_VERSION,
      emittedAt: now().toISOString(),
      eventId: createId("event"),
      runId: run.runId,
      sequence: (run.events.at(-1)?.sequence ?? 0) + 1,
      sessionId: stored.session.sessionId
    } as AgentEvent;
    // Reasoning updates contain the full current text. Keep only the latest state
    // per activity in replay/history; live subscribers still receive every update.
    if (event.type === "manager.activity" && event.kind === "reasoning_summary") {
      const previous = run.events.findIndex((item) => item.type === "manager.activity" &&
        item.kind === "reasoning_summary" && item.activityId === event.activityId);
      if (previous !== -1) run.events.splice(previous, 1);
    }
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

  const persistState = async (): Promise<boolean> => {
    if (persistenceBlocked) return false;
    if (!ports.stateStore) return true;
    const snapshot = createSnapshot();
    // Recheck inside the queue: a prior write may have failed while this was queued.
    persistenceQueue = persistenceQueue.then(async () => {
      if (persistenceBlocked) return;
      try { await ports.stateStore!.save(snapshot); }
      catch (error) {
        persistenceBlocked = "会话保存失败，已暂停后续任务。已执行操作可能已生效，请检查回执与存储后重新打开，不要直接重试写入。";
        reportPersistenceError(error);
      }
    });
    await persistenceQueue;
    return persistenceBlocked === null;
  };

  const hydrateState = async () => {
    if (!ports.stateStore) {
      return;
    }
    let loaded: unknown;
    try {
      loaded = await ports.stateStore.load();
    } catch (error) {
      persistenceBlocked = "会话读取失败，已进入只读保护，原数据未修改。请检查存储后重新打开。";
      reportPersistenceError(error);
      return;
    }
    if (loaded === null || loaded === undefined) {
      return;
    }
    const { snapshot, issues } = inspectAgentStateSnapshot(loaded);
    if (issues.length) {
      persistenceBlocked = "会话格式不兼容或部分记录损坏，已进入只读保护，原数据完整保留。请先备份，再使用兼容版本恢复。";
      reportPersistenceError(new Error(`${persistenceBlocked} 位置：${issues.slice(0, 20).join(", ")}`));
    }
    if (!snapshot) return;

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
          emit(stored, run, createRunFailureEvent(
            "Agent 运行因应用重启而中断。",
            "请重新提交该请求；原幂等键仍指向这次已中断运行。"
          ));
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

    if (repairedInterruptedRun && !persistenceBlocked) {
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
    dispose() {
      for (const stored of sessions.values()) {
        stored.listeners.clear();
        for (const run of stored.runs.values()) {
          if (!["completed", "failed", "cancelled"].includes(run.status)) {
            abortControllers.get(run.runId)?.abort("account changed");
            run.status = "cancelled";
            run.completedAt = now().toISOString();
          }
        }
      }
      pendingConfirmations.clear();
      abortControllers.clear();
    },
    async createSession(input: CreateAgentSessionRequest) {
      await ensureHydrated();
      if (ports.getPrincipalId) input = { ...input, principalId: ports.getPrincipalId() };
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
      if (persistenceBlocked) return persistenceError();
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
      if (!(await persistState())) return persistenceError();
      return { data: session, ok: true };
    },

    async closeSession(sessionId: string) {
      await ensureHydrated();
      if (persistenceBlocked) return persistenceError();
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
      if (!(await persistState())) return persistenceError();
      return { data: stored.session, ok: true };
    },

    async submitTurn(request: SubmitAgentTurnRequest) {
      await ensureHydrated();
      if (persistenceBlocked) return persistenceError();
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
      if (request.input.systemPrompt !== undefined && (typeof request.input.systemPrompt !== "string" || request.input.systemPrompt.length > 4000)) {
        return apiError("invalid_request", "系统提示词最多 4,000 字符。");
      }
      if (request.input.thinkingDepth !== undefined && !["quick", "balanced", "deliberate"].includes(request.input.thinkingDepth)) {
        return apiError("invalid_request", "Unsupported thinking depth");
      }

      if (request.contextRefs) {
        try {
          request = { ...request, contextRefs: request.contextRefs.map((raw) => {
            const ref = contextRefSchema.parse(raw);
            return "type" in ref && ref.type === "diagnostic"
              ? { ...ref, code: redactDiagnostic(ref.code), stage: redactDiagnostic(ref.stage), message: redactDiagnostic(ref.message) }
              : ref;
          }) };
        } catch {
          return apiError("invalid_request", "Invalid object context reference");
        }
      }
      if (request.contextRefs?.length && (!ports.supportsObjectContext || request.input.mode === "command" || request.attachments?.length)) {
        return apiError("unsupported_operation", "当前服务不支持此对象上下文请求；请勿混用旧附件或命令模式。");
      }
      const stored = sessionResult.data;
      const existingRunId = stored.requestRuns.get(request.idempotencyKey);
      if (existingRunId) {
        const existingRun = stored.runs.get(existingRunId)!;
        if (
          existingRun.input.message !== request.input.message ||
          existingRun.input.mode !== request.input.mode ||
          existingRun.input.thinkingDepth !== request.input.thinkingDepth ||
          existingRun.input.systemPrompt !== request.input.systemPrompt ||
          existingRun.input.artifactType !== request.input.artifactType ||
          JSON.stringify(existingRun.contextRefs) !== JSON.stringify(request.contextRefs) ||
          existingRun.contextPurpose !== request.contextPurpose ||
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
        contextRefs: request.contextRefs ? JSON.parse(JSON.stringify(request.contextRefs)) : undefined,
        contextPurpose: request.contextPurpose,
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
      if (!(await persistState())) return persistenceError();

      try {
        const context = (await ports.resolveContext?.({
          request,
          session: stored.session
        })) ?? {};
        if (run.status === "cancelled") {
          if (!(await persistState())) return persistenceError();
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
          if (!(await persistState())) return persistenceError();
          return { data: run, ok: true };
        }
        if (context.objectSnapshot) {
          run.contextSnapshotId = context.objectSnapshot.snapshotId;
          if (context.objectSnapshot.entries.every((entry) => "objectId" in entry.ref)) run.contextSnapshot = context.objectSnapshot;
        }
        emit(stored, run, { type: "context.prepared", snapshotId: run.contextSnapshotId });

        const executionInput: AgentCommandExecutionInput = {
          conversationHistory: collectAgentConversationHistory(stored.runs.values(), runId),
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
          reportAssetWrite(receipt) {
            emit(stored, run, { receipt, type: "asset.written" });
          },
          reportContextUsage(usage) {
            emit(stored, run, { ...usage, type: "context.usage" });
          },
          reportDelta(delta) {
            emit(stored, run, { delta, type: "assistant.delta" });
          },
          reportManagerActivity(input) {
            emit(stored, run, { ...input, type: "manager.activity" });
          },
          reportSubtaskDelta(input) {
            emit(stored, run, { ...input, type: "analysis.subtask.delta" });
          },
          request,
          runId,
          signal: abortController.signal
        };
        const runtime = ports.executeManagerTurn
          ? ports.managerRuntime ?? "custom_manager"
          : request.input.mode === "command"
            ? "liteasy_command_workflow"
            : "liteasy_knowledge_workflow";
        const runtimePresentation = runtime === "openai_agents_sdk"
          ? {
              detail: "本轮由主 Agent 负责调度能力、子任务与最终输出。",
              label: "主 Agent"
            }
          : runtime === "custom_manager"
            ? {
                detail: "本轮由主 Agent 负责选择受控工作流并传递结果。",
                label: "主 Agent"
              }
            : runtime === "liteasy_command_workflow"
              ? {
                  detail: "本轮未经过 Manager Agent，直接进入 Liteasy 语义命令与受控动作工作流。",
                  label: "Liteasy 命令工作流"
                }
              : {
                  detail: "本轮未经过 Manager Agent，直接进入 Liteasy 文献检索与模型回答工作流。",
                  label: "Liteasy 知识工作流"
                };
        emit(stored, run, {
          ...runtimePresentation,
          runtime,
          type: "execution.route"
        });
        const managerResult = ports.executeManagerTurn
          ? await ports.executeManagerTurn(executionInput)
          : undefined;
        if (managerResult?.kind === "runtime" || (!managerResult && request.input.mode === "command")) {
          const runtimeResult = managerResult?.kind === "runtime"
            ? managerResult.result
            : await ports.executeCommand(executionInput);
          if (isCancelled(run)) {
            if (!(await persistState())) return persistenceError();
            return { data: run, ok: true };
          }
          stored.core.observeRuntimeTurn({
            events: runtimeResult.events,
            turn: prepared.turn
          });
          applyRuntimeResult(stored, run, context, runtimeResult);
        } else {
          const knowledgeResult = managerResult?.kind === "knowledge"
            ? managerResult.result
            : await ports.executeKnowledge(executionInput);
          if (isCancelled(run)) {
            if (!(await persistState())) return persistenceError();
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
          emit(stored, run, createRunFailureEvent(message));
          finishRun(stored, run, "failed");
        }
      }
      if (!(await persistState())) return persistenceError();
      if (run.status === "completed") {
        // Side work receives only the submitted user text, never tool output or attachments.
        try { ports.onConversationCompleted?.({ message: request.input.message, sessionId: request.sessionId, requestId: run.runId }); }
        catch { /* Optional personalization cannot change a completed answer. */ }
      }
      return { data: run, ok: true };
    },

    async resolveConfirmation(request: ResolveAgentConfirmationRequest) {
      await ensureHydrated();
      if (persistenceBlocked) return persistenceError();
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
        if (!(await persistState())) return persistenceError();
        return { data: run, ok: true };
      }
      if (!ports.executeConfirmation) {
        emit(stored, run, createRunFailureEvent(
          "This Agent host does not provide confirmation execution."
        ));
        finishRun(stored, run, "failed");
        if (!(await persistState())) return persistenceError();
        return { data: run, ok: true };
      }

      run.status = "running";
      const abortController = new AbortController();
      abortControllers.set(run.runId, abortController);
      if (!(await persistState())) return persistenceError();
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
          emit(stored, run, createRunFailureEvent(
            error instanceof Error ? error.message : "Confirmation execution failed"
          ));
          finishRun(stored, run, "failed");
        }
      }
      if (!(await persistState())) return persistenceError();
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
      if (!(await persistState())) return persistenceError();
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

    async listPublicWorkflowAuditSummaries({ runId, sessionId }) {
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
          .map((trace) => projectPublicWorkflowAuditSummary(
            summarizeWorkflowTraceEvents(projectWorkflowTraceEvents(trace))
          )),
        ok: true
      };
    },

    async listCapabilities() {
      const capabilities = [...(ports.listCapabilities?.() ?? defaultCapabilities())];
      if (ports.supportsObjectContext) capabilities.push({
        actionId: "context.resolve",
        label: "询问所选内容",
        estimatedCost: "cloud_tokens",
        estimatedLatencyMs: 1000,
        inputSchema: { type: "object", properties: { contextRefs: { type: "array" } } },
        requiredContext: [],
        requiresConfirmation: false,
        reversible: false,
        riskLevel: "low"
      });
      return { data: capabilities, ok: true };
    },

    subscribe(sessionId: string, listener: AgentEventListener) {
      const stored = sessions.get(sessionId);
      if (!stored || stored.session.status === "closed" || (ports.getPrincipalId && stored.session.principalId !== ports.getPrincipalId())) {
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
