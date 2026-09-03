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
