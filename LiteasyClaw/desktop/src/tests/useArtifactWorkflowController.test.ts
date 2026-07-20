import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useArtifactWorkflowController } from "../app/controllers/useArtifactWorkflowController";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { buildImportedChunksForPaper } from "../app/features/import/importFixtures";
import type { Paper } from "../app/features/workspace/workspace.types";
import type { AgentRun } from "../app/features/agent-api/agentApi.types";

function completedRun(): AgentRun {
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
        }
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
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("exposes empty artifact workflow state before analysis starts", () => {
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
        preview: expect.objectContaining({ rootLabel: "Attention Is All You Need" }),
        title: "Literature Mind Map",
        type: "mindmap"
      })
    ]);
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
});
