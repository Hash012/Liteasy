import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import type { ArtifactTask } from "../app/features/artifacts/artifact.types";

function artifactTask(patch: Partial<ArtifactTask> = {}): ArtifactTask {
  return {
    id: "artifact-task-1",
    message: "正在检索论文证据",
    partialAnswer: "- ColBERT\n  - late interaction",
    progress: 32,
    stage: "retrieving_evidence",
    status: "running",
    type: "tree",
    ...patch
  };
}

describe("AssistantPane multi-session registry", () => {
  test("binds each conversation and restored history item to its own public Agent client", async () => {
    const user = userEvent.setup();
    const clients = new Map<string, { connect: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }>();
    const createSessionClient = vi.fn((clientSessionId: string) => {
      const send = vi.fn(async (input: { message: string; mode: string }) => ({
        data: {
          apiVersion: "liteasy.agent/v1",
          completedAt: "2026-07-30T00:00:01.000Z",
          createdAt: "2026-07-30T00:00:00.000Z",
          events: [{
            apiVersion: "liteasy.agent/v1",
            emittedAt: "2026-07-30T00:00:01.000Z",
            eventId: `event-${clientSessionId}`,
            message: `answer:${input.message}`,
            runId: `run-${clientSessionId}`,
            sequence: 1,
            sessionId: `public-${clientSessionId}`,
            type: "assistant.message"
          }],
          idempotencyKey: `key-${clientSessionId}`,
          input,
          runId: `run-${clientSessionId}`,
          sessionId: `public-${clientSessionId}`,
          status: "completed"
        },
        ok: true
      }));
      const client = {
        connect: vi.fn(async () => ({
          data: {
            apiVersion: "liteasy.agent/v1",
            clientSessionId,
            consumer: "frontend",
            createdAt: "2026-07-30T00:00:00.000Z",
            sessionId: `public-${clientSessionId}`,
            status: "active"
          },
          ok: true
        })),
        send,
        subscribe: vi.fn(() => () => undefined)
      };
      clients.set(clientSessionId, client);
      return client;
    });

    render(
      <AssistantPane
        agentClient={{ createSessionClient } as never}
        onGenerateArtifact={() => "unused"}
        selectedSetStatus={{
          importedCount: 1,
          selectedCount: 1,
          selectionLocked: true
        }}
      />
    );

    const composer = screen.getByPlaceholderText("输入你的问题或命令");
    await user.type(composer, "第一条问题");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("answer:第一条问题");

    await user.click(screen.getByRole("button", { name: "新建" }));
    await user.type(composer, "第二条问题");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("answer:第二条问题");

    await user.click(screen.getByRole("button", { name: "历史" }));
    await user.click(screen.getByRole("button", { name: "打开会话：第一条问题" }));
    await user.type(composer, "第一条追问");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByText("answer:第一条追问");

    expect(createSessionClient).toHaveBeenCalledTimes(2);
    const [firstClientSessionId, secondClientSessionId] = createSessionClient.mock.calls.map(
      ([clientSessionId]) => clientSessionId
    );
    expect(firstClientSessionId).not.toBe(secondClientSessionId);
    expect(clients.get(firstClientSessionId)?.send).toHaveBeenCalledTimes(2);
    expect(clients.get(secondClientSessionId)?.connect).toHaveBeenCalledTimes(1);
    expect(clients.get(secondClientSessionId)?.send).toHaveBeenCalledTimes(1);
  });

  test("cancels an ordinary AI conversation by run id", async () => {
    const user = userEvent.setup();
    let listener: ((event: never) => void) | undefined;
    let resolveSend: ((result: unknown) => void) | undefined;
    const cancelledRun = {
      apiVersion: "liteasy.agent/v1",
      completedAt: "2026-07-20T10:00:01.000Z",
      createdAt: "2026-07-20T10:00:00.000Z",
      events: [{
        apiVersion: "liteasy.agent/v1",
        emittedAt: "2026-07-20T10:00:01.000Z",
        eventId: "event-cancelled",
        reason: "用户终止了 AI 对话",
        runId: "run-chat-1",
        sequence: 2,
        sessionId: "session-1",
        type: "run.cancelled"
      }],
      idempotencyKey: "key-chat-1",
      input: { message: "解释 MaxSim", mode: "qa" },
      runId: "run-chat-1",
      sessionId: "session-1",
      status: "cancelled"
    };
    const cancel = vi.fn(async () => {
      resolveSend?.({ data: cancelledRun, ok: true });
      return { data: cancelledRun, ok: true };
    });
    const agentClient = {
      cancel,
      send: vi.fn(async (
        input: { message: string; mode: string },
        options?: { idempotencyKey?: string }
      ) => {
        listener?.({
          apiVersion: "liteasy.agent/v1",
          emittedAt: "2026-07-20T10:00:00.000Z",
          eventId: "event-started",
          idempotencyKey: options?.idempotencyKey,
          inputMode: input.mode,
          message: input.message,
          runId: "run-chat-1",
          sequence: 1,
          sessionId: "session-1",
          type: "run.started"
        } as never);
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      }),
      subscribe: vi.fn((nextListener: (event: never) => void) => {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      })
    } as never;

    render(
      <AssistantPane
        agentClient={agentClient}
        onGenerateArtifact={() => "unused"}
        selectedSetStatus={{
          importedCount: 1,
          selectedCount: 1,
          selectionLocked: true
        }}
      />
    );
    await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "解释 MaxSim");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await user.click(await screen.findByRole("button", { name: "终止" }));

    expect(cancel).toHaveBeenCalledWith("run-chat-1", "用户终止了 AI 对话");
    expect(await screen.findByText(/运行已取消：用户终止了 AI 对话/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "历史" }));
    expect(screen.getByText("普通对话 · 已终止")).toBeInTheDocument();
  });

  test("cancels the active ordinary AI run by idempotency key when duplicate messages overlap", async () => {
    const user = userEvent.setup();
    let listener: ((event: never) => void) | undefined;
    let resolveSend: ((result: unknown) => void) | undefined;
    let submittedIdempotencyKey: string | undefined;
    const cancelledRun = {
      apiVersion: "liteasy.agent/v1",
      completedAt: "2026-07-20T10:00:01.000Z",
      createdAt: "2026-07-20T10:00:00.000Z",
      events: [{
        apiVersion: "liteasy.agent/v1",
        emittedAt: "2026-07-20T10:00:01.000Z",
        eventId: "event-cancelled",
        reason: "用户终止了 AI 对话",
        runId: "run-target",
        sequence: 2,
        sessionId: "session-1",
        type: "run.cancelled"
      }],
      idempotencyKey: "key-target",
      input: { message: "解释 MaxSim", mode: "qa" },
      runId: "run-target",
      sessionId: "session-1",
      status: "cancelled"
    };
    const cancel = vi.fn(async () => {
      resolveSend?.({ data: cancelledRun, ok: true });
      return { data: cancelledRun, ok: true };
    });
    const agentClient = {
      cancel,
      send: vi.fn(async (
        input: { message: string; mode: string },
        options?: { idempotencyKey?: string }
      ) => {
        submittedIdempotencyKey = options?.idempotencyKey;
        listener?.({
          apiVersion: "liteasy.agent/v1",
          emittedAt: "2026-07-20T10:00:00.000Z",
          eventId: "event-started-other",
          idempotencyKey: "key-other",
          inputMode: input.mode,
          message: input.message,
          runId: "run-other",
          sequence: 1,
          sessionId: "session-1",
          type: "run.started"
        } as never);
        return new Promise((resolve) => {
          resolveSend = resolve;
        });
      }),
      subscribe: vi.fn((nextListener: (event: never) => void) => {
        listener = nextListener;
        return () => {
          listener = undefined;
        };
      })
    } as never;

    render(
      <AssistantPane
        agentClient={agentClient}
        onGenerateArtifact={() => "unused"}
        selectedSetStatus={{
          importedCount: 1,
          selectedCount: 1,
          selectionLocked: true
        }}
      />
    );
    await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "解释 MaxSim");
    await user.click(screen.getByRole("button", { name: "发送" }));
    await user.click(await screen.findByRole("button", { name: "终止" }));
    listener?.({
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T10:00:00.100Z",
      eventId: "event-started-target",
      idempotencyKey: submittedIdempotencyKey,
      inputMode: "qa",
      message: "解释 MaxSim",
      runId: "run-target",
      sequence: 1,
      sessionId: "session-1",
      type: "run.started"
    } as never);

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledWith("run-target", "用户终止了 AI 对话");
    });
    expect(agentClient.send).toHaveBeenCalledWith(
      { message: "解释 MaxSim", mode: "qa" },
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^conversation:qa:/)
      })
    );
  });

  test("terminates the active multimodal generation session", async () => {
    const user = userEvent.setup();
    const onCancelArtifactTask = vi.fn(async () => "已终止");
    render(
      <AssistantPane
        agentClient={{ close: vi.fn() } as never}
        artifactTasks={[artifactTask({ agentRunId: "run-artifact-1" })]}
        onCancelArtifactTask={onCancelArtifactTask}
        onGenerateArtifact={() => "unused"}
        selectedSetStatus={{
          importedCount: 2,
          selectedCount: 2,
          selectionLocked: true
        }}
      />
    );

    await user.click(await screen.findByRole("button", { name: "终止" }));
    expect(onCancelArtifactTask).toHaveBeenCalledWith("artifact-task-1");
  });

  test("streams an artifact task into its own session and keeps it after creating another session", async () => {
    const user = userEvent.setup();
    const onActiveSessionChange = vi.fn();
    const closeAgentSession = vi.fn();
    const agentClient = { close: closeAgentSession } as never;
    const onOpenArtifact = vi.fn();
    const firstTask = artifactTask();
    const { rerender } = render(
      <AssistantPane
        agentClient={agentClient}
        artifactTasks={[firstTask]}
        onActiveSessionChange={onActiveSessionChange}
        onGenerateArtifact={() => "unused"}
        onOpenArtifact={onOpenArtifact}
        selectedSetStatus={{
          importedCount: 2,
          selectedCount: 2,
          selectionLocked: true
        }}
      />
    );

    expect(await screen.findByText("产物生成")).toBeInTheDocument();
    expect(screen.getAllByText("生成：文献树").length).toBeGreaterThan(0);
    expect(screen.getByText(/正在检索论文证据/)).toBeInTheDocument();
    expect(screen.getByText(/late interaction/)).toBeInTheDocument();

    rerender(
      <AssistantPane
        agentClient={agentClient}
        artifactTasks={[
          artifactTask({
            message: "正在生成树形结构",
            partialAnswer: "- ColBERT\n  - late interaction\n    - MaxSim",
            progress: 68,
            stage: "generating_answer"
          })
        ]}
        onActiveSessionChange={onActiveSessionChange}
        onGenerateArtifact={() => "unused"}
        onOpenArtifact={onOpenArtifact}
        selectedSetStatus={{
          importedCount: 2,
          selectedCount: 2,
          selectionLocked: true
        }}
      />
    );

    expect(await screen.findByText(/正在生成树形结构/)).toBeInTheDocument();
    expect(screen.getByText(/进度：68%/)).toBeInTheDocument();
    expect(screen.getByText(/MaxSim/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "新建" }));
    expect(closeAgentSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText("当前会话")).toHaveTextContent("普通对话");
    expect(screen.queryByText(/正在生成树形结构/)).not.toBeInTheDocument();

    rerender(
      <AssistantPane
        agentClient={agentClient}
        artifactTasks={[
          artifactTask({
            artifactId: "artifact-tree-1",
            message: "树形产物已保存",
            partialAnswer: "完整树形结果",
            progress: 100,
            stage: "completed",
            status: "completed"
          })
        ]}
        onActiveSessionChange={onActiveSessionChange}
        onGenerateArtifact={() => "unused"}
        onOpenArtifact={onOpenArtifact}
        selectedSetStatus={{
          importedCount: 2,
          selectedCount: 2,
          selectionLocked: true
        }}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText("当前会话")).toHaveTextContent("普通对话");
    });
    await user.click(screen.getByRole("button", { name: "历史" }));
    expect(screen.getByText("产物生成 · 已完成")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开会话：生成：文献树" }));

    expect(screen.getByLabelText("当前会话")).toHaveTextContent("产物生成");
    expect(screen.getByText(/树形产物已保存/)).toBeInTheDocument();
    expect(screen.getByText(/完整树形结果/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "打开产物" }));
    expect(onOpenArtifact).toHaveBeenCalledWith("artifact-tree-1");
    expect(onActiveSessionChange).toHaveBeenCalled();
  });
});
