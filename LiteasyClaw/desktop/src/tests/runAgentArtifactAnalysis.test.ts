import { vi } from "vitest";
import { runAgentArtifactAnalysis } from "../app/controllers/agent/runAgentArtifactAnalysis";
import type { FrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";

function createClient(
  send: FrontendAgentClient["send"],
  subscribe: FrontendAgentClient["subscribe"] = vi.fn(() => () => undefined)
): FrontendAgentClient {
  return {
    cancel: vi.fn(),
    close: vi.fn(),
    connect: vi.fn(),
    confirm: vi.fn(),
    getSession: vi.fn(() => null),
    send,
    subscribe
  } as FrontendAgentClient;
}

test("submits modal analysis through the public Agent client", async () => {
  const run = {
    apiVersion: "liteasy.agent/v1" as const,
    createdAt: "2026-07-20T00:00:00.000Z",
    events: [],
    idempotencyKey: "key-1",
    input: { artifactType: "mindmap" as const, message: "analysis", mode: "qa" as const },
    runId: "run-1",
    sessionId: "session-1",
    status: "completed" as const
  };
  const send = vi.fn(async () => ({ data: run, ok: true as const }));

  const result = await runAgentArtifactAnalysis(createClient(send), "mindmap");

  expect(result).toBe(run);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      artifactType: "mindmap",
      message: expect.stringContaining("不要设置固定节点数"),
      mode: "qa"
    }),
    {
      attachments: [{ source: "selection", uri: "liteasy://selection/current" }]
    }
  );
  expect(send.mock.calls[0][0].message).not.toContain("总节点不超过 60");
});

test("streams public Agent progress events to the artifact task", async () => {
  let listener: Parameters<FrontendAgentClient["subscribe"]>[0] | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((nextListener: Parameters<FrontendAgentClient["subscribe"]>[0]) => {
    listener = nextListener;
    return unsubscribe;
  });
  const send = vi.fn(async (input: Parameters<FrontendAgentClient["send"]>[0]) => {
    listener?.({
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T00:00:00.000Z",
      eventId: "event-start",
      inputMode: "qa",
      message: input.message,
      runId: "run-stream",
      sequence: 1,
      sessionId: "session-1",
      type: "run.started"
    });
    listener?.({
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T00:00:01.000Z",
      eventId: "event-progress",
      phase: "generating_answer",
      planId: "run-stream",
      progress: 55,
      runId: "run-stream",
      sequence: 2,
      sessionId: "session-1",
      summary: "正在调用模型生成分析结构",
      traceId: "trace-run-stream",
      type: "progress.started"
    });
    listener?.({
      apiVersion: "liteasy.agent/v1",
      delta: "- ColBERT\n  - late interaction\n",
      emittedAt: "2026-07-20T00:00:02.000Z",
      eventId: "event-delta",
      runId: "run-stream",
      sequence: 3,
      sessionId: "session-1",
      type: "assistant.delta"
    });
    return {
      data: {
        apiVersion: "liteasy.agent/v1" as const,
        createdAt: "2026-07-20T00:00:00.000Z",
        events: [],
        idempotencyKey: "key-stream",
        input,
        runId: "run-stream",
        sessionId: "session-1",
        status: "completed" as const
      },
      ok: true as const
    };
  });
  const onProgress = vi.fn();

  await runAgentArtifactAnalysis(createClient(send, subscribe), "tree", onProgress);

  expect(onProgress).toHaveBeenCalledWith({
    message: "正在调用模型生成分析结构",
    progress: 55,
    stage: "generating_answer"
  });
  expect(onProgress).toHaveBeenCalledWith({
    message: "正在接收模型流式输出",
    partialAnswer: "- ColBERT\n  - late interaction\n",
    partialOutlineNodes: [
      expect.objectContaining({ id: "stream-node-0", label: "ColBERT" }),
      expect.objectContaining({ label: "late interaction", parentId: "stream-node-0" })
    ],
    progress: 68,
    stage: "generating_answer"
  });
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("includes supplemental material and preserves its trust boundary during regeneration", async () => {
  const send = vi.fn(async (input: Parameters<FrontendAgentClient["send"]>[0]) => ({
    data: {
      apiVersion: "liteasy.agent/v1" as const,
      createdAt: "2026-07-20T00:00:00.000Z",
      events: [],
      idempotencyKey: "key-regenerate",
      input,
      runId: "run-regenerate",
      sessionId: "session-1",
      status: "completed" as const
    },
    ok: true as const
  }));

  await runAgentArtifactAnalysis(createClient(send), "tree", undefined, {
    regeneratedFromArtifactId: "artifact-original",
    sourcePaperIds: ["demo-1", "demo-2"],
    supplementalContext: "ACORN Table 4 与 ColBERT Table 2"
  });

  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringMatching(
        /指定的 2 篇来源论文[\s\S]*用户补充资料[\s\S]*<user-supplement>[\s\S]*ACORN Table 4/
      )
    }),
    expect.any(Object)
  );
  expect(send.mock.calls[0][0].message).toContain("不得把用户材料伪装成论文原文");
});

test("does not treat skill documents as a paper-analysis modality", async () => {
  const send = vi.fn();
  await expect(
    runAgentArtifactAnalysis(createClient(send as FrontendAgentClient["send"]), "skill_doc")
  ).rejects.toThrow("不是论文分析模态");
  expect(send).not.toHaveBeenCalled();
});

test("surfaces the underlying public Agent run failure", async () => {
  const send = vi.fn(async () => ({
    data: {
      apiVersion: "liteasy.agent/v1" as const,
      createdAt: "2026-07-20T00:00:00.000Z",
      events: [
        {
          apiVersion: "liteasy.agent/v1" as const,
          emittedAt: "2026-07-20T00:00:01.000Z",
          eventId: "event-1",
          message: "模型服务请求失败（cloud_proxy 502）",
          runId: "run-1",
          sequence: 1,
          sessionId: "session-1",
          type: "run.failed" as const
        }
      ],
      idempotencyKey: "key-1",
      input: { artifactType: "mindmap" as const, message: "analysis", mode: "qa" as const },
      runId: "run-1",
      sessionId: "session-1",
      status: "failed" as const
    },
    ok: true as const
  }));

  await expect(
    runAgentArtifactAnalysis(createClient(send), "mindmap")
  ).rejects.toThrow("模型服务请求失败（cloud_proxy 502）");
});
