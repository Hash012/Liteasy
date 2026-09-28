import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import type { AgentEvent } from "../app/features/agent-api/agentApi.types";
import { AgentActivityCard } from "../app/features/assistant/AgentActivityCard";
import { applyAgentActivityEvent, completeAgentActivity, createAgentActivity } from "../app/features/assistant/agentActivity";

function event(payload: Record<string, unknown>) {
  return { apiVersion: "liteasy.agent/v1", emittedAt: "2026-09-02T00:00:00.000Z",
    eventId: `event-${payload.type}`, runId: "run-activity", sequence: 1,
    sessionId: "session-activity", ...payload } as AgentEvent;
}

test("keeps work details collapsed while making the current operation visible", async () => {
  const user = userEvent.setup();
  const activity = applyAgentActivityEvent(createAgentActivity(), event({
    activityId: "read-1", detail: "已读取摘要；全文尚未加载。", kind: "tool_call",
    label: "读取 Cicada 摘要", status: "running", type: "manager.activity"
  }));
  const { rerender } = render(<AgentActivityCard activity={activity} />);
  const header = screen.getByRole("button", { name: "查看 Agent 执行过程" });
  expect(header).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("status")).toHaveTextContent("读取 Cicada 摘要");
  expect(screen.queryByText("已读取摘要；全文尚未加载。")).not.toBeInTheDocument();
  await user.click(header);
  const step = screen.getByRole("button", { name: "读取 Cicada 摘要" });
  expect(step).toHaveAttribute("aria-expanded", "false");
  await user.click(step);
  expect(screen.getByText("已读取摘要；全文尚未加载。")).toBeVisible();
  rerender(<AgentActivityCard activity={completeAgentActivity(activity, "completed")} />);
  expect(screen.getByRole("status")).toHaveTextContent("已完成");
  // Incoming events must not close details that the user is inspecting.
  expect(step).toHaveAttribute("aria-expanded", "true");
});

test("summarizes actual completed writes and keeps their results inspectable", async () => {
  const user = userEvent.setup();
  const activity = completeAgentActivity(applyAgentActivityEvent({ ...createAgentActivity(),
    startedAt: "2026-09-02T00:00:00.000Z" }, event({ activityId: "write-1",
    detail: "笔记已保存，共 420 字。", kind: "tool_result", label: "已更新 CicN",
    status: "completed", type: "manager.activity"
  })), "completed", "2026-09-02T00:01:05.000Z");
  render(<AgentActivityCard activity={activity} />);
  expect(screen.getByRole("status")).toHaveTextContent("已完成 · 1 分 5 秒");
  expect(screen.getByText("已更新 CicN", { selector: ".assistant-agent-operation-summary" })).toBeVisible();
  expect(screen.queryByText("链路")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "查看 Agent 执行过程" }));
  await user.click(screen.getByRole("button", { name: "已更新 CicN" }));
  expect(screen.getByText("笔记已保存，共 420 字。")).toBeVisible();
});

test("does not invent steps for a simple response", async () => {
  const user = userEvent.setup();
  render(<AgentActivityCard activity={completeAgentActivity(createAgentActivity(), "completed")} />);
  await user.click(screen.getByRole("button", { name: "查看 Agent 执行过程" }));
  expect(screen.getByText("本轮没有使用工具。")).toBeVisible();
  expect(screen.queryByRole("list", { name: "Agent 执行步骤" })).not.toBeInTheDocument();
});
