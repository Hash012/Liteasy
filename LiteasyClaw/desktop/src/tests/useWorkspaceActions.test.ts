import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createImportStore } from "../app/features/import/import.store";
import { buildImportedChunksForPaper } from "../app/features/import/importFixtures";
import { createWorkspaceStore } from "../app/features/workspace/workspace.store";
import type { Paper, WorkspaceState } from "../app/features/workspace/workspace.types";
import { useWorkspaceActions } from "../app/features/workspace/useWorkspaceActions";
import type { MoveLocalLibraryResource } from "../app/features/library/libraryFileSystemClient";
import type { PersistDroppedPdfFiles } from "../app/features/library/libraryFileSystemClient";

function cloneWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    papers: [...state.papers],
    selectedPaperIds: [...state.selectedPaperIds],
    selectionLocked: state.selectionLocked,
    workspaceSource: { ...state.workspaceSource },
    workspaceRevision: state.workspaceRevision
  };
}

function renderWorkspaceActions(
  papers: Paper[] = [],
  options: {
    extractPaperChunks?: (paper: Paper) => Promise<ReturnType<typeof buildImportedChunksForPaper>>;
    moveLocalLibraryResource?: MoveLocalLibraryResource;
    persistDroppedPdfFiles?: PersistDroppedPdfFiles;
    workspaceRootPath?: string;
  } = {}
) {
  const workspaceStore = createWorkspaceStore();
  if (options.workspaceRootPath) {
    workspaceStore.openWorkspace(papers, {
      rootPath: options.workspaceRootPath,
      type: "local_library"
    });
  } else {
    papers.forEach((paper) => workspaceStore.addPaper(paper));
  }
  const importStore = createImportStore();
  const onAnalysisHint = vi.fn();
  const onImportJobsChanged = vi.fn();
  const onWorkspaceChanged = vi.fn();
  const hook = renderHook(() =>
    useWorkspaceActions({
      extractPaperChunks: options.extractPaperChunks ?? ((paper) => new Promise((resolve) => {
        window.setTimeout(() => resolve(buildImportedChunksForPaper(paper)), 800);
      })),
      importDocument: vi.fn(() => Promise.resolve()),
      importStore,
      moveLocalLibraryResource: options.moveLocalLibraryResource,
      persistDroppedPdfFiles: options.persistDroppedPdfFiles,
      onAnalysisHint,
      onImportJobsChanged,
      onWorkspaceChanged,
      workspaceStore
    })
  );

  return {
    importStore,
    onAnalysisHint,
    onImportJobsChanged,
    onWorkspaceChanged,
    result: hook.result,
    workspaceStore
  };
}

