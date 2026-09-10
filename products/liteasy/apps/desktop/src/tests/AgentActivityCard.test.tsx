import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { AgentEvent } from "../app/features/agent-api/agentApi.types";
import { AgentActivityCard } from "../app/features/assistant/AgentActivityCard";
import {
  applyAgentActivityEvent,
  completeAgentActivity,
  createAgentActivity
} from "../app/features/assistant/agentActivity";

function event(payload: Record<string, unknown>) {
  return {
    apiVersion: "liteasy.agent/v1",
    emittedAt: "2026-09-02T00:00:00.000Z",
    eventId: `event-${payload.type}`,
    runId: "run-activity",
    sequence: 1,
    sessionId: "session-activity",
    ...payload
  } as AgentEvent;
}

test("keeps the running step expanded and collapses all steps when the result completes", async () => {
  const user = userEvent.setup();
  const activity = applyAgentActivityEvent(createAgentActivity(), event({
    activityId: "reasoning-1",
    detail: "先判断用户意图，再选择工具。",
    kind: "reasoning_summary",
    label: "判断用户意图",
    status: "running",
    type: "manager.activity"
  }));
  const { rerender } = render(<AgentActivityCard activity={activity} />);

  const runningStep = screen.getByRole("button", { name: "分析 判断用户意图" });
  expect(runningStep).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("先判断用户意图，再选择工具。")).toBeInTheDocument();

  rerender(<AgentActivityCard activity={completeAgentActivity(activity, "completed")} />);
  expect(runningStep).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("先判断用户意图，再选择工具。")).not.toBeInTheDocument();

  await user.click(runningStep);
  expect(runningStep).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("先判断用户意图，再选择工具。")).toBeInTheDocument();
});

test("shows where a specialist result is handed back and visualized", () => {
  let activity = applyAgentActivityEvent(createAgentActivity(), event({
    activityId: "specialist-multimodal",
    detail: "Multimodal Agent 已返回受控工作流结果。",
    kind: "handoff",
    label: "思维导图子任务已返回",
    status: "completed",
    type: "manager.activity"
  }));
  activity = applyAgentActivityEvent(activity, event({
    activityId: "result-multimodal",
    detail: "结果将由产物工作流校验并保存；完成后可在中心产物页查看。",
    kind: "tool_result",
    label: "思维导图结果已传回",
    status: "completed",
    type: "manager.activity"
  }));

  render(<AgentActivityCard activity={activity} />);

  expect(screen.getByRole("button", { name: "链路 思维导图子任务已返回" }))
    .toBeInTheDocument();
  expect(screen.getByRole("button", { name: "输出 思维导图结果已传回" }))
    .toBeInTheDocument();
});
