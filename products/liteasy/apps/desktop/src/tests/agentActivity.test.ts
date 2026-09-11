import { describe, expect, test } from "vitest";
import type { AgentEvent } from "../app/features/agent-api/agentApi.types";
import {
  applyAgentActivityEvent,
  createAgentActivity,
  toUserVisibleAgentActivityText
} from "../app/features/assistant/agentActivity";

function event(payload: Record<string, unknown>) {
  return {
    apiVersion: "liteasy.agent/v1",
    emittedAt: "2026-09-02T00:00:00.000Z",
    eventId: `event-${payload.type}`,
    runId: "run-1",
    sequence: 1,
    sessionId: "session-1",
    ...payload
  } as AgentEvent;
}

describe("agent activity projection", () => {
  test("starts the activity surface for the product built-in Manager", () => {
    const activity = applyAgentActivityEvent(createAgentActivity(), event({
      detail: "本轮由主 Agent 负责选择受控工作流并传递结果。",
      label: "主 Agent",
      runtime: "custom_manager",
      type: "execution.route"
    }));

    expect(activity.connectionText).toBe("主 Agent");
    expect(activity.statusText).toBe("主 Agent");
  });

  test("projects real SDK Manager summaries and tool events without exposing credentials", () => {
    let activity = applyAgentActivityEvent(createAgentActivity(), event({
      detail: "本轮由已注入的 OpenAI Agents SDK Manager 负责执行。",
      label: "OpenAI Agents SDK Manager",
      runtime: "openai_agents_sdk",
      type: "execution.route"
    }));
    activity = applyAgentActivityEvent(activity, event({
      activityId: "reasoning-1",
      detail: "需要查询当前布局。 api_key: sk-this-must-not-be-visible-123456",
      kind: "reasoning_summary",
      label: "判断所需操作",
      status: "completed",
      type: "manager.activity"
    }));
    activity = applyAgentActivityEvent(activity, event({
      activityId: "tool-1",
      detail: "读取布局状态",
      kind: "tool_call",
      label: "调用布局工具",
      status: "running",
      type: "manager.activity"
    }));

    expect(activity.connectionText).toBe("OpenAI Agents SDK Manager");
    expect(activity.statusText).toBe("调用布局工具");
    expect(activity.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "analysis", label: "判断所需操作", status: "completed" }),
      expect.objectContaining({ kind: "tool", label: "调用布局工具", status: "running" })
    ]));
    expect(activity.entries[0]?.content).toContain("[已隐藏]");
    expect(activity.entries[0]?.content).not.toContain("sk-this-must-not-be-visible-123456");
  });

  test("updates an SDK activity by its stable activity id", () => {
    let activity = createAgentActivity();
    activity = applyAgentActivityEvent(activity, event({
      activityId: "tool-1",
      detail: "正在调用",
      kind: "tool_call",
      label: "查询资料",
      status: "running",
      type: "manager.activity"
    }));
    activity = applyAgentActivityEvent(activity, event({
      activityId: "tool-1",
      detail: "返回 3 条结果",
      kind: "tool_result",
      label: "资料查询完成",
      status: "completed",
      type: "manager.activity"
    }));

    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      content: "返回 3 条结果",
      kind: "output",
      label: "资料查询完成",
      status: "completed"
    });
  });

  test("projects workflow progress into the expandable public activity log", () => {
    const initial = createAgentActivity();
    const projected = applyAgentActivityEvent(initial, event({
      phase: "retrieval",
      planId: "plan-1",
      progress: 70,
      summary: "核对引用与证据覆盖",
      traceId: "trace-1",
      type: "progress.started"
    }));

    expect(projected.entries).toEqual([expect.objectContaining({
      content: "核对引用与证据覆盖", label: "核对引用与证据覆盖", kind: "runtime", status: "running"
    })]);
  });

  test("omits protocol JSON from user-facing details", () => {
    expect(toUserVisibleAgentActivityText('{"runId":"internal-run","status":"working"}')).toBe("");
    expect(toUserVisibleAgentActivityText("```json\n{\"tool\":\"artifact.generate\"}\n```"))
      .toBe("");
    expect(toUserVisibleAgentActivityText("正在定位相关信息。")).toBe("正在定位相关信息。");
  });

  test("prefers the safe structured error over raw runtime diagnostics", () => {
    const activity = applyAgentActivityEvent(createAgentActivity(), event({
      error: {
        category: "network",
        code: "SERVICE_UNAVAILABLE",
        diagnosticsRef: "trace_safe-1",
        recoveryActions: [{
          actionId: "retry_service",
          label: "检查网络后重试",
          requiresConfirmation: false
        }],
        retryable: true,
        userImpact: "暂时无法回复，请稍后重试。"
      },
      message: "https://internal.example api_key=secret",
      type: "run.failed"
    }));

    expect(activity.entries[0]?.content).toBe("暂时无法回复，请稍后重试。");
    expect(activity.entries[0]?.content).not.toContain("检查网络后重试");
    expect(activity.entries[0]?.content).not.toContain("trace_safe-1");
    expect(activity.entries[0]?.content).not.toContain("internal.example");
  });
});