describe("useWorkspaceActions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("toggles selection lock and syncs workspace state", () => {
    const paper = { id: "demo-1", sourcePath: "fixtures/demo-1.pdf", title: "Demo Paper" };
    const { onAnalysisHint, onWorkspaceChanged, result, workspaceStore } = renderWorkspaceActions([paper]);

    act(() => result.current.toggleSelection(paper.id));
    expect(workspaceStore.getState().selectedPaperIds).toEqual([paper.id]);
    expect(onWorkspaceChanged).toHaveBeenLastCalledWith(cloneWorkspaceState(workspaceStore.getState()));

    act(() => result.current.toggleSelectionLock());
    expect(workspaceStore.getState().selectionLocked).toBe(true);
    expect(onAnalysisHint).toHaveBeenLastCalledWith("选中文献集已锁定。可以先交给 AI 流程，或直接用 AI 按钮开始分析。");

    act(() => result.current.toggleSelectionLock());
    expect(workspaceStore.getState().selectionLocked).toBe(false);
    expect(onAnalysisHint).toHaveBeenLastCalledWith("已解除锁定。请调整选中文献集后，再选择 AI 按钮启动分析。");
  });

  test("adds external papers once and reports duplicate drops", () => {
    const { onAnalysisHint, result, workspaceStore } = renderWorkspaceActions();

    act(() =>
      result.current.addExternalPaperToLibrary({
        id: "rec-1",
        source: "recommendation",
        title: "Recommended Paper"
      })
    );
    expect(workspaceStore.getState().papers).toEqual([
      {
        id: "rec-1",
        sourcePath: "external://recommendation/rec-1",
        title: "Recommended Paper"
      }
    ]);
    expect(onAnalysisHint).toHaveBeenLastCalledWith("已将《Recommended Paper》加入我的文献库。");

    act(() =>
      result.current.addExternalPaperToLibrary({
        id: "rec-1",
        source: "recommendation",
        title: "Recommended Paper"
      })
    );
    expect(workspaceStore.getState().papers).toHaveLength(1);
    expect(onAnalysisHint).toHaveBeenLastCalledWith("《Recommended Paper》已经在我的文献库中。");
  });

  test("persists dropped PDFs in the selected local library folder instead of using a localhost blob URL", async () => {
    const persistDroppedPdfFiles = vi.fn(() => Promise.resolve({
      entries: [{
        id: "local-1",
        path: "/tmp/LiteasyLibrary/courses/retrieval.pdf",
        title: "retrieval"
      }],
      rootPath: "/tmp/LiteasyLibrary"
    }));
    const { result, workspaceStore } = renderWorkspaceActions([], {
      persistDroppedPdfFiles,
      workspaceRootPath: "/tmp/LiteasyLibrary"
    });

    await act(async () => {
      await result.current.addDroppedPdfFiles(
        [new File(["pdf"], "retrieval.pdf", { type: "application/pdf" })],
        "/tmp/LiteasyLibrary/courses"
      );
    });

    expect(persistDroppedPdfFiles).toHaveBeenCalledWith(expect.objectContaining({
      targetFolderPath: "/tmp/LiteasyLibrary/courses"
    }));
    expect(workspaceStore.getState().papers).toEqual([{
      id: "local-1",
      sourcePath: "/tmp/LiteasyLibrary/courses/retrieval.pdf",
      title: "retrieval"
    }]);
  });

  test("renames a managed PDF on disk before updating its stable workspace entry", async () => {
    const moveLocalLibraryResource = vi.fn(() => Promise.resolve());
    const paper = {
      id: "paper-1",
      sourcePath: "/tmp/LiteasyLibrary/papers/colbert.pdf",
      title: "ColBERT"
    };
    const { result, workspaceStore } = renderWorkspaceActions([paper], {
      moveLocalLibraryResource,
      workspaceRootPath: "/tmp/LiteasyLibrary"
    });
    workspaceStore.toggleSelection(paper.id);

    await act(async () => {
      await result.current.renamePaper(paper.id, "ColBERT Revised");
    });

    expect(moveLocalLibraryResource).toHaveBeenCalledWith({
      sourcePath: "/tmp/LiteasyLibrary/papers/colbert.pdf",
      targetPath: "/tmp/LiteasyLibrary/papers/ColBERT Revised.pdf"
    });
    expect(workspaceStore.getState()).toMatchObject({
      papers: [{
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/papers/ColBERT Revised.pdf",
        title: "ColBERT Revised"
      }],
      selectedPaperIds: ["paper-1"]
    });
  });

  test("moves a directory and updates every descendant only after disk success", async () => {
    const moveLocalLibraryResource = vi.fn(() => Promise.resolve());
    const { result, workspaceStore } = renderWorkspaceActions([
      {
        id: "paper-1",
        sourcePath: "/tmp/LiteasyLibrary/search/colbert.pdf",
        title: "ColBERT"
      },
      {
        id: "paper-2",
        sourcePath: "/tmp/LiteasyLibrary/search/late/maxsim.pdf",
        title: "MaxSim"
      }
    ], {
      moveLocalLibraryResource,
      workspaceRootPath: "/tmp/LiteasyLibrary"
    });

    await act(async () => {
      await result.current.moveFolder(
        "/tmp/LiteasyLibrary/search",
        "/tmp/LiteasyLibrary/archive"
      );
    });

    expect(moveLocalLibraryResource).toHaveBeenCalledWith({
      sourcePath: "/tmp/LiteasyLibrary/search",
      targetPath: "/tmp/LiteasyLibrary/archive/search"
    });
    expect(workspaceStore.getState().papers.map((paper) => paper.sourcePath)).toEqual([
      "/tmp/LiteasyLibrary/archive/search/colbert.pdf",
      "/tmp/LiteasyLibrary/archive/search/late/maxsim.pdf"
    ]);
  });

  test("keeps workspace paths unchanged when the disk operation fails", async () => {
    const moveLocalLibraryResource = vi.fn(() => Promise.reject(new Error("permission denied")));
    const paper = {
      id: "paper-1",
      sourcePath: "/tmp/LiteasyLibrary/papers/colbert.pdf",
      title: "ColBERT"
    };
    const { onAnalysisHint, result, workspaceStore } = renderWorkspaceActions([paper], {
      moveLocalLibraryResource,
      workspaceRootPath: "/tmp/LiteasyLibrary"
    });

    await act(async () => {
      await result.current.movePaper("paper-1", "/tmp/LiteasyLibrary/archive");
    });

    expect(workspaceStore.getState().papers).toEqual([paper]);
    expect(onAnalysisHint).toHaveBeenLastCalledWith("移动失败：permission denied");
  });

  test("imports the selected set and exposes imported chunks after timers complete", async () => {
    const paper = { id: "demo-1", sourcePath: "fixtures/demo-1.pdf", title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT" };
    const { importStore, onAnalysisHint, onImportJobsChanged, result, workspaceStore } = renderWorkspaceActions([paper]);

    act(() => result.current.toggleSelection(paper.id));

    let message = "";
    act(() => {
      message = result.current.importSelectedSet();
    });
    expect(message).toBe("已将当前选中文献集交给 AI 流程，正在执行解析与索引。");
    expect(importStore.getLatestJobByDocumentId(paper.id)?.status).toBe("queued");
    expect(onImportJobsChanged).toHaveBeenLastCalledWith({
      [paper.id]: importStore.getLatestJobByDocumentId(paper.id)
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(importStore.getLatestJobByDocumentId(paper.id)?.status).toBe("parsing");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(importStore.getLatestJobByDocumentId(paper.id)?.status).toBe("parsed");
    expect(onAnalysisHint).toHaveBeenLastCalledWith("选中文献集已完成导入，现在可以通过中栏 AI 按钮启动分析。");
    expect(result.current.getImportedSelectedCount()).toBe(1);
    expect(result.current.getImportedChunksByPaperId()[paper.id]).toHaveLength(2);
    expect(workspaceStore.getState().selectedPaperIds).toEqual([paper.id]);
  });

  test("fills missing DOI and arXiv metadata from explicitly marked first-page text", async () => {
    const paper = { id: "demo-identifiers", sourcePath: "fixtures/identifiers.pdf", title: "Metadata from PDF" };
    const { result, workspaceStore } = renderWorkspaceActions([paper], {
      extractPaperChunks: async (input) => [{
        page: 1,
        paperId: input.id,
        paperTitle: input.title,
        snippet: "Preprint arXiv: 1706.03762v5. DOI: 10.48550/arXiv.1706.03762",
        summary: "identifier page",
        tags: []
      }]
    });

    act(() => result.current.toggleSelection(paper.id));
    act(() => {
      result.current.importSelectedSet();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(workspaceStore.getState().papers).toEqual([
      expect.objectContaining({
        arxivId: "1706.03762v5",
        doi: "10.48550/arxiv.1706.03762",
        id: paper.id
      })
    ]);
  });

  test("does not queue duplicate imports while a selected paper is already queued or parsing", async () => {
    const paper = { id: "demo-1", sourcePath: "fixtures/demo-1.pdf", title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT" };
    const { importStore, result } = renderWorkspaceActions([paper]);

    act(() => result.current.toggleSelection(paper.id));
    act(() => {
      result.current.importSelectedSet();
    });
    expect(importStore.listJobs()).toHaveLength(1);

    let queuedMessage = "";
    act(() => {
      queuedMessage = result.current.importSelectedSet();
    });
    expect(queuedMessage).toBe("当前选中文献集正在导入，请稍后再开始分析。");
    expect(importStore.listJobs()).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    let parsingMessage = "";
    act(() => {
      parsingMessage = result.current.importSelectedSet();
    });
    expect(parsingMessage).toBe("当前选中文献集正在导入，请稍后再开始分析。");
    expect(importStore.listJobs()).toHaveLength(1);
  });

  test("returns the already-imported message without queuing duplicate imports", async () => {
    const paper = { id: "demo-1", sourcePath: "fixtures/demo-1.pdf", title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT" };
    const { importStore, result } = renderWorkspaceActions([paper]);

    act(() => result.current.toggleSelection(paper.id));
    act(() => {
      result.current.importSelectedSet();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(importStore.listJobs()).toHaveLength(1);

    let message = "";
    act(() => {
      message = result.current.importSelectedSet();
    });

    expect(message).toBe("当前选中文献集已经导入完成，可以直接开始分析。");
    expect(importStore.listJobs()).toHaveLength(1);
  });
});
