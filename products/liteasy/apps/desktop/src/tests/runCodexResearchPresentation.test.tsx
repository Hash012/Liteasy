import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { runCodexResearch } from "../app/controllers/agent/runCodexResearch";
import type { AgentCommandExecutionInput } from "../app/controllers/agent/agentApplicationService";
import type { AgentEvent, AgentManagerActivity } from "../app/features/agent-api/agentApi.types";
import { applyAgentActivityEvent, createAgentActivity } from "../app/features/assistant/agentActivity";
import { AgentActivityCard } from "../app/features/assistant/AgentActivityCard";

vi.mock("@tauri-apps/api/core", () => ({ Channel: class {}, invoke: vi.fn(async () => ({ workerId: "worker-internal" })) }));
vi.mock("../app/features/research-loop/codexAppServerBackend", () => ({ createCodexAppServerBackend: (input: { callTool(name: string, args: unknown): Promise<unknown> }) => ({
  run: async () => { await input.callTool("research_get_run", { runId: "bound-run" }); return { message: "读取完成", loopOwner: "codex_app_server", threadId: "thread-internal", toolCalls: 1 }; },
  dispose: vi.fn()
}) }));

test("real research tool activity projects a human explanation without changing the bound tool or run", async () => {
  const activities: AgentManagerActivity[] = [];
  const call = vi.fn(async (operation: string) => operation === "get" ? { task: { taskBrief: { nextCheck: "核对误差" } }, records: [], runs: [{ runId: "bound-run" }] } : { measured: true });
  const input = { runId: "internal-agent-run", request: { sessionId: "session", input: { researchTaskId: "task", message: "核对实验" } }, signal: new AbortController().signal,
    reportManagerActivity: (activity: AgentManagerActivity) => activities.push(activity), reportDelta: vi.fn() } as unknown as AgentCommandExecutionInput;
  await runCodexResearch(input, { scope: "local", active: () => true, host: { call } as never, assets: {} as never,
    grant: { grantId: "grant", accountId: "account", model: "chosen-model", sources: [] } });
  expect(call).toHaveBeenCalledWith("get_run", { runId: "bound-run" });
  const event = { ...activities[0], type: "manager.activity", apiVersion: "liteasy.agent/v1", emittedAt: "2026-10-15T00:00:00Z", eventId: "event", runId: "internal-agent-run", sequence: 1, sessionId: "session" } as AgentEvent;
  expect(activities[0].activityId).toContain("research_get_run");
  render(<AgentActivityCard activity={applyAgentActivityEvent(createAgentActivity(), event)} />);
  await userEvent.click(screen.getByRole("button", { name: "查看 Agent 执行过程" }));
  await userEvent.click(screen.getByRole("button", { name: "研究工具" }));
  expect(screen.getByText("读取实验运行结果")).toBeVisible();
  expect(screen.queryByText(/research_get_run|internal-agent-run/)).not.toBeInTheDocument();
});
