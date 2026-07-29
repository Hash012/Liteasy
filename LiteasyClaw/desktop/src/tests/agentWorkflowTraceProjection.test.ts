import { expect, test } from "vitest";
import {
  projectPublicWorkflowAuditSummary,
  projectWorkflowTraceEvents,
  summarizeWorkflowTraceEvents
} from "../app/controllers/agent/agentWorkflowTraceProjection";
import type { AgentWorkflowTraceRecord } from "../app/features/agent-api/agentApi.types";

const record: AgentWorkflowTraceRecord = {
  artifactId: "artifact-mindmap-1",
  capturedAt: "2026-07-20T00:00:05.000Z",
  internalOnly: true,
  runId: "run-1",
  sessionId: "session-1",
  trace: {
    artifactId: "artifact-mindmap-1",
    internalOnly: true,
    runId: "run-1",
    steps: [
      {
        completedAt: "2026-07-20T00:00:01.000Z",
        details: { selectedPaperIds: ["paper-1"] },
        kind: "scope",
        startedAt: "2026-07-20T00:00:00.000Z",
        status: "completed",
        stepId: "1-scope",
        summary: "固定任务范围"
      },
      {
        completedAt: "2026-07-20T00:00:03.000Z",
        details: { errorCount: 1 },
        kind: "verification",
        startedAt: "2026-07-20T00:00:02.000Z",
        status: "blocked",
        stepId: "2-verification",
        summary: "确定性校验未通过"
      }
    ],
    traceId: "mindmap-workflow:run-1:artifact-mindmap-1",
    version: "liteasy.mindmap-workflow-trace/v1"
  },
  traceId: "mindmap-workflow:run-1:artifact-mindmap-1",
  version: "liteasy.mindmap-workflow-trace/v1"
};

test("projects an internal workflow trace ledger record into stable audit events", () => {
  const events = projectWorkflowTraceEvents(record);

  expect(events).toEqual([
    {
      artifactId: "artifact-mindmap-1",
      emittedAt: "2026-07-20T00:00:00.000Z",
      eventId: "mindmap-workflow:run-1:artifact-mindmap-1:workflow.started",
      internalOnly: true,
      runId: "run-1",
      sessionId: "session-1",
      traceId: "mindmap-workflow:run-1:artifact-mindmap-1",
      type: "workflow.started",
      version: "liteasy.mindmap-workflow-trace/v1"
    },
    {
      artifactId: "artifact-mindmap-1",
      details: { selectedPaperIds: ["paper-1"] },
      emittedAt: "2026-07-20T00:00:01.000Z",
      eventId: "mindmap-workflow:run-1:artifact-mindmap-1:step:1-scope",
      internalOnly: true,
      kind: "scope",
      runId: "run-1",
      sessionId: "session-1",
      status: "completed",
      stepId: "1-scope",
      summary: "固定任务范围",
      traceId: "mindmap-workflow:run-1:artifact-mindmap-1",
      type: "workflow.step.completed"
    },
    {
      artifactId: "artifact-mindmap-1",
      details: { errorCount: 1 },
      emittedAt: "2026-07-20T00:00:03.000Z",
      eventId: "mindmap-workflow:run-1:artifact-mindmap-1:step:2-verification",
      internalOnly: true,
      kind: "verification",
      runId: "run-1",
      sessionId: "session-1",
      status: "blocked",
      stepId: "2-verification",
      summary: "确定性校验未通过",
      traceId: "mindmap-workflow:run-1:artifact-mindmap-1",
      type: "workflow.step.blocked"
    },
    {
      artifactId: "artifact-mindmap-1",
      emittedAt: "2026-07-20T00:00:05.000Z",
      eventId: "mindmap-workflow:run-1:artifact-mindmap-1:workflow.blocked",
      internalOnly: true,
      runId: "run-1",
      sessionId: "session-1",
      status: "blocked",
      traceId: "mindmap-workflow:run-1:artifact-mindmap-1",
      type: "workflow.blocked"
    }
  ]);
});

test("summarizes projected workflow audit events for internal review", () => {
  const events = projectWorkflowTraceEvents({
    ...record,
    trace: {
      ...record.trace,
      steps: [
        ...(record.trace as { steps: unknown[] }).steps,
        {
          completedAt: "2026-07-20T00:00:04.000Z",
          details: {
            appliedRepairCount: 0,
            unresolvedIssueCodes: ["missing_selected_paper_coverage"]
          },
          kind: "repair",
          startedAt: "2026-07-20T00:00:03.000Z",
          status: "blocked",
          stepId: "3-repair",
          summary: "没有安全自动修复策略，保持草稿阻断"
        }
      ]
    }
  });

  expect(summarizeWorkflowTraceEvents(events)).toEqual({
    artifactId: "artifact-mindmap-1",
    blockedStep: {
      kind: "verification",
      stepId: "2-verification",
      summary: "确定性校验未通过"
    },
    completedStepCount: 1,
    failedIssueCodes: ["missing_selected_paper_coverage"],
    internalOnly: true,
    repairAttempted: true,
    repairSucceeded: false,
    runId: "run-1",
    sessionId: "session-1",
    status: "blocked",
    stepCount: 3,
    traceId: "mindmap-workflow:run-1:artifact-mindmap-1"
  });
});

test("projects an internal audit summary into a user-safe public summary", () => {
  const publicSummary = projectPublicWorkflowAuditSummary({
    artifactId: "artifact-mindmap-1",
    blockedStep: {
      kind: "verification",
      stepId: "2-verification",
      summary: "确定性校验未通过"
    },
    completedStepCount: 2,
    failedIssueCodes: ["missing_selected_paper_coverage"],
    internalOnly: true,
    repairAttempted: true,
    repairSucceeded: false,
    runId: "run-1",
    sessionId: "session-1",
    status: "blocked",
    stepCount: 4,
    traceId: "mindmap-workflow:run-1:artifact-mindmap-1"
  });

  expect(publicSummary).toEqual({
    auditLevel: "brief",
    checks: [
      {
        label: "任务范围",
        status: "passed"
      },
      {
        label: "证据与来源",
        status: "blocked"
      },
      {
        label: "结构校验",
        status: "blocked",
        summary: "确定性校验未通过"
      },
      {
        label: "自动修复",
        status: "blocked",
        summary: "已尝试自动修复，但仍需人工复核。"
      }
    ],
    disclosure: "public",
    issueLabels: ["选中文献证据覆盖不足"],
    status: "blocked"
  });
  expect(JSON.stringify(publicSummary)).not.toContain("traceId");
  expect(JSON.stringify(publicSummary)).not.toContain("stepId");
  expect(JSON.stringify(publicSummary)).not.toContain("run-1");
  expect(JSON.stringify(publicSummary)).not.toContain("session-1");
});
