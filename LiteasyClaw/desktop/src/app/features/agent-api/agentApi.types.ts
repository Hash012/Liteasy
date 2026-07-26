export const AGENT_API_VERSION = "liteasy.agent/v1" as const;

export type AgentApiVersion = typeof AGENT_API_VERSION;

export type AgentConsumer = "cli" | "frontend" | "mcp";

export type AgentMode = "command" | "explain" | "qa";

export type AgentArtifactType = "comparison_table" | "layered_graph" | "mindmap" | "ppt" | "tree";

export type AgentRunStatus =
  | "cancelled"
  | "completed"
  | "failed"
  | "running"
  | "waiting_clarification"
  | "waiting_confirmation";

export type AgentJsonPrimitive = boolean | null | number | string;

export type AgentJsonValue =
  | AgentJsonPrimitive
  | AgentJsonValue[]
  | { [key: string]: AgentJsonValue };

export type AgentCitation = {
  paperId: string;
  page: number;
  snippet: string;
};

export type AgentCapability = {
  actionId: string;
  estimatedCost: "cloud_tokens" | "local_compute" | "none" | "paid_resource";
  estimatedLatencyMs: number;
  inputSchema: AgentJsonValue;
  label: string;
  requiredContext: string[];
  requiresConfirmation: boolean;
  reversible: boolean;
  riskLevel: "high" | "low" | "medium";
};

export type AgentAttachment = {
  mediaType?: string;
  metadata?: Record<string, AgentJsonValue>;
  name?: string;
  source: "artifact" | "paper" | "selection";
  uri: string;
};

export type CreateAgentSessionRequest = {
  clientSessionId?: string;
  consumer: AgentConsumer;
  metadata?: Record<string, AgentJsonValue>;
  principalId?: string;
};

export type AgentSession = {
  apiVersion: AgentApiVersion;
  clientSessionId?: string;
  consumer: AgentConsumer;
  createdAt: string;
  principalId?: string;
  sessionId: string;
  status: "active" | "closed";
};

export type SubmitAgentTurnRequest = {
  attachments?: AgentAttachment[];
  idempotencyKey: string;
  input: {
    artifactType?: AgentArtifactType;
    message: string;
    mode: AgentMode;
  };
  sessionId: string;
};

export type ResolveAgentConfirmationRequest = {
  confirmationId: string;
  decision: "approve" | "reject";
  sessionId: string;
};

export type AgentPlanSummary = {
  actionIds: string[];
  planId: string;
  requiresConfirmation: boolean;
  riskLevel: "high" | "low" | "medium";
  summary: string;
};

export type AgentConfirmationRequest = {
  action: { actionId: string; arguments: Record<string, AgentJsonValue> };
  confirmationId: string;
  summary: string;
  traceId: string;
};

export type AgentEventPayload =
  | { idempotencyKey: string; inputMode: AgentMode; message: string; type: "run.started" }
  | { type: "context.prepared" }
  | { delta: string; type: "assistant.delta" }
  | {
      delta: string;
      label: string;
      subtaskId: string;
      type: "analysis.subtask.delta";
    }
  | { plan: AgentPlanSummary; type: "plan.preview" }
  | {
      phase?: string;
      planId: string;
      progress?: number;
      summary: string;
      traceId: string;
      type: "progress.started";
    }
  | { document: AgentJsonValue; type: "ui.render" }
  | {
      citations?: AgentCitation[];
      confidence?: number;
      message: string;
      metadata?: AgentJsonValue;
      type: "assistant.message";
    }
  | {
      candidates?: Array<{ actionId: string; label: string }>;
      kind?: string;
      missing: string[];
      question: string;
      type: "clarification.required";
    }
  | (AgentConfirmationRequest & { type: "confirmation.required" })
  | {
      confirmationId: string;
      decision: "approve" | "reject";
      type: "confirmation.resolved";
    }
  | {
      action: { actionId: string; arguments: Record<string, AgentJsonValue> };
      type: "action.requested";
    }
  | {
      actionId: string;
      message: string;
      recovery?: string;
      type: "action.failed";
    }
  | { task: AgentJsonValue; type: "task.requested" }
  | { task: AgentJsonValue; type: "task.created" }
  | { artifact: AgentJsonValue; type: "artifact.requested" }
  | { message: string; recovery?: string; type: "run.failed" }
  | { reason?: string; type: "run.cancelled" }
  | { type: "run.completed" };

