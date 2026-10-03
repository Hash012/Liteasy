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
  expiresAt?: string;
  approvalBinding?: string;
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
    (value.input.systemPrompt === undefined || typeof value.input.systemPrompt === "string" && value.input.systemPrompt.length <= 4000) &&
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

export type AgentStateInspection = {
  snapshot: AgentStateSnapshot | null;
  issues: string[];
};

/** Recover independently valid records for reading. Any issue forbids automatic writes.
 * The store retains its original bytes/value; diagnostics never include user content.
 */
export function inspectAgentStateSnapshot(value: unknown): AgentStateInspection {
  if (!isRecord(value) || value.version !== AGENT_STATE_SNAPSHOT_VERSION) {
    return { snapshot: null, issues: ["version"] };
  }
  if (typeof value.savedAt !== "string" || !Array.isArray(value.sessions) || !Array.isArray(value.pendingConfirmations)) {
    return { snapshot: null, issues: ["snapshot"] };
  }
  const issues: string[] = [];
  const sessions: PersistedAgentSession[] = [];
  const sessionIds = new Set<string>();
  value.sessions.forEach((candidate, index) => {
    const path = `sessions[${index}]`;
    if (!isRecord(candidate) || !isAgentSession(candidate.session) || sessionIds.has(candidate.session.sessionId)) {
      issues.push(path);
      return;
    }
    const session = candidate.session;
    sessionIds.add(session.sessionId);
    const runs: AgentRun[] = [];
    const runIds = new Set<string>();
    const requestIds = new Set<string>();
    if (!Array.isArray(candidate.runs)) issues.push(`${path}.runs`);
    else candidate.runs.forEach((run, runIndex) => {
      if (!isAgentRun(run) || run.sessionId !== session.sessionId || runIds.has(run.runId) || requestIds.has(run.idempotencyKey) ||
        !["running", "waiting_confirmation", "waiting_clarification", "completed", "failed", "cancelled"].includes(run.status) ||
        run.events.some(event => event.runId !== run.runId || event.sessionId !== session.sessionId)) {
        issues.push(`${path}.runs[${runIndex}]`);
        return;
      }
      runIds.add(run.runId);
      requestIds.add(run.idempotencyKey);
      runs.push(run);
    });
    sessions.push({ session, runs });
  });
  const runIdsBySession = new Map(sessions.map(({ session, runs }) => [session.sessionId, new Set(runs.map(run => run.runId))]));
  const pendingConfirmations: PersistedAgentConfirmation[] = [];
  const confirmationIds = new Set<string>();
  value.pendingConfirmations.forEach((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.runId !== "string" || typeof candidate.sessionId !== "string" ||
      !runIdsBySession.get(candidate.sessionId)?.has(candidate.runId) || !isConfirmation(candidate.confirmation) ||
      confirmationIds.has(candidate.confirmation.confirmationId)) {
      issues.push(`pendingConfirmations[${index}]`);
      return;
    }
    confirmationIds.add(candidate.confirmation.confirmationId);
    pendingConfirmations.push({ confirmation: candidate.confirmation, runId: candidate.runId, sessionId: candidate.sessionId,
      ...(typeof candidate.expiresAt === "string" ? { expiresAt: candidate.expiresAt } : {}),
      ...(typeof candidate.approvalBinding === "string" ? { approvalBinding: candidate.approvalBinding } : {}) });
  });
  let workflowTraces: AgentWorkflowTraceRecord[] | undefined;
  if (value.workflowTraces !== undefined) {
    workflowTraces = [];
    if (!Array.isArray(value.workflowTraces)) issues.push("workflowTraces");
    else value.workflowTraces.forEach((trace, index) => {
      if (!isWorkflowTraceRecord(trace) || !runIdsBySession.get(trace.sessionId)?.has(trace.runId)) issues.push(`workflowTraces[${index}]`);
      else workflowTraces!.push(trace);
    });
  }
  return { snapshot: { pendingConfirmations, savedAt: value.savedAt, sessions, version: AGENT_STATE_SNAPSHOT_VERSION, workflowTraces }, issues };
}

/** Strict consumers still reject anything that needs recovery. */
export function parseAgentStateSnapshot(value: unknown): AgentStateSnapshot | null {
  const inspection = inspectAgentStateSnapshot(value);
  return inspection.issues.length ? null : inspection.snapshot;
}
