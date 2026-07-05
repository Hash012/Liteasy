import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createArtifactStore } from "../app/features/artifacts/artifact.store";
import { buildImportedChunksForPaper } from "../app/features/import/importFixtures";
import type { ArtifactTab, ArtifactTask } from "../app/features/artifacts/artifact.types";
import type { Paper } from "../app/features/workspace/workspace.types";
import { useArtifactActions } from "../app/features/artifacts/useArtifactActions";

const paper: Paper = {
  id: "demo-1",
  sourcePath: "fixtures/demo-1.pdf",
  title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
};

function renderArtifactActions(options: {
  imported?: boolean;
  locked?: boolean;
  selectedPapers?: Paper[];
} = {}) {
  const artifactStore = createArtifactStore();
  const onAnalysisHint = vi.fn();
  const onArtifactTabsChanged = vi.fn<(tabs: ArtifactTab[]) => void>();
  const onArtifactTasksChanged = vi.fn<(tasks: ArtifactTask[]) => void>();
  const selectedPapers = options.selectedPapers ?? [paper];
  const selectedDocumentSet = {
    documentIds: selectedPapers.map((item) => item.id),
    locked: options.locked ?? true
  };
  const importedChunks = options.imported
    ? Object.fromEntries(selectedPapers.map((item) => [item.id, buildImportedChunksForPaper(item)]))
    : {};
  const queueImportForPapers = vi.fn((queuedPapers: Paper[], onComplete?: () => void) => {
    if (options.imported) {
      return "already_imported";
    }
    window.setTimeout(() => onComplete?.(), 1200);
    return queuedPapers.length > 0 ? "started" : "idle";
  });

  const hook = renderHook(() =>
    useArtifactActions({
      artifactStore,
      getImportedChunksByPaperId: () => importedChunks,
      getSelectedDocumentSet: () => selectedDocumentSet,
      getSelectedPapers: () => selectedPapers,
      onAnalysisHint,
      onArtifactTabsChanged,
      onArtifactTasksChanged,
      queueImportForPapers
    })
  );

  return {
    onAnalysisHint,
    onArtifactTabsChanged,
    onArtifactTasksChanged,
    queueImportForPapers,
    result: hook.result
  };
}