export type AgentEvent = AgentEventPayload & {
  apiVersion: AgentApiVersion;
  emittedAt: string;
  eventId: string;
  runId: string;
  sequence: number;
  sessionId: string;
};

export type AgentRun = {
  apiVersion: AgentApiVersion;
  attachments?: AgentAttachment[];
  completedAt?: string;
  createdAt: string;
  events: AgentEvent[];
  idempotencyKey: string;
  input: SubmitAgentTurnRequest["input"];
  runId: string;
  sessionId: string;
  status: AgentRunStatus;
};

export type AgentWorkflowTraceRecord = {
  artifactId?: string;
  capturedAt: string;
  internalOnly: true;
  runId: string;
  sessionId: string;
  trace: AgentJsonValue;
  traceId: string;
  version?: string;
};

export type AgentWorkflowTraceAuditEvent =
  | {
      artifactId?: string;
      emittedAt: string;
      eventId: string;
      internalOnly: true;
      runId: string;
      sessionId: string;
      traceId: string;
      type: "workflow.started";
      version?: string;
    }
  | {
      artifactId?: string;
      details?: AgentJsonValue;
      emittedAt: string;
      eventId: string;
      internalOnly: true;
      kind: string;
      runId: string;
      sessionId: string;
      status: "blocked" | "completed";
      stepId: string;
      summary: string;
      traceId: string;
      type: "workflow.step.blocked" | "workflow.step.completed";
    }
  | {
      artifactId?: string;
      emittedAt: string;
      eventId: string;
      internalOnly: true;
      runId: string;
      sessionId: string;
      status: "blocked" | "completed";
      traceId: string;
      type: "workflow.blocked" | "workflow.completed";
    };

export type AgentWorkflowTraceAuditSummary = {
  artifactId?: string;
  blockedStep?: {
    kind: string;
    stepId: string;
    summary: string;
  };
  completedStepCount: number;
  failedIssueCodes: string[];
  internalOnly: true;
  repairAttempted: boolean;
  repairSucceeded: boolean;
  runId: string;
  sessionId: string;
  status: "blocked" | "completed";
  stepCount: number;
  traceId: string;
};

export type AgentApiErrorCode =
  | "confirmation_not_found"
  | "execution_failed"
  | "idempotency_conflict"
  | "invalid_request"
  | "run_not_found"
  | "session_closed"
  | "session_not_found"
  | "unsupported_operation";

export type AgentApiError = {
  code: AgentApiErrorCode;
  details?: AgentJsonValue;
  message: string;
  retryable: boolean;
};

export type AgentApiResult<T> =
  | { data: T; ok: true }
  | { error: AgentApiError; ok: false };

export type AgentEventListener = (event: AgentEvent) => void;

export type AgentPublicApi = {
  cancelRun: (input: {
    reason?: string;
    runId: string;
    sessionId: string;
  }) => Promise<AgentApiResult<AgentRun>>;
  closeSession: (sessionId: string) => Promise<AgentApiResult<AgentSession>>;
  createSession: (
    input: CreateAgentSessionRequest
  ) => Promise<AgentApiResult<AgentSession>>;
  getRun: (input: {
    runId: string;
    sessionId: string;
  }) => Promise<AgentApiResult<AgentRun>>;
  listWorkflowTraces: (input: {
    runId?: string;
    sessionId: string;
  }) => Promise<AgentApiResult<AgentWorkflowTraceRecord[]>>;
  listWorkflowTraceEvents: (input: {
    runId?: string;
    sessionId: string;
  }) => Promise<AgentApiResult<AgentWorkflowTraceAuditEvent[]>>;
  listWorkflowTraceSummaries: (input: {
    runId?: string;
    sessionId: string;
  }) => Promise<AgentApiResult<AgentWorkflowTraceAuditSummary[]>>;
  listCapabilities: () => Promise<AgentApiResult<AgentCapability[]>>;
  resolveConfirmation: (
    input: ResolveAgentConfirmationRequest
  ) => Promise<AgentApiResult<AgentRun>>;
  submitTurn: (
    input: SubmitAgentTurnRequest
  ) => Promise<AgentApiResult<AgentRun>>;
  subscribe: (sessionId: string, listener: AgentEventListener) => () => void;
};
