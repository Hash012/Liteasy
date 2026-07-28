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
      attachments: [{ source: "selection", uri: "liteasy://selection/current" }],
      idempotencyKey: expect.stringMatching(/^artifact:mindmap:/)
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
  const send = vi.fn(async (
    input: Parameters<FrontendAgentClient["send"]>[0],
    options?: Parameters<FrontendAgentClient["send"]>[1]
  ) => {
    listener?.({
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T00:00:00.000Z",
      eventId: "event-start",
      idempotencyKey: options?.idempotencyKey ?? "",
      inputMode: "qa",
      message: input.message,
      runId: "run-stream",
      sequence: 1,
      sessionId: "session-1",
      type: "run.started"
    });
    listener?.({
      apiVersion: "liteasy.agent/v1",
      delta: "MaxSim 在每个 query token 上取最大相似度。",
      emittedAt: "2026-07-20T00:00:00.500Z",
      eventId: "event-subtask-delta",
      label: "ColBERT · 方法区段",
      runId: "run-stream",
      sequence: 2,
      sessionId: "session-1",
      subtaskId: "section:demo-1:2",
      type: "analysis.subtask.delta"
    });
    listener?.({
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T00:00:01.000Z",
      eventId: "event-progress",
      phase: "generating_answer",
      planId: "run-stream",
      progress: 55,
      runId: "run-stream",
      sequence: 3,
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
      sequence: 4,
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
    agentRunId: "run-stream",
    message: "Agent 已接收分析任务",
    progress: 18,
    stage: "preparing_context"
  });
  expect(onProgress).toHaveBeenCalledWith({
    message: "正在并行分析论文区段（1 个 SubAgent 已返回内容）",
    partialAnswer:
      "【SubAgent 工作记录 · ColBERT · 方法区段】\nMaxSim 在每个 query token 上取最大相似度。",
    progress: 48,
    stage: "generating_answer"
  });
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

test("binds streamed progress to the submitted idempotency key instead of matching duplicate messages", async () => {
  let listener: Parameters<FrontendAgentClient["subscribe"]>[0] | undefined;
  const subscribe = vi.fn((nextListener: Parameters<FrontendAgentClient["subscribe"]>[0]) => {
    listener = nextListener;
    return vi.fn();
  });
  const send = vi.fn(async (
    input: Parameters<FrontendAgentClient["send"]>[0],
    options?: Parameters<FrontendAgentClient["send"]>[1]
  ) => {
    listener?.({
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T00:00:00.000Z",
      eventId: "event-start-other",
      idempotencyKey: "other-artifact-run",
      inputMode: "qa",
      message: input.message,
      runId: "run-other",
      sequence: 1,
      sessionId: "session-1",
      type: "run.started"
    });
    listener?.({
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T00:00:00.500Z",
      eventId: "event-progress-other",
      phase: "generating_answer",
      planId: "run-other",
      progress: 66,
      runId: "run-other",
      sequence: 2,
      sessionId: "session-1",
      summary: "错误串入的进度",
      traceId: "trace-run-other",
      type: "progress.started"
    });
    listener?.({
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T00:00:01.000Z",
      eventId: "event-start-target",
      idempotencyKey: options?.idempotencyKey ?? "",
      inputMode: "qa",
      message: input.message,
      runId: "run-target",
      sequence: 1,
      sessionId: "session-1",
      type: "run.started"
    });
    listener?.({
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T00:00:01.500Z",
      eventId: "event-progress-target",
      phase: "generating_answer",
      planId: "run-target",
      progress: 55,
      runId: "run-target",
      sequence: 2,
      sessionId: "session-1",
      summary: "目标 run 的进度",
      traceId: "trace-run-target",
      type: "progress.started"
    });
    return {
      data: {
        apiVersion: "liteasy.agent/v1" as const,
        createdAt: "2026-07-20T00:00:00.000Z",
        events: [],
        idempotencyKey: options?.idempotencyKey ?? "missing-key",
        input,
        runId: "run-target",
        sessionId: "session-1",
        status: "completed" as const
      },
      ok: true as const
    };
  });
  const onProgress = vi.fn();

  await runAgentArtifactAnalysis(createClient(send, subscribe), "mindmap", onProgress);

  expect(send.mock.calls[0][1]?.idempotencyKey).toMatch(/^artifact:mindmap:/);
  expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({
    agentRunId: "run-other"
  }));
  expect(onProgress).not.toHaveBeenCalledWith(expect.objectContaining({
    message: "错误串入的进度"
  }));
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
    agentRunId: "run-target",
    message: "Agent 已接收分析任务"
  }));
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
    message: "目标 run 的进度"
  }));
});