describe("useArtifactActions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("requires a selected and locked document set before analysis", () => {
    const empty = renderArtifactActions({ selectedPapers: [] });

    let message = "";
    act(() => {
      message = empty.result.current.startAnalysis("mindmap");
    });
    expect(message).toBe("请先在工作区勾选文件，形成选中文献集。");
    expect(empty.onAnalysisHint).toHaveBeenLastCalledWith("请先在工作区勾选文件，形成选中文献集。");

    const unlocked = renderArtifactActions({ locked: false });
    act(() => {
      message = unlocked.result.current.startAnalysis("tree");
    });
    expect(message).toBe("请先锁定选中文献集，再启动模态分析。");
    expect(unlocked.queueImportForPapers).not.toHaveBeenCalled();
  });

  test("queues imports before starting analysis when selected papers are not imported", async () => {
    const { onAnalysisHint, onArtifactTabsChanged, onArtifactTasksChanged, queueImportForPapers, result } = renderArtifactActions();

    let message = "";
    act(() => {
      message = result.current.startAnalysis("mindmap");
    });

    expect(message).toBe("当前选中文献集尚未全部导入，系统会先导入，再自动启动该模态分析。");
    expect(queueImportForPapers).toHaveBeenCalledWith([paper], expect.any(Function));
    expect(onArtifactTasksChanged).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onArtifactTasksChanged).toHaveBeenLastCalledWith([
      { id: "artifact-task-1", status: "queued", type: "mindmap" }
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ title: "Literature Mind Map", type: "mindmap" })
    ]);
    expect(onAnalysisHint).toHaveBeenLastCalledWith("导入完成，已按指定模态启动主工作流。");
  });

  test("starts analysis immediately when selected papers are already imported", async () => {
    const { onAnalysisHint, onArtifactTabsChanged, onArtifactTasksChanged, result } = renderArtifactActions({
      imported: true
    });

    let message = "";
    act(() => {
      message = result.current.startAnalysis("ppt");
    });

    expect(message).toBe("当前选中文献集已导入，正在按指定模态启动分析。");
    expect(onAnalysisHint).toHaveBeenLastCalledWith("当前选中文献集已导入，正在按指定模态启动分析。");
    expect(onArtifactTasksChanged).toHaveBeenLastCalledWith([
      { id: "artifact-task-1", status: "queued", type: "ppt" }
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({ title: "Literature PPT Outline", type: "ppt" })
    ]);
  });

  test("starts comparison-table analysis as a first-class artifact type", async () => {
    const { onArtifactTabsChanged, onArtifactTasksChanged, result } = renderArtifactActions({
      imported: true
    });

    act(() => {
      result.current.startAnalysis("comparison_table");
    });

    expect(onArtifactTasksChanged).toHaveBeenLastCalledWith([
      { id: "artifact-task-1", status: "queued", type: "comparison_table" }
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({
        title: "Literature Comparison Table",
        type: "comparison_table",
        uiDsl: expect.objectContaining({
          root: expect.objectContaining({
            children: expect.arrayContaining([
              expect.objectContaining({
                component: "ComparisonTable",
                props: expect.objectContaining({
                  title: "Literature Comparison Table"
                })
              }),
              expect.objectContaining({
                component: "EvidenceMatrix"
              }),
              expect.objectContaining({
                component: "ActionBar",
                props: expect.objectContaining({
                  actionIds: ["open-artifact-1"]
                })
              })
            ]),
            component: "Stack"
          }),
          actions: expect.arrayContaining([
            expect.objectContaining({
              actionId: "artifact.open_tab",
              id: "open-artifact-1",
              input: expect.objectContaining({
                artifactId: "artifact-1",
                artifactType: "comparison_table"
              })
            })
          ]),
          surface: "center_artifact"
        })
      })
    ]);
  });

  test.each([
    ["mindmap", "MindMap"],
    ["tree", "TreeOutline"],
    ["ppt", "SlideDeck"]
  ] as const)("creates a typed center artifact DSL for %s analysis", async (artifactType, component) => {
    const { onArtifactTabsChanged, result } = renderArtifactActions({
      imported: true
    });

    act(() => {
      result.current.startAnalysis(artifactType);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(onArtifactTabsChanged).toHaveBeenLastCalledWith([
      expect.objectContaining({
        type: artifactType,
        uiDsl: expect.objectContaining({
          root: expect.objectContaining({
            children: expect.arrayContaining([
              expect.objectContaining({
                component: "ActionBar"
              })
            ]),
            component
          }),
          actions: expect.arrayContaining([
            expect.objectContaining({
              actionId: "artifact.open_tab",
              id: "open-artifact-1",
              input: expect.objectContaining({
                artifactId: "artifact-1",
                artifactType
              })
            })
          ]),
          surface: "center_artifact"
        })
      })
    ]);
  });

  test("does not start duplicate analysis while selected papers are still importing", () => {
    const artifactStore = createArtifactStore();
    const onAnalysisHint = vi.fn();
    const onArtifactTabsChanged = vi.fn<(tabs: ArtifactTab[]) => void>();
    const onArtifactTasksChanged = vi.fn<(tasks: ArtifactTask[]) => void>();
    const queueImportForPapers = vi.fn(() => "importing" as const);
    const hook = renderHook(() =>
      useArtifactActions({
        artifactStore,
        getImportedChunksByPaperId: () => ({}),
        getSelectedDocumentSet: () => ({ documentIds: [paper.id], locked: true }),
        getSelectedPapers: () => [paper],
        onAnalysisHint,
        onArtifactTabsChanged,
        onArtifactTasksChanged,
        queueImportForPapers
      })
    );

    let message = "";
    act(() => {
      message = hook.result.current.startAnalysis("tree");
    });

    expect(message).toBe("当前选中文献集正在导入，请稍后再开始分析。");
    expect(onArtifactTasksChanged).not.toHaveBeenCalled();
    expect(onArtifactTabsChanged).not.toHaveBeenCalled();
    expect(onAnalysisHint).toHaveBeenLastCalledWith("当前选中文献集正在导入，请稍后再开始分析。");
  });

  test("assistant artifact command delegates to the selected-set analysis flow", () => {
    const { result } = renderArtifactActions();

    let message = "";
    act(() => {
      message = result.current.handleAssistantArtifact("tree");
    });

    expect(message).toBe("已根据当前选中文献集触发分支 skill；如尚未导入，系统会先导入再开始生成产物。");
  });
});
