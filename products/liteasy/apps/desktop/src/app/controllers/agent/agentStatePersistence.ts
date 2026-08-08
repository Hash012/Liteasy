import type {
  AgentEvent,
  AgentJsonValue,
  AgentRun,
  AgentSession,
  AgentWorkflowTraceRecord
} from "../../features/agent-api/agentApi.types";
import type { HumanConfirmationRequest } from "../../features/agent-runtime/agentRuntime.types";

export const AGENT_STATE_SNAPSHOT_VERSION = "liteasy.agent-state/v1" as const;

export type PersistedAgentSession = {
  runs: AgentRun[];
  session: AgentSession;
};

export type PersistedAgentConfirmation = {
  confirmation: HumanConfirmationRequest;
  runId: string;
  sessionId: string;
};

export type AgentStateSnapshot = {
  pendingConfirmations: PersistedAgentConfirmation[];
  savedAt: string;
  sessions: PersistedAgentSession[];
  version: typeof AGENT_STATE_SNAPSHOT_VERSION;
  workflowTraces?: AgentWorkflowTraceRecord[];
};

export type AgentStateStore = {
  load: () => unknown | Promise<unknown>;
  save: (snapshot: AgentStateSnapshot) => void | Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentEvent(value: unknown): value is AgentEvent {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    typeof value.eventId === "string" &&
    typeof value.runId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.sequence === "number" &&
    typeof value.emittedAt === "string"
  );
}

function isAgentRun(value: unknown): value is AgentRun {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.idempotencyKey === "string" &&
    typeof value.status === "string" &&
    isRecord(value.input) &&
    typeof value.input.message === "string" &&
    typeof value.input.mode === "string" &&
    (value.input.artifactType === undefined ||
      ["comparison_table", "layered_graph", "mindmap", "ppt", "thin_reading", "tree"].includes(
        value.input.artifactType as string
      )) &&
    Array.isArray(value.events) &&
    value.events.every(isAgentEvent)
  );
}

function isAgentSession(value: unknown): value is AgentSession {
  return (
    isRecord(value) &&
    typeof value.sessionId === "string" &&
    typeof value.consumer === "string" &&
    typeof value.createdAt === "string" &&
    (value.status === "active" || value.status === "closed")
  );
}

function isJsonValue(value: unknown): value is AgentJsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

function isWorkflowTraceRecord(value: unknown): value is AgentWorkflowTraceRecord {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    typeof value.sessionId === "string" &&
    typeof value.traceId === "string" &&
    typeof value.capturedAt === "string" &&
    value.internalOnly === true &&
    isJsonValue(value.trace) &&
    (value.artifactId === undefined || typeof value.artifactId === "string") &&
    (value.version === undefined || typeof value.version === "string")
  );
}

function isConfirmation(value: unknown): value is HumanConfirmationRequest {
  return (
    isRecord(value) &&
    value.type === "confirmation_request" &&
    typeof value.confirmationId === "string" &&
    typeof value.traceId === "string" &&
    typeof value.summary === "string" &&
    isRecord(value.action) &&
    typeof value.action.actionId === "string" &&
    isRecord(value.plan) &&
    typeof value.plan.planId === "string" &&
    Array.isArray(value.plan.actions)
  );
}

export function parseAgentStateSnapshot(value: unknown): AgentStateSnapshot | null {
  if (
    !isRecord(value) ||
    value.version !== AGENT_STATE_SNAPSHOT_VERSION ||
    typeof value.savedAt !== "string" ||
    !Array.isArray(value.sessions) ||
    !Array.isArray(value.pendingConfirmations)
  ) {
    return null;
  }

  const sessions: PersistedAgentSession[] = [];
  for (const candidate of value.sessions) {
    const session = isRecord(candidate) ? candidate.session : undefined;
    const runs = isRecord(candidate) ? candidate.runs : undefined;
    if (
      !isRecord(candidate) ||
      !isAgentSession(session) ||
      !Array.isArray(runs) ||
      !runs.every(isAgentRun)
    ) {
      return null;
    }
    if (runs.some((run) => run.sessionId !== session.sessionId)) {
      return null;
    }
    sessions.push({
      runs,
      session
    });
  }

  const sessionIds = new Set(sessions.map(({ session }) => session.sessionId));
  const runIdsBySession = new Map(
    sessions.map(({ runs, session }) => [
      session.sessionId,
      new Set(runs.map((run) => run.runId))
    ])
  );
  const pendingConfirmations: PersistedAgentConfirmation[] = [];
  for (const candidate of value.pendingConfirmations) {
    if (
      !isRecord(candidate) ||
      typeof candidate.runId !== "string" ||
      typeof candidate.sessionId !== "string" ||
      !sessionIds.has(candidate.sessionId) ||
      !isConfirmation(candidate.confirmation)
    ) {
      return null;
    }
    pendingConfirmations.push({
      confirmation: candidate.confirmation,
      runId: candidate.runId,
      sessionId: candidate.sessionId
    });
  }

  const workflowTraces = value.workflowTraces === undefined
    ? undefined
    : Array.isArray(value.workflowTraces) &&
        value.workflowTraces.every((trace) =>
          isWorkflowTraceRecord(trace) &&
          sessionIds.has(trace.sessionId) &&
          runIdsBySession.get(trace.sessionId)?.has(trace.runId)
        )
      ? value.workflowTraces
      : null;
  if (workflowTraces === null) {
    return null;
  }

  return {
    pendingConfirmations,
    savedAt: value.savedAt,
    sessions,
    version: AGENT_STATE_SNAPSHOT_VERSION,
    workflowTraces
  };
}