test("maps artifact workflow progress phases to stable artifact task stages", async () => {
  let listener: Parameters<FrontendAgentClient["subscribe"]>[0] | undefined;
  const subscribe = vi.fn((nextListener: Parameters<FrontendAgentClient["subscribe"]>[0]) => {
    listener = nextListener;
    return vi.fn();
  });
  const send = vi.fn(async (
    input: Parameters<FrontendAgentClient["send"]>[0],
    options?: Parameters<FrontendAgentClient["send"]>[1]
  ) => {
    listener?.({
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T00:00:00.000Z",
      eventId: "event-start",
      idempotencyKey: options?.idempotencyKey ?? "",
      inputMode: "qa",
      message: input.message,
      runId: "run-workflow",
      sequence: 1,
      sessionId: "session-1",
      type: "run.started"
    });
    [
      ["planning_artifact", "规划 Artifact 结构", 34],
      ["collecting_external_knowledge", "检索外部补充知识", 42],
      ["verifying_artifact", "审计 Artifact 结构", 82],
      ["repairing_artifact", "修复 Artifact 草稿", 86]
    ].forEach(([phase, summary, progress], index) => {
      listener?.({
        apiVersion: "liteasy.agent/v1",
        emittedAt: "2026-07-20T00:00:01.000Z",
        eventId: `event-progress-${index}`,
        phase: String(phase),
        planId: "run-workflow",
        progress: Number(progress),
        runId: "run-workflow",
        sequence: index + 2,
        sessionId: "session-1",
        summary: String(summary),
        traceId: "trace-run-workflow",
        type: "progress.started"
      });
    });
    return {
      data: {
        apiVersion: "liteasy.agent/v1" as const,
        createdAt: "2026-07-20T00:00:00.000Z",
        events: [],
        idempotencyKey: "key-workflow",
        input,
        runId: "run-workflow",
        sessionId: "session-1",
        status: "completed" as const
      },
      ok: true as const
    };
  });
  const onProgress = vi.fn();

  await runAgentArtifactAnalysis(createClient(send, subscribe), "mindmap", onProgress);

  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
    message: "规划 Artifact 结构",
    stage: "retrieving_evidence"
  }));
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
    message: "检索外部补充知识",
    stage: "retrieving_evidence"
  }));
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
    message: "审计 Artifact 结构",
    stage: "auditing_answer"
  }));
  expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
    message: "修复 Artifact 草稿",
    stage: "auditing_answer"
  }));
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
  expect(send.mock.calls[0][1]).toMatchObject({
    attachments: [
      {
        metadata: {
          paperIds: ["demo-1", "demo-2"]
        },
        source: "selection",
        uri: "liteasy://selection/current"
      }
    ]
  });
});

test("submits thin-reading analysis with structured context metadata", async () => {
  const send = vi.fn(async (input: Parameters<FrontendAgentClient["send"]>[0]) => ({
    data: {
      apiVersion: "liteasy.agent/v1" as const,
      createdAt: "2026-07-28T00:00:00.000Z",
      events: [],
      idempotencyKey: "key-thin",
      input,
      runId: "run-thin",
      sessionId: "session-1",
      status: "completed" as const
    },
    ok: true as const
  }));

  await runAgentArtifactAnalysis(createClient(send), "thin_reading", undefined, {
    sourcePaperIds: ["paper-1"],
    thinReadingContext: {
      artifactId: "artifact-thin",
      depth: 0,
      paperIds: ["paper-1"],
      primaryPaperId: "paper-1",
      primaryPaperTitle: "Paper 1",
      parentClaims: [
        {
          evidenceIds: ["evidence-parent"],
          id: "claim-parent",
          status: "grounded",
          text: "上一层关键判断。"
        }
      ],
      parentEvidenceSpans: [
        {
          confidence: 0.89,
          id: "evidence-parent",
          page: 3,
          paperId: "paper-1",
          quote: "Parent evidence quote."
        }
      ],
      source: { kind: "root_overview" },
      targetLanguage: "zh-CN"
    }
  });

  expect(send.mock.calls[0][0]).toMatchObject({
    artifactType: "thin_reading",
    mode: "qa"
  });
  expect(send.mock.calls[0][0].message).toContain("必须走真实模型链路");
  expect(send.mock.calls[0][1]).toMatchObject({
    attachments: [
      {
        metadata: {
          paperIds: ["paper-1"],
          thinReadingContext: expect.objectContaining({
            artifactId: "artifact-thin",
            parentClaims: [
              expect.objectContaining({ id: "claim-parent" })
            ],
            parentEvidenceSpans: [
              expect.objectContaining({ id: "evidence-parent", quote: "Parent evidence quote." })
            ],
            source: { kind: "root_overview" }
          })
        },
        source: "selection",
        uri: "liteasy://selection/current"
      }
    ]
  });
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
