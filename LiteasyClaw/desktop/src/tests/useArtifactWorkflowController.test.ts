import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useArtifactWorkflowController } from "../app/controllers/useArtifactWorkflowController";
import { createThinReadingDocument } from "../app/features/thin-reading/thinReadingProjection";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { buildImportedChunksForPaper } from "../app/features/import/importFixtures";
import type { Paper } from "../app/features/workspace/workspace.types";
import type { AgentRun } from "../app/features/agent-api/agentApi.types";

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

function artifactResultClient() {
  return {
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    save: vi.fn(async (document: { artifactId: string }) =>
      `project-docs/agent-results/${document.artifactId}.json`
    )
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
    expect(onAnalysisHint).toHaveBeenLastCalledWith("当前选中文献集已导入，正在按指定模态启动分析。");

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

  test("marks a mindmap task failed when artifact workflow audit blocks persistence", async () => {
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
      stage: "failed",
      status: "failed"
    }));
    expect(onAnalysisHint).toHaveBeenLastCalledWith(expect.stringContaining("审计未通过"));
  });

  test("restores saved artifacts into the catalog and opens them on demand", async () => {
    const artifactStore = createArtifactStore();
    const persisted = {
      agent: {
        apiVersion: "liteasy.agent/v1",
        runId: "run-saved",
        sessionId: "session-saved",
        status: "completed" as const
      },
      answer: "saved analysis",
      artifactId: "artifact-saved",
      artifactType: "mindmap" as const,
      citations: [],
      createdAt: "2026-07-20T03:00:00.000Z",
      mindmapArtifact: mindmapArtifact("pass"),
      papers: [{ id: paper.id, title: paper.title }],
      title: "Saved Mind Map",
      uiDsl: {
        actions: [],
        audit: {
          createdAt: "2026-07-20T03:00:00.000Z",
          generatedBy: "rule" as const,
          traceId: "trace-saved"
        },
        dataSources: [],
        root: { component: "MindMap" as const, id: "root", props: {} },
        surface: "center_artifact" as const,
        version: "liteasy.ui/v1" as const
      },
      verification: mindmapArtifact("pass").verification,
      version: "liteasy.agent-artifact/v1" as const
    };
    const client = {
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => [persisted]),
      save: vi.fn()
    };
    const { result } = renderHook(() =>
      useArtifactWorkflowController({
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
    });
    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({
        agentRunId: "run-saved",
        artifactId: "artifact-saved",
        mindmapArtifact: expect.objectContaining({
          verification: expect.objectContaining({ status: "pass" })
        }),
        resultPath: "project-docs/agent-results/artifact-saved.json"
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

  test("restores the local artifact catalog when the service is unavailable", async () => {
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

    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({ artifactId: "artifact-local" })
    ]);
    expect(localRepository.replace).toHaveBeenCalledWith([
      expect.objectContaining({ artifactId: "artifact-local" })
    ]);
    expect(onAnalysisHint).toHaveBeenLastCalledWith(
      "同步 Agent 产物服务失败，已保留本地记录：endpoint changed after login"
    );
  });

  test("restores and updates a locally cached thin-reading artifact", async () => {
    const artifactStore = createArtifactStore();
    const thinReadingDocument = createThinReadingDocument({
      artifactId: "artifact-thin-reading",
      papers: [{ id: paper.id, title: paper.title }],
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

  test("refreshes server artifacts when login changes the result endpoint", async () => {
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
    const client = artifactResultClient();
    client.list.mockResolvedValueOnce([]).mockResolvedValueOnce([persisted]);
    const localRepository = {
      list: vi.fn(async () => []),
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
      { initialProps: { scopeKey: "mock://before-login" } }
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    rerender({ scopeKey: "http://127.0.0.1:8791" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(client.list).toHaveBeenCalledTimes(2);
    expect(localRepository.list).toHaveBeenCalledTimes(1);
    expect(result.current.model.artifactCatalog).toEqual([
      expect.objectContaining({ artifactId: "artifact-after-login" })
    ]);
  });
});
