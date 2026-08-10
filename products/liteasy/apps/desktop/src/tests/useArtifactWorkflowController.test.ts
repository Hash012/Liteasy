import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useArtifactWorkflowController } from "../app/controllers/useArtifactWorkflowController";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
import { createThinReadingBranchRecoverySnapshot } from "../app/features/artifacts/artifactTaskRecovery";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { buildImportedChunksForPaper } from "./fixtures/retrievalFixtures";
import type { Paper } from "../app/features/workspace/workspace.types";
import type { AgentRun } from "../app/features/agent-api/agentApi.types";
import type { AgentArtifactResult } from "../app/features/artifacts/artifact.types";
import {
  availableCapability,
  documentWithNode,
  readyArtifact
} from "./fixtures/visualizationControllerFixtures";

function mindmapArtifact(verificationStatus: "fail" | "pass" = "pass") {
  const verification = {
    checkedAt: "2026-07-20T02:00:00.000Z",
    errors: verificationStatus === "fail"
      ? [{
          code: "missing_selected_paper_coverage",
          message: "选中文献 demo-1 没有被思维导图节点覆盖。"
        }]
      : [],
    repairable: verificationStatus === "fail",
    status: verificationStatus,
    warnings: []
  };

  return {
    artifactId: "artifact-mindmap-1",
    createdAt: "2026-07-20T02:00:00.000Z",
    root: {
      children: [],
      confidence: "high",
      id: "root",
      label: "Attention 思维导图",
      nodeType: "topic",
      sourceRefs: []
    },
    runId: "analysis-1",
    sources: {
      externalReferences: [],
      inferences: [],
      selectedPapers: []
    },
    title: "Attention 思维导图",
    verification,
    version: "liteasy.mindmap-artifact/v1"
  };
}

function artifactWorkflow(status: "blocked" | "verified" = "verified") {
  const mindmap = mindmapArtifact(status === "verified" ? "pass" : "fail");
  return {
    mindmap,
    status,
    verification: mindmap.verification
  };
}

function completedRun(options: {
  workflowStatus?: "blocked" | "verified";
} = {}): AgentRun {
  return {
    apiVersion: "liteasy.agent/v1",
    completedAt: "2026-07-20T02:00:00.000Z",
    createdAt: "2026-07-20T01:00:00.000Z",
    events: [{
      apiVersion: "liteasy.agent/v1",
      emittedAt: "2026-07-20T02:00:00.000Z",
      eventId: "event-1",
      message: "analysis",
      metadata: {
        analysis: {
          citations: [],
          claims: [],
          evidence: [],
          evidencePrompt: "",
          paperClaims: [],
          retrievalConfidence: 0,
          run: {
            completedAt: "2026-07-20T02:00:00.000Z",
            coverage: {
              coveredPaperIds: [],
              missingPaperIds: ["demo-1"],
              ratio: 0,
              selectedPaperIds: ["demo-1"]
            },
            createdAt: "2026-07-20T01:00:00.000Z",
            id: "analysis-1",
            plan: {
              dimensions: ["方法"],
              maxEvidencePerPaper: 2,
              maxTotalEvidence: 12,
              paperIds: ["demo-1"],
              query: "analysis"
            },
            query: "analysis",
            status: "completed"
          }
        },
        artifactWorkflow: artifactWorkflow(options.workflowStatus ?? "verified")
      },
      runId: "run-1",
      sequence: 1,
      sessionId: "session-1",
      type: "assistant.message"
    }],
    idempotencyKey: "key-1",
    input: { artifactType: "mindmap", message: "analysis", mode: "qa" },
    runId: "run-1",
    sessionId: "session-1",
    status: "completed"
  };
}

function completedThinReadingRun(): AgentRun {
  const run = completedRun();
  const answer = run.events.find((event) => event.type === "assistant.message");
  if (!answer || answer.type !== "assistant.message") {
    throw new Error("expected assistant answer event");
  }
  answer.metadata = {
    ...answer.metadata,
    thinReading: {
      rootSeed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
        omittedSections: [],
        recommendations: [],
        summary: "The mechanism has two evidence-backed stages.",
        visualizationIntent: {
          candidateModalities: ["semantic_graph"],
          evidenceIds: ["evidence-1"],
          expectedLearningGain: "high",
          purpose: "show_process",
          requestedBy: "automatic"
        },
        withinPaperClosure: true
      }
    }
  };
  return {
    ...run,
    input: { artifactType: "thin_reading", message: "thin reading", mode: "qa" }
  };
}

