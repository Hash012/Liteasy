import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import type { FrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";
import { FloatingModalityButton } from "../app/features/artifacts/FloatingModalityButton";

function createAgentClient(): FrontendAgentClient {
  return {
    cancel: vi.fn(),
    close: vi.fn(),
    confirm: vi.fn(),
    connect: vi.fn(),
    getSession: vi.fn(() => null),
    send: vi.fn(async (input) => ({
      data: {
        apiVersion: "liteasy.agent/v1" as const,
        completedAt: "2026-07-26T00:00:00.000Z",
        createdAt: "2026-07-26T00:00:00.000Z",
        events: [
          {
            apiVersion: "liteasy.agent/v1" as const,
            emittedAt: "2026-07-26T00:00:00.000Z",
            eventId: "event-1",
            message: "你好，AI 服务已连接。你可以直接提问；需要分析论文时，也可以在左栏锁定论文或用 @ 添加。",
            runId: "run-1",
            sequence: 1,
            sessionId: "session-1",
            type: "assistant.message" as const
          }
        ],
        idempotencyKey: "test-key",
        input,
        runId: "run-1",
        sessionId: "session-1",
        status: "completed" as const
      },
      ok: true as const
    })),
    subscribe: vi.fn(() => () => undefined)
  };
}

test("sends a friendly no-selection greeting to the Agent API instead of rendering a static blocking instruction", async () => {
  const user = userEvent.setup();
  const agentClient = createAgentClient();

  render(
    <AssistantPane
      agentClient={agentClient}
      onGenerateArtifact={() => "unused"}
      selectedSetStatus={{
        importedCount: 0,
        selectedCount: 0,
        selectionLocked: false
      }}
    />
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "hello?");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(await screen.findByText(/你好，AI 服务已连接/)).toBeInTheDocument();
  expect(agentClient.send).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining("hello?"),
      mode: "qa"
    })
  );
});

test("uses @ papers as the locked task context for a slash artifact command", async () => {
  const user = userEvent.setup();
  const onGenerateArtifact = vi.fn(() => "已开始生成分层关系图。");
  const onLockPapersForTask = vi.fn();

  render(
    <AssistantPane
      agentClient={createAgentClient()}
      availablePapers={[
        { id: "paper-a", title: "Paper Alpha" },
        { id: "paper-b", title: "Paper Beta" }
      ]}
      onGenerateArtifact={onGenerateArtifact}
      onLockPapersForTask={onLockPapersForTask}
      selectedSetStatus={{
        importedCount: 0,
        selectedCount: 0,
        selectionLocked: false
      }}
    />
  );

  const input = screen.getByPlaceholderText("输入你的问题或命令");
  await user.type(input, "/生成分层关系图 @");
  await user.click(screen.getAllByRole("button", { name: /Paper Alpha/ })[0]);
  await user.type(input, "@");
  await user.click(screen.getByRole("button", { name: /Paper Beta/ }));
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(onLockPapersForTask).toHaveBeenCalledWith(["paper-a", "paper-b"]);
  expect(onGenerateArtifact).toHaveBeenCalledWith("layered_graph", ["paper-a", "paper-b"]);
  expect(screen.getByText("已开始生成分层关系图。")).toBeInTheDocument();
});

test("keeps the central modality menu collapsed until the user opens it", async () => {
  const user = userEvent.setup();
  const onStartAnalysis = vi.fn();

  render(
    <FloatingModalityButton
      analysisHint="选择一种产物"
      canStartAnalysis={true}
      onStartAnalysis={onStartAnalysis}
    />
  );

  expect(screen.queryByRole("button", { name: "分层关系图" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "打开模态选择" }));
  await user.click(screen.getByRole("button", { name: "分层关系图" }));

  expect(onStartAnalysis).toHaveBeenCalledWith("layered_graph");
});
