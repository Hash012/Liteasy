import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useArtifactWorkflowController } from "../app/controllers/useArtifactWorkflowController";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { buildImportedChunksForPaper } from "../app/features/import/importFixtures";
import type { Paper } from "../app/features/workspace/workspace.types";

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
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [], locked: false }),
        getSelectedPapers: () => [],
        onAnalysisHint: vi.fn(),
        queueImportForPapers: vi.fn(() => "idle")
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
        getImportedChunksByPaperId: () => ({
          [paper.id]: buildImportedChunksForPaper(paper)
        }),
        getSelectedDocumentSet: () => ({ documentIds: [paper.id], locked: true }),
        getSelectedPapers: () => [paper],
        onAnalysisHint,
        queueImportForPapers: vi.fn(() => "already_imported")
      })
    );

    act(() => {
      result.current.actions.startAnalysis("mindmap");
    });

    expect(result.current.model.artifactTasks).toEqual([
      { id: "artifact-task-1", status: "queued", type: "mindmap" }
    ]);
    expect(onAnalysisHint).toHaveBeenLastCalledWith("当前选中文献集已导入，正在按指定模态启动分析。");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(result.current.model.artifactTabs).toEqual([
      expect.objectContaining({
        preview: expect.objectContaining({ rootLabel: "Attention Is All You Need" }),
        title: "Literature Mind Map",
        type: "mindmap"
      })
    ]);
  });
});