function artifactResultClient() {
  return {
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    save: vi.fn(async (document: { artifactId: string }) =>
      `development/test-data/agent-results/${document.artifactId}.json`
    )
  };
}

function persistedArtifact(): AgentArtifactResult {
  return {
    agent: {
      apiVersion: "liteasy.agent/v1",
      runId: "run-saved",
      sessionId: "session-saved",
      status: "completed"
    },
    answer: "saved analysis",
    artifactId: "artifact-saved",
    artifactType: "mindmap",
    citations: [],
    createdAt: "2026-07-20T03:00:00.000Z",
    mindmapArtifact: mindmapArtifact("pass"),
    papers: [{ id: paper.id, title: paper.title }],
    title: "Saved Mind Map",
    uiDsl: {
      actions: [],
      audit: {
        createdAt: "2026-07-20T03:00:00.000Z",
        generatedBy: "rule",
        traceId: "trace-saved"
      },
      dataSources: [],
      root: { component: "MindMap", id: "root", props: {} },
      surface: "center_artifact",
      version: "liteasy.ui/v1"
    },
    verification: mindmapArtifact("pass").verification,
    version: "liteasy.agent-artifact/v1"
  };
}

const paper: Paper = {
  id: "demo-1",
  sourcePath: "fixtures/demo-1.pdf",
  title: "Attention Is All You Need"
};

