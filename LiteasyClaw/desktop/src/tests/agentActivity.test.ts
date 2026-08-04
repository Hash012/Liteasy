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
    emittedAt: "2026-07-31T00:00:00.000Z",
    eventId: `event-${payload.type}`,
    runId: "run-1",
    sequence: 1,
    sessionId: "session-1",
    ...payload
  } as AgentEvent;
}

describe("agent activity projection", () => {
  test("projects streaming generation, tool calls and outputs without exposing sensitive values", () => {
    let activity = createAgentActivity();
    activity = applyAgentActivityEvent(activity, event({ type: "run.started" }));
    activity = applyAgentActivityEvent(activity, event({
      delta: "正在生成。api_key: sk-this-must-not-be-visible-123456",
      type: "assistant.delta"
    }));
    activity = applyAgentActivityEvent(activity, event({
      action: {
        actionId: "artifact.generate",
        arguments: { apiKey: "do-not-render", artifactType: "mindmap" }
      },
      type: "action.requested"
    }));
    activity = applyAgentActivityEvent(activity, event({
      artifact: { artifactType: "mindmap" },
      type: "artifact.requested"
    }));

    expect(activity.statusText).toBe("产物已请求");
    expect(activity.generatedContent).toContain("[已隐藏]");
    expect(activity.generatedContent).not.toContain("sk-this-must-not-be-visible-123456");
    expect(activity.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "调用参数已隐藏。",
        kind: "tool",
        label: "工具调用：artifact.generate",
        status: "running"
      }),
      expect.objectContaining({ kind: "output", label: "产物已请求", status: "completed" })
    ]));
  });

  test("accumulates streamed subtask content under its readable label", () => {
    let activity = createAgentActivity();
    activity = applyAgentActivityEvent(activity, event({
      delta: "正在读取方法部分。",
      label: "方法证据",
      subtaskId: "methods",
      type: "analysis.subtask.delta"
    }));
    activity = applyAgentActivityEvent(activity, event({
      delta: " 已定位关键算法。",
      label: "方法证据",
      subtaskId: "methods",
      type: "analysis.subtask.delta"
    }));

    expect(activity.entries).toHaveLength(1);
    expect(activity.entries[0]).toMatchObject({
      content: "正在读取方法部分。 已定位关键算法。",
      label: "并行分析：方法证据",
      status: "running"
    });
  });

  test("omits protocol JSON from the user-facing activity projection", () => {
    expect(toUserVisibleAgentActivityText('{"runId":"internal-run","status":"working"}')).toBe("");
    expect(toUserVisibleAgentActivityText("```json\n{\"tool\":\"artifact.generate\"}\n```"))
      .toBe("");
    expect(toUserVisibleAgentActivityText("正在定位论文证据。")).toBe("正在定位论文证据。");
  });
});
