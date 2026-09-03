import { expect, test } from "vitest";
import type { ArtifactTask } from "../app/features/artifacts/artifact.types";
import {
  createAgentActivityJournal,
  createAgentActivityToolCatalog,
  createAgentErrorEnvelope,
  executeAgentActivityTool,
  projectArtifactTaskActivity
} from "../app/features/agent-runtime/runtimeObservability";

function artifactTask(patch: Partial<ArtifactTask> = {}): ArtifactTask {
  return {
    id: "artifact-task-1",
    message: "正在检索薄读证据",
    progress: 48,
    stage: "thin_reading_retrieving_evidence",
    status: "running",
    type: "thin_reading",
    ...patch
  };
}

test("projects real artifact tasks into a bounded activity journal", () => {
  const journal = createAgentActivityJournal([
    artifactTask(),
    artifactTask({
      id: "artifact-task-2",
      message: "分析结果已保存",
      progress: 100,
      stage: "completed",
      status: "completed",
      type: "mindmap"
    })
  ], {
    generatedAt: "2026-09-01T00:00:00.000Z",
    scope: "active"
  });

  expect(journal).toEqual({
    activeTaskCount: 1,
    failedTaskCount: 0,
    generatedAt: "2026-09-01T00:00:00.000Z",
    summary: "当前有 1 个后台任务正在排队或运行。",
    tasks: [expect.objectContaining({
      currentStageLabel: "检索薄读证据",
      label: "薄读任务",
      progress: 48,
      status: "running",
      taskId: "artifact-task-1"
    })]
  });
});

test("normalizes artifact failures without exposing endpoints or raw diagnostics", () => {
  const task = projectArtifactTaskActivity(artifactTask({
    failure: {
      code: "service_unavailable",
      endpoint: "https://internal.example/v1/models?api_key=secret",
      failedStage: "thin_reading_retrieving_external_knowledge",
      message: "cloud_proxy 503 at https://internal.example trace_failure-17",
      occurredAt: "2026-09-01T00:00:00.000Z",
      recovery: ["检查网络后重试"],
      traceId: "trace_failure-17"
    },
    message: "Agent 分析失败：https://internal.example?api_key=secret",
    stage: "failed",
    status: "failed"
  }));

  expect(task.error).toEqual({
    category: "network",
    code: "SERVICE_UNAVAILABLE",
    diagnosticsRef: "trace_failure-17",
    recoveryActions: [{
      actionId: "artifact_recovery_1",
      label: "检查网络后重试",
      requiresConfirmation: false
    }],
    retryable: true,
    userImpact: "相关服务暂时不可用，请检查网络后重试。"
  });
  expect(JSON.stringify(task)).not.toContain("internal.example");
  expect(task.summary).toBe("相关服务暂时不可用，请检查网络后重试。");
});

test("exposes strict Manager tools for activity listing and task status", () => {
  const tools = createAgentActivityToolCatalog();
  expect(tools.map((tool) => tool.name)).toEqual([
    "liteasy_runtime_list_activity",
    "liteasy_runtime_get_task_status"
  ]);
  expect(tools.every((tool) => (
    tool.strict && tool.parameters.additionalProperties === false
  ))).toBe(true);

  expect(executeAgentActivityTool({
    arguments: { taskId: "artifact-task-1" },
    toolCallId: "activity-call-1",
    toolName: "liteasy_runtime_get_task_status"
  }, [artifactTask()])).toEqual({
    ok: true,
    task: expect.objectContaining({
      currentStage: "thin_reading_retrieving_evidence",
      taskId: "artifact-task-1"
    }),
    toolCallId: "activity-call-1"
  });
});

test("returns a model-readable error envelope when a task no longer exists", () => {
  const result = executeAgentActivityTool({
    arguments: { taskId: "missing-task" },
    toolCallId: "activity-call-2",
    toolName: "liteasy_runtime_get_task_status"
  }, []);

  expect(result).toEqual({
    error: expect.objectContaining({
      category: "context",
      code: "TASK_NOT_FOUND",
      recoveryActions: [expect.objectContaining({
        actionId: "follow_recovery_guidance"
      })],
      retryable: false
    }),
    ok: false
  });
});

test("classifies raw runtime failures into stable safe envelopes", () => {
  expect(createAgentErrorEnvelope({
    message: "cloud_proxy 429 rate limit trace_rate-1"
  })).toEqual({
    error: expect.objectContaining({
      category: "model",
      code: "MODEL_RATE_LIMITED",
      diagnosticsRef: "trace_rate-1",
      retryable: true
    }),
    ok: false
  });
});
