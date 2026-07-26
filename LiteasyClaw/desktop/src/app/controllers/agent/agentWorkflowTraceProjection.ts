import type {
  AgentWorkflowTraceAuditEvent,
  AgentWorkflowTraceAuditSummary,
  AgentJsonValue,
  PublicWorkflowAuditSummary,
  AgentWorkflowTraceRecord
} from "../../features/agent-api/agentApi.types";

type WorkflowTraceStep = {
  completedAt: string;
  details?: AgentJsonValue;
  kind: string;
  startedAt: string;
  status: "blocked" | "completed";
  stepId: string;
  summary: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function readTraceSteps(record: AgentWorkflowTraceRecord): WorkflowTraceStep[] {
  const steps = isRecord(record.trace) ? record.trace.steps : undefined;
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps.filter((step): step is WorkflowTraceStep =>
    isRecord(step) &&
    typeof step.completedAt === "string" &&
    typeof step.kind === "string" &&
    typeof step.startedAt === "string" &&
    (step.status === "blocked" || step.status === "completed") &&
    typeof step.stepId === "string" &&
    typeof step.summary === "string" &&
    (step.details === undefined || isJsonValue(step.details))
  );
}

export function projectWorkflowTraceEvents(
  record: AgentWorkflowTraceRecord
): AgentWorkflowTraceAuditEvent[] {
  const steps = readTraceSteps(record);
  const firstStartedAt = steps[0]?.startedAt ?? record.capturedAt;
  const terminalStatus = steps.some((step) => step.status === "blocked")
    ? "blocked"
    : "completed";

  return [
    {
      artifactId: record.artifactId,
      emittedAt: firstStartedAt,
      eventId: `${record.traceId}:workflow.started`,
      internalOnly: true,
      runId: record.runId,
      sessionId: record.sessionId,
      traceId: record.traceId,
      type: "workflow.started",
      version: record.version
    },
    ...steps.map((step): AgentWorkflowTraceAuditEvent => ({
      artifactId: record.artifactId,
      details: step.details,
      emittedAt: step.completedAt,
      eventId: `${record.traceId}:step:${step.stepId}`,
      internalOnly: true,
      kind: step.kind,
      runId: record.runId,
      sessionId: record.sessionId,
      status: step.status,
      stepId: step.stepId,
      summary: step.summary,
      traceId: record.traceId,
      type: step.status === "blocked" ? "workflow.step.blocked" : "workflow.step.completed"
    })),
    {
      artifactId: record.artifactId,
      emittedAt: record.capturedAt,
      eventId: `${record.traceId}:workflow.${terminalStatus}`,
      internalOnly: true,
      runId: record.runId,
      sessionId: record.sessionId,
      status: terminalStatus,
      traceId: record.traceId,
      type: terminalStatus === "blocked" ? "workflow.blocked" : "workflow.completed"
    }
  ];
}

function readStringArrayDetail(details: AgentJsonValue | undefined, key: string): string[] {
  if (!isRecord(details)) {
    return [];
  }
  const value = details[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isTerminalWorkflowEvent(
  event: AgentWorkflowTraceAuditEvent
): event is Extract<AgentWorkflowTraceAuditEvent, {
  type: "workflow.blocked" | "workflow.completed";
}> {
  return event.type === "workflow.blocked" || event.type === "workflow.completed";
}

export function summarizeWorkflowTraceEvents(
  events: AgentWorkflowTraceAuditEvent[]
): AgentWorkflowTraceAuditSummary {
  const started = events.find((event) => event.type === "workflow.started");
  const terminal = [...events].reverse().find(isTerminalWorkflowEvent);
  const stepEvents = events.filter(
    (event): event is Extract<AgentWorkflowTraceAuditEvent, {
      type: "workflow.step.blocked" | "workflow.step.completed";
    }> =>
      event.type === "workflow.step.blocked" || event.type === "workflow.step.completed"
  );
  const blockedStep = stepEvents.find((event) => event.status === "blocked");
  const repairStep = stepEvents.find((event) => event.kind === "repair");
  const firstEvent = started ?? events[0];

  if (!firstEvent || !terminal) {
    throw new Error("workflow trace events must include start and terminal events");
  }

  return {
    artifactId: firstEvent.artifactId,
    blockedStep: blockedStep
      ? {
          kind: blockedStep.kind,
          stepId: blockedStep.stepId,
          summary: blockedStep.summary
        }
      : undefined,
    completedStepCount: stepEvents.filter((event) => event.status === "completed").length,
    failedIssueCodes: repairStep
      ? readStringArrayDetail(repairStep.details, "unresolvedIssueCodes")
      : [],
    internalOnly: true,
    repairAttempted: Boolean(repairStep),
    repairSucceeded: repairStep?.status === "completed",
    runId: firstEvent.runId,
    sessionId: firstEvent.sessionId,
    status: terminal.status,
    stepCount: stepEvents.length,
    traceId: firstEvent.traceId
  };
}

const publicIssueLabels: Record<string, string> = {
  critical_fact_without_source: "关键事实缺少来源",
  external_low_authority_main_claim: "主结论使用了低权威外部来源",
  invalid_structure: "产物结构不完整",
  missing_selected_paper_coverage: "选中文献证据覆盖不足",
  source_ref_not_found: "来源引用无法追溯"
};

function publicLabelForIssue(code: string) {
  return publicIssueLabels[code] ?? "存在需要复核的审计问题";
}

export function projectPublicWorkflowAuditSummary(
  summary: AgentWorkflowTraceAuditSummary
): PublicWorkflowAuditSummary {
  const checks: PublicWorkflowAuditSummary["checks"] = [
    {
      label: "任务范围",
      status: "passed"
    },
    {
      label: "证据与来源",
      status: summary.failedIssueCodes.includes("missing_selected_paper_coverage") ||
        summary.failedIssueCodes.includes("source_ref_not_found")
        ? "blocked"
        : "passed"
    },
    {
      label: "结构校验",
      status: summary.blockedStep?.kind === "verification" ? "blocked" : "passed",
      summary: summary.blockedStep?.kind === "verification"
        ? summary.blockedStep.summary
        : undefined
    }
  ];

  if (summary.repairAttempted) {
    checks.push({
      label: "自动修复",
      status: summary.repairSucceeded ? "passed" : "blocked",
      summary: summary.repairSucceeded
        ? "已完成安全自动修复并重新通过审计。"
        : "已尝试自动修复，但仍需人工复核。"
    });
  }

  return {
    auditLevel: "brief",
    checks,
    disclosure: "public",
    issueLabels: Array.from(new Set(summary.failedIssueCodes.map(publicLabelForIssue))),
    status: summary.status === "completed" ? "passed" : "blocked"
  };
}