describe("useArtifactWorkflowController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("exposes empty artifact workflow state before analysis starts", async () => {
    const artifactStore = createArtifactStore();

    const { result } = renderHook(() =>
      useArtifactWorkflowController({
        artifactStore,
        artifactResultClient: artifactResultClient(),
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint: vi.fn(),
        queueImportForPapers: vi.fn(() => "idle"),
        runAgentAnalysis: vi.fn(async () => completedRun())
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.model.artifactTabs).toEqual([]);
    expect(result.current.model.artifactTasks).toEqual([]);
  });

  test("exposes thin-reading visualization orchestration through the workflow boundary", async () => {
    const thinReadingDocument = createThinReadingDocument({
      artifactId: "artifact-thin-visual",
      papers: [{ id: paper.id, title: paper.title }],
      rootSeed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
        omittedSections: [],
        recommendations: [],
        summary: "The mechanism has two evidence-backed stages.",
        visualizationIntent: {
          candidateModalities: ["semantic_graph"],
          evidenceIds: ["evidence-1"],
          expectedLearningGain: "high",
          purpose: "show_process",
          requestedBy: "automatic"
        },
        withinPaperClosure: true
      },
      targetLanguage: "en"
    });
    const localRepository = {
      list: vi.fn(async () => [{
        artifactId: thinReadingDocument.artifactId,
        papers: [{ id: paper.id, title: paper.title }],
        thinReadingDocument,
        title: "Thin reading",
        type: "thin_reading" as const
      }]),
      replace: vi.fn(async () => undefined)
    };
    let settleGeneration!: () => void;
    const generateThinReadingVisualization = vi.fn(() => new Promise<readonly unknown[]>((resolve) => {
      settleGeneration = () => resolve([]);
    }));
    const cancelThinReadingVisualization = vi.fn(async () => undefined);
    const { result } = renderHook(() => useArtifactWorkflowController({
      artifactLocalRepository: localRepository,
      artifactResultClient: artifactResultClient(),
      artifactStore: createArtifactStore(),
      cancelThinReadingVisualization,
      generateThinReadingVisualization,
      getImportedChunksByPaperId: () => ({}),
      getMultimodalVisualizationCapability: () => availableCapability,
      getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
      getSelectedPapers: () => [],
      onAnalysisHint: vi.fn(),
      queueImportForPapers: vi.fn(() => "idle"),
      runAgentAnalysis: vi.fn(async () => completedRun())
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const node = thinReadingDocument.nodes[thinReadingDocument.rootNodeId];
    act(() => {
      void result.current.actions.startThinReadingVisualization({
        artifactId: thinReadingDocument.artifactId,
        document: thinReadingDocument,
        node
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(generateThinReadingVisualization).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: thinReadingDocument.artifactId,
      nodeId: node.id,
      requestedArtifactCount: 1,
      signal: expect.any(AbortSignal)
    }));
    await act(async () => {
      await result.current.actions.cancelThinReadingVisualization(node.id, "user_cancelled");
      settleGeneration();
      await Promise.resolve();
    });
    expect(cancelThinReadingVisualization).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: node.id,
      reason: "user_cancelled"
    }));
  });

  test("starts automatic visualization only after the generated thin-reading node is persisted", async () => {
    const client = artifactResultClient();
    let settleGeneration!: () => void;
    const generateThinReadingVisualization = vi.fn(() => new Promise<readonly unknown[]>((resolve) => {
      settleGeneration = () => resolve([]);
    }));
    const { result } = renderHook(() => useArtifactWorkflowController({
      artifactResultClient: client,
      artifactStore: createArtifactStore(),
      generateThinReadingVisualization,
      getImportedChunksByPaperId: () => ({
        [paper.id]: buildImportedChunksForPaper(paper)
      }),
      getImportedChunksForPaperId: () => buildImportedChunksForPaper(paper),
      getMultimodalVisualizationCapability: () => availableCapability,
      getSelectedDocumentSet: () => ({ documentIds: [paper.id], locked: true }),
      getSelectedPapers: () => [paper],
      onAnalysisHint: vi.fn(),
      queueImportForPapers: vi.fn(() => "already_imported"),
      runAgentAnalysis: vi.fn(async () => completedThinReadingRun())
    }));

    act(() => {
      result.current.actions.startAnalysis("thin_reading");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(client.save).toHaveBeenCalledBefore(generateThinReadingVisualization);
    expect(generateThinReadingVisualization).toHaveBeenCalledTimes(1);
    settleGeneration();
    await act(async () => {
      await Promise.resolve();
    });
  });

  test("marks a persisted in-flight thin-reading task as interrupted after restart", async () => {
    window.localStorage.setItem("liteasy.artifact-task-recovery/v1", JSON.stringify([{
      artifactId: "artifact-thin-interrupted",
      id: "artifact-task-4",
      message: "正在生成薄读下一层",
      progress: 58,
      stage: "thin_reading_generating_branch",
      status: "running",
      type: "thin_reading"
    }]));
    const onAnalysisHint = vi.fn();
    const { result } = renderHook(() =>
      useArtifactWorkflowController({
        artifactStore: createArtifactStore(),
        artifactResultClient: artifactResultClient(),
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint,
        queueImportForPapers: vi.fn(() => "idle"),
        runAgentAnalysis: vi.fn(async () => completedRun())
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.model.artifactTasks).toEqual([
      expect.objectContaining({
        artifactId: "artifact-thin-interrupted",
        stage: "failed",
        status: "failed",
        type: "thin_reading"
      })
    ]);
    expect(onAnalysisHint).toHaveBeenCalledWith(expect.stringContaining("未完成的生成任务"));
    expect(window.localStorage.getItem("liteasy.artifact-task-recovery/v1")).toBeNull();
  });

  test("re-submits a validated interrupted thin-reading branch as a new model request", async () => {
    const thinReadingDocument = createThinReadingDocument({
      artifactId: "artifact-thin-retry",
      papers: [{ id: paper.id, title: paper.title }],
      rootSeed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
        omittedSections: [],
        recommendations: [],
        summary: "论文的实验部分仍有待展开。",
        withinPaperClosure: true
      },
      targetLanguage: "zh-CN"
    });
    const snapshot = createThinReadingBranchRecoverySnapshot({
      artifactId: thinReadingDocument.artifactId,
      document: thinReadingDocument,
      parentNodeId: thinReadingDocument.rootNodeId,
      primaryPaperId: paper.id,
      source: { kind: "selected_text", excerpt: "实验部分" }
    });
    window.localStorage.setItem("liteasy.artifact-task-recovery/v1", JSON.stringify([{
      artifactId: thinReadingDocument.artifactId,
      id: "artifact-task-4",
      message: "正在生成薄读下一层",
      progress: 58,
      stage: "thin_reading_generating_branch",
      status: "running",
      thinReadingBranchRecovery: snapshot,
      type: "thin_reading"
    }]));
    const localRepository = {
      list: vi.fn(async () => [{
        artifactId: thinReadingDocument.artifactId,
        papers: [{ id: paper.id, title: paper.title }],
        thinReadingDocument,
        title: "薄读",
        type: "thin_reading" as const
      }]),
      replace: vi.fn(async () => undefined)
    };
    const generatedRun = completedRun();
    generatedRun.events[0] = {
      ...generatedRun.events[0],
      metadata: {
        analysis: (generatedRun.events[0] as Extract<AgentRun["events"][number], { type: "assistant.message" }>).metadata.analysis,
        thinReading: {
          rootSeed: {
            evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
            omittedSections: [],
            recommendations: [],
            summary: "实验结果显示方法具有可复核的提升。",
            withinPaperClosure: true
          }
        }
      }
    } as AgentRun["events"][number];
    const runAgentAnalysis = vi.fn(async () => generatedRun);
    const onAnalysisHint = vi.fn();
    const artifactStore = createArtifactStore();
    const { result } = renderHook(() =>
      useArtifactWorkflowController({
        artifactLocalRepository: localRepository,
        artifactResultClient: artifactResultClient(),
        artifactStore,
        getImportedChunksByPaperId: () => ({ [paper.id]: buildImportedChunksForPaper(paper) }),
        getImportedChunksForPaperId: (paperId) =>
          paperId === paper.id ? buildImportedChunksForPaper(paper) : [],
        getPaperById: (paperId) => paperId === paper.id ? paper : undefined,
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint,
        queueImportForPapers: vi.fn(() => "already_imported"),
        runAgentAnalysis
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.model.artifactTasks).toEqual([
      expect.objectContaining({
        id: "artifact-task-4",
        recoveredAfterRestart: true,
        status: "failed",
        thinReadingBranchRecovery: snapshot
      })
    ]);
    await act(async () => {
      await result.current.actions.retryInterruptedThinReadingBranch("artifact-task-4");
    });

    expect(runAgentAnalysis).toHaveBeenCalledWith("thin_reading", expect.any(Function), expect.objectContaining({
      thinReadingContext: expect.objectContaining({ parentNodeId: thinReadingDocument.rootNodeId })
    }));
    expect(onAnalysisHint).toHaveBeenCalledWith(expect.stringContaining("新的模型请求"));
    expect(Object.keys(result.current.model.artifactTabs[0]?.thinReadingDocument?.nodes ?? [])).toHaveLength(2);
  });

  test("updates workflow state when imported selected papers start analysis", async () => {
    const artifactStore = createArtifactStore();
    const onAnalysisHint = vi.fn();

    const { result } = renderHook(() =>
      useArtifactWorkflowController({
        artifactStore,
        artifactResultClient: artifactResultClient(),
        getImportedChunksByPaperId: () => ({
          [paper.id]: buildImportedChunksForPaper(paper)
        }),
        getSelectedDocumentSet: () => ({ documentIds: [paper.id], locked: true }),
        getSelectedPapers: () => [paper],
        onAnalysisHint,
        queueImportForPapers: vi.fn(() => "already_imported"),
        runAgentAnalysis: vi.fn(async () => completedRun())
      })
    );

    act(() => {
      result.current.actions.startAnalysis("mindmap");
    });

    expect(result.current.model.artifactTasks).toEqual([
      expect.objectContaining({ status: "running", type: "mindmap" })
    ]);
    expect(onAnalysisHint).toHaveBeenLastCalledWith("当前选中文献集已导入，正在按指定 AI 分析启动。");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.model.artifactTabs).toEqual([
      expect.objectContaining({
        mindmapArtifact: expect.objectContaining({
          verification: expect.objectContaining({ status: "pass" })
        }),
        preview: expect.objectContaining({ rootLabel: "Attention Is All You Need" }),
        title: "Literature Mind Map",
        type: "mindmap"
      })
    ]);
  });

  test("projects a stable failure when artifact workflow audit blocks persistence", async () => {
    const artifactStore = createArtifactStore();
    const onAnalysisHint = vi.fn();
    const client = artifactResultClient();

    const { result } = renderHook(() =>
      useArtifactWorkflowController({
        artifactStore,
        artifactResultClient: client,
        getImportedChunksByPaperId: () => ({
          [paper.id]: buildImportedChunksForPaper(paper)
        }),
        getSelectedDocumentSet: () => ({ documentIds: [paper.id], locked: true }),
        getSelectedPapers: () => [paper],
        onAnalysisHint,
        queueImportForPapers: vi.fn(() => "already_imported"),
        runAgentAnalysis: vi.fn(async () => completedRun({ workflowStatus: "blocked" }))
      })
    );

    act(() => {
      result.current.actions.startAnalysis("mindmap");
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(client.save).not.toHaveBeenCalled();
    expect(result.current.model.artifactTasks[0]).toEqual(expect.objectContaining({
      failure: expect.objectContaining({
        code: "artifact_verification_failed",
        message: expect.stringContaining("审计未通过")
      }),
      stage: "failed",
      status: "failed"
    }));
    expect(onAnalysisHint).toHaveBeenLastCalledWith(
      "Agent 分析失败：生成结果未通过证据校验，请调整资料或稍后重试。"
    );
  });

  test("restores saved artifacts into the catalog and opens them on demand", async () => {
    const artifactStore = createArtifactStore();
    const persisted = persistedArtifact();
    const client = {
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => [persisted]),
      save: vi.fn()
    };
    const { result } = renderHook(() =>
      useArtifactWorkflowController({
        artifactResultClient: client,
        artifactResultScopeKey: "https://cloud.example:user-a",
        artifactStore,
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint: vi.fn(),
        queueImportForPapers: vi.fn(() => "idle"),
        runAgentAnalysis: vi.fn(async () => completedRun())
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({
        agentRunId: "run-saved",
        artifactId: "artifact-saved",
        mindmapArtifact: expect.objectContaining({
          verification: expect.objectContaining({ status: "pass" })
        }),
        resultPath: "liteasy://agent-artifacts/artifact-saved"
      })
    ]);
    expect(result.current.model.artifactTabs).toEqual([]);

    act(() => {
      result.current.actions.openArtifact("artifact-saved");
    });
    expect(result.current.model.artifactTabs).toEqual([
      expect.objectContaining({ artifactId: "artifact-saved" })
    ]);

    act(() => {
      result.current.actions.closeArtifactTab("artifact-saved");
    });
    expect(result.current.model.artifactTabs).toEqual([]);
    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({ artifactId: "artifact-saved" })
    ]);
  });

  test("reports account artifact catalog loading until saved artifacts are restored", async () => {
    let resolveList: (artifacts: AgentArtifactResult[]) => void = () => undefined;
    const listPromise = new Promise<AgentArtifactResult[]>((resolve) => {
      resolveList = resolve;
    });
    const client = {
      ...artifactResultClient(),
      list: vi.fn(() => listPromise)
    };
    const { result } = renderHook(() =>
      useArtifactWorkflowController({
        artifactResultClient: client,
        artifactResultScopeKey: "https://cloud.example:user-a",
        artifactStore: createArtifactStore(),
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint: vi.fn(),
        queueImportForPapers: vi.fn(() => "idle"),
        runAgentAnalysis: vi.fn(async () => completedRun())
      })
    );

    expect(result.current.model.artifactCatalogLoadState).toEqual({ status: "loading" });

    await act(async () => {
      resolveList([persistedArtifact()]);
      await listPromise;
    });

    expect(result.current.model.artifactCatalogLoadState).toEqual({ status: "ready" });
    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({ artifactId: "artifact-saved" })
    ]);
  });

  test("reports account artifact catalog errors and retries without restarting recovery", async () => {
    const client = {
      ...artifactResultClient(),
      list: vi.fn()
        .mockRejectedValueOnce(new Error("network unavailable"))
        .mockResolvedValueOnce([persistedArtifact()])
    };
    const { result } = renderHook(() =>
      useArtifactWorkflowController({
        artifactResultClient: client,
        artifactResultScopeKey: "https://cloud.example:user-a",
        artifactStore: createArtifactStore(),
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint: vi.fn(),
        queueImportForPapers: vi.fn(() => "idle"),
        runAgentAnalysis: vi.fn(async () => completedRun())
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.model.artifactCatalogLoadState).toEqual({
      message: "network unavailable",
      status: "error"
    });

    await act(async () => {
      await result.current.actions.reloadArtifactCatalog();
    });

    expect(client.list).toHaveBeenCalledTimes(2);
    expect(result.current.model.artifactCatalogLoadState).toEqual({ status: "ready" });
    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({ artifactId: "artifact-saved" })
    ]);
  });

  test("does not reveal the device artifact catalog when an account service is unavailable", async () => {
    const artifactStore = createArtifactStore();
    const localRepository = {
      list: vi.fn(async () => [{
        artifactId: "artifact-local",
        createdAt: "2026-07-21T01:00:00.000Z",
        title: "Locally cached tree",
        type: "tree" as const
      }]),
      replace: vi.fn(async () => undefined)
    };
    const onAnalysisHint = vi.fn();
    const client = artifactResultClient();
    client.list.mockRejectedValueOnce(new Error("endpoint changed after login"));

    const { result } = renderHook(() =>
      useArtifactWorkflowController({
        artifactLocalRepository: localRepository,
        artifactResultClient: client,
        artifactResultScopeKey: "mock://before-login",
        artifactStore,
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint,
        queueImportForPapers: vi.fn(() => "idle"),
        runAgentAnalysis: vi.fn(async () => completedRun())
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.model.artifactCatalog).toEqual([]);
    expect(localRepository.list).not.toHaveBeenCalled();
    expect(localRepository.replace).not.toHaveBeenCalled();
    expect(onAnalysisHint).toHaveBeenLastCalledWith(
      "同步 Agent 产物服务失败：endpoint changed after login"
    );
  });

  test("restores and updates a locally cached thin-reading artifact", async () => {
    const artifactStore = createArtifactStore();
    const thinReadingDocument = createThinReadingDocument({
      artifactId: "artifact-thin-reading",
      papers: [{ id: paper.id, title: paper.title }],
      rootSeed: {
        evidence: {
          externalKnowledge: [],
          paperEvidence: ["evidence-1"]
        },
        omittedSections: [
          { id: "section-experiment", label: "实验", sectionKey: "experiment" }
        ],
        recommendations: [],
        summary: "ColBERT 的核心是用 MaxSim 保留 token-level matching signals。",
        withinPaperClosure: true
      },
      targetLanguage: "zh-CN"
    });
    const localRepository = {
      list: vi.fn(async () => [{
        artifactId: "artifact-thin-reading",
        createdAt: "2026-07-21T01:00:00.000Z",
        papers: [{ id: paper.id, title: paper.title }],
        thinReadingDocument,
        title: "薄读",
        type: "thin_reading" as const
      }]),
      replace: vi.fn(async () => undefined)
    };
    const client = artifactResultClient();
    client.list.mockRejectedValueOnce(new Error("endpoint unavailable"));

    const { result } = renderHook(() =>
      useArtifactWorkflowController({
        artifactLocalRepository: localRepository,
        artifactResultClient: client,
        artifactStore,
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint: vi.fn(),
        queueImportForPapers: vi.fn(() => "idle"),
        runAgentAnalysis: vi.fn(async () => completedRun())
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({
        artifactId: "artifact-thin-reading",
        thinReadingDocument: expect.objectContaining({ targetLanguage: "zh-CN" }),
        type: "thin_reading"
      })
    ]);

    act(() => {
      result.current.actions.openArtifact("artifact-thin-reading");
      result.current.actions.updateThinReadingDocument(
        "artifact-thin-reading",
        createThinReadingDocument({
          artifactId: "artifact-thin-reading",
          papers: [{ id: paper.id, title: paper.title }],
          rootSeed: {
            evidence: {
              externalKnowledge: [],
              paperEvidence: ["evidence-1"]
            },
            omittedSections: [
              { id: "section-evaluation", label: "Evaluation", sectionKey: "evaluation" }
            ],
            recommendations: [],
            summary: "ColBERT keeps token-level matching signals through MaxSim interaction.",
            withinPaperClosure: true
          },
          targetLanguage: "en-US"
        })
      );
    });

    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({
        artifactId: "artifact-thin-reading",
        thinReadingDocument: expect.objectContaining({ targetLanguage: "en-US" })
      })
    ]);
    expect(result.current.model.artifactTabs).toEqual([
      expect.objectContaining({
        artifactId: "artifact-thin-reading",
        thinReadingDocument: expect.objectContaining({ targetLanguage: "en-US" })
      })
    ]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localRepository.replace).toHaveBeenLastCalledWith([
      expect.objectContaining({
        artifactId: "artifact-thin-reading",
        thinReadingDocument: expect.objectContaining({ targetLanguage: "en-US" })
      })
    ]);
  });

  test("hydrates ready visualization history from a restored V2 document", async () => {
    const baseDocument = createThinReadingDocument({
      artifactId: "artifact-thin-ready",
      papers: [{ id: paper.id, title: paper.title }],
      rootSeed: {
        evidence: { externalKnowledge: [], paperEvidence: ["evidence-1"] },
        omittedSections: [],
        recommendations: [],
        summary: "Persisted explanation.",
        withinPaperClosure: true
      },
      targetLanguage: "en"
    });
    const root = baseDocument.nodes[baseDocument.rootNodeId];
    const restoredArtifact = { ...readyArtifact, nodeId: root.id };
    const thinReadingDocument = {
      ...baseDocument,
      nodes: {
        ...baseDocument.nodes,
        [root.id]: { ...root, visualizations: [restoredArtifact] }
      }
    };
    const { result } = renderHook(() => useArtifactWorkflowController({
      artifactLocalRepository: {
        list: vi.fn(async () => [{
          artifactId: thinReadingDocument.artifactId,
          papers: [{ id: paper.id, title: paper.title }],
          thinReadingDocument,
          title: "Thin reading",
          type: "thin_reading" as const
        }]),
        replace: vi.fn(async () => undefined)
      },
      artifactResultClient: artifactResultClient(),
      artifactStore: createArtifactStore(),
      getImportedChunksByPaperId: () => ({}),
      getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
      getSelectedPapers: () => [],
      onAnalysisHint: vi.fn(),
      queueImportForPapers: vi.fn(() => "idle"),
      runAgentAnalysis: vi.fn(async () => completedRun())
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.model.thinReadingVisualizationReadyArtifacts).toEqual([restoredArtifact]);
  });

  test("recovers pending visualizations once per account scope", async () => {
    const client = artifactResultClient();
    client.list.mockResolvedValue([{
      ...persistedArtifact(),
      artifactId: "thin-1",
      artifactType: "thin_reading",
      thinReadingDocument: documentWithNode(),
      title: "Recovered thin reading"
    }]);
    const pendingThinReadingVisualizations = vi.fn(() => [{
      artifactId: "thin-1",
      createdAt: "2026-08-10T08:00:00.000Z",
      nodeId: "node-root",
      requestId: "visualization-recovery",
      requestedArtifactCount: 1 as const
    }]);
    const resumeThinReadingVisualization = vi.fn(async () => []);
    const common = {
      artifactResultClient: client,
      artifactStore: createArtifactStore(),
      getImportedChunksByPaperId: () => ({}),
      getMultimodalVisualizationCapability: () => availableCapability,
      getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
      getSelectedPapers: () => [],
      onAnalysisHint: vi.fn(),
      pendingThinReadingVisualizations,
      queueImportForPapers: vi.fn(() => "idle" as const),
      resumeThinReadingVisualization,
      runAgentAnalysis: vi.fn(async () => completedRun())
    };
    const { rerender } = renderHook(
      ({ scopeKey }) => useArtifactWorkflowController({
        ...common,
        artifactResultScopeKey: scopeKey
      }),
      { initialProps: { scopeKey: "https://cloud.example:user-a" } }
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resumeThinReadingVisualization).toHaveBeenCalledTimes(1);
    expect(resumeThinReadingVisualization.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      requestId: "visualization-recovery"
    }));

    rerender({ scopeKey: "https://cloud.example:user-b" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resumeThinReadingVisualization).toHaveBeenCalledTimes(2);

    rerender({ scopeKey: "https://cloud.example:user-a" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resumeThinReadingVisualization).toHaveBeenCalledTimes(2);
  });

  test("disposes and remotely cancels recovered visualization requests", async () => {
    const client = artifactResultClient();
    const artifactStore = createArtifactStore();
    client.list.mockResolvedValue([{
      ...persistedArtifact(),
      artifactId: "thin-1",
      artifactType: "thin_reading",
      thinReadingDocument: documentWithNode(),
      title: "Recovered thin reading"
    }]);
    const cancelThinReadingVisualization = vi.fn(async () => undefined);
    const pendingThinReadingVisualizations = vi.fn(() => [{
      artifactId: "thin-1",
      createdAt: "2026-08-10T08:00:00.000Z",
      nodeId: "node-root",
      requestId: "visualization-recovery-active",
      requestedArtifactCount: 1 as const
    }]);
    const resumeThinReadingVisualization = vi.fn((_request, signal: AbortSignal) => (
      new Promise<readonly unknown[]>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true
        });
      })
    ));
    const { result } = renderHook(() => useArtifactWorkflowController({
      artifactResultClient: client,
      artifactResultScopeKey: "https://cloud.example:user-a",
      artifactStore,
      cancelThinReadingVisualization,
      getImportedChunksByPaperId: () => ({}),
      getMultimodalVisualizationCapability: () => availableCapability,
      getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
      getSelectedPapers: () => [],
      onAnalysisHint: vi.fn(),
      pendingThinReadingVisualizations,
      queueImportForPapers: vi.fn(() => "idle"),
      resumeThinReadingVisualization,
      runAgentAnalysis: vi.fn(async () => completedRun())
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(resumeThinReadingVisualization).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.actions.disposeThinReadingVisualizations();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(cancelThinReadingVisualization).toHaveBeenCalledWith({
      artifactId: "thin-1",
      nodeId: "node-root",
      reason: "workflow_disposed",
      requestId: "visualization-recovery-active"
    });
  });

  test("isolates server artifacts across login, account switch, and logout", async () => {
    const artifactStore = createArtifactStore();
    const persisted = {
      agent: {
        apiVersion: "liteasy.agent/v1",
        runId: "run-after-login",
        sessionId: "session-after-login",
        status: "completed" as const
      },
      answer: "restored after login",
      artifactId: "artifact-after-login",
      artifactType: "tree" as const,
      citations: [],
      createdAt: "2026-07-21T02:00:00.000Z",
      papers: [],
      title: "Restored after login",
      uiDsl: {
        actions: [],
        audit: {
          createdAt: "2026-07-21T02:00:00.000Z",
          generatedBy: "rule" as const,
          traceId: "trace-after-login"
        },
        dataSources: [],
        root: { component: "Tree" as const, id: "root", props: { nodes: [] } },
        surface: "center_artifact" as const,
        version: "liteasy.ui/v1" as const
      },
      version: "liteasy.agent-artifact/v1" as const
    };
    const accountBArtifact = {
      ...persisted,
      agent: { ...persisted.agent, runId: "run-account-b" },
      artifactId: "artifact-account-b",
      title: "Account B artifact"
    };
    const deviceArtifact = {
      ...persisted,
      agent: { ...persisted.agent, runId: "run-device" },
      artifactId: "artifact-device",
      title: "Device artifact"
    };
    const client = artifactResultClient();
    client.list.mockResolvedValueOnce([persisted]).mockResolvedValueOnce([accountBArtifact]);
    const localRepository = {
      list: vi.fn(async () => [deviceArtifact]),
      replace: vi.fn(async () => undefined)
    };

    const { result, rerender } = renderHook(
      ({ scopeKey }) => useArtifactWorkflowController({
        artifactLocalRepository: localRepository,
        artifactResultClient: client,
        artifactResultScopeKey: scopeKey,
        artifactStore,
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint: vi.fn(),
        queueImportForPapers: vi.fn(() => "idle"),
        runAgentAnalysis: vi.fn(async () => completedRun())
      }),
      { initialProps: { scopeKey: undefined as string | undefined } }
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(client.list).not.toHaveBeenCalled();
    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({ artifactId: "artifact-device" })
    ]);

    rerender({ scopeKey: "http://127.0.0.1:8791:user-a" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({ artifactId: "artifact-after-login" })
    ]);

    rerender({ scopeKey: "http://127.0.0.1:8791:user-b" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({ artifactId: "artifact-account-b" })
    ]);

    rerender({ scopeKey: undefined });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(client.list).toHaveBeenCalledTimes(2);
    expect(localRepository.list).toHaveBeenCalledTimes(2);
    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({ artifactId: "artifact-device" })
    ]);
    expect(localRepository.replace).not.toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ artifactId: "artifact-after-login" }),
      expect.objectContaining({ artifactId: "artifact-account-b" })
    ]));
  });
});
