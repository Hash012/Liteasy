import type { ImportJob } from "../import/import.types";
import { buildImportedChunksForPaper } from "../import/importFixtures";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper, WorkspaceState } from "./workspace.types";
import type { createImportStore } from "../import/import.store";
import type { createWorkspaceStore } from "./workspace.store";

type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
type ImportStore = ReturnType<typeof createImportStore>;
export type ImportQueueStatus = "already_imported" | "idle" | "importing" | "started";

type ExternalLibraryItem = {
  id: string;
  source: string;
  title: string;
};

type UseWorkspaceActionsInput = {
  importDocument?: (sourcePath: string) => Promise<unknown>;
  importStore: ImportStore;
  onAnalysisHint: (message: string) => void;
  onImportJobsChanged: (jobsByDocumentId: Record<string, ImportJob>) => void;
  onWorkspaceChanged: (state: WorkspaceState) => void;
  workspaceStore: WorkspaceStore;
};

function cloneWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    papers: [...state.papers],
    selectedPaperIds: [...state.selectedPaperIds],
    selectionLocked: state.selectionLocked,
    workspaceRevision: state.workspaceRevision
  };
}

export function buildImportJobsByDocumentId(workspaceStore: WorkspaceStore, importStore: ImportStore) {
  return Object.fromEntries(
    workspaceStore.getState().papers.flatMap((paper) => {
      const latestJob = importStore.getLatestJobByDocumentId(paper.id);
      return latestJob ? [[paper.id, latestJob]] : [];
    })
  );
}

export function useWorkspaceActions({
  importDocument,
  importStore,
  onAnalysisHint,
  onImportJobsChanged,
  onWorkspaceChanged,
  workspaceStore
}: UseWorkspaceActionsInput) {
  function syncWorkspace() {
    onWorkspaceChanged(cloneWorkspaceState(workspaceStore.getState()));
  }

  function syncImportJobs() {
    onImportJobsChanged(buildImportJobsByDocumentId(workspaceStore, importStore));
  }

  function addExternalPaperToLibrary(item: ExternalLibraryItem) {
    const added = workspaceStore.addPaper({
      id: item.id,
      sourcePath: `external://${item.source}/${item.id}`,
      title: item.title
    });

    if (added) {
      syncWorkspace();
      onAnalysisHint(`已将《${item.title}》加入我的文献库。`);
      return;
    }

    onAnalysisHint(`《${item.title}》已经在我的文献库中。`);
  }

  function toggleSelection(paperId: string) {
    workspaceStore.toggleSelection(paperId);
    syncWorkspace();
  }

  function toggleSelectionLock() {
    const state = workspaceStore.getState();
    if (state.selectionLocked) {
      workspaceStore.unlockSelection();
      onAnalysisHint("已解除锁定。请调整选中文献集后，再选择模态按钮启动分析。");
    } else {
      workspaceStore.lockSelection();
      onAnalysisHint("选中文献集已锁定。可以先交给AI流程，或直接用模态按钮开始分析。");
    }
    syncWorkspace();
  }

  function getSelectedPapers() {
    const selectedIds = new Set(workspaceStore.getSelectedDocumentSet().documentIds);
    return workspaceStore.getState().papers.filter((paper) => selectedIds.has(paper.id));
  }

  function getImportedSelectedCount() {
    return getSelectedPapers().filter((paper) => {
      const latestJob = importStore.getLatestJobByDocumentId(paper.id);
      return latestJob?.status === "parsed";
    }).length;
  }

  function getImportedChunksByPaperId() {
    return Object.fromEntries(
      getSelectedPapers().map((paper) => [paper.id, importStore.getParsedChunksByDocumentId(paper.id)])
    ) as Record<string, RetrievalChunk[]>;
  }

  function queueImportForPapers(papers: Paper[], onComplete?: () => void): ImportQueueStatus {
    if (papers.length === 0) {
      return "idle";
    }

    let pending = 0;
    let importing = false;
    let alreadyImported = 0;

    papers.forEach((paper) => {
      const latestJob = importStore.getLatestJobByDocumentId(paper.id);
      if (latestJob?.status === "parsed") {
        alreadyImported += 1;
        return;
      }

      if (latestJob?.status === "queued" || latestJob?.status === "parsing") {
        importing = true;
        return;
      }

      pending += 1;
      const sourcePath = paper.sourcePath ?? `fixtures/${paper.id}.pdf`;
      const jobId = importStore.startImport({
        documentId: paper.id,
        sourcePath
      });
      syncImportJobs();

      void importDocument?.(sourcePath).catch(() => {
        // Keeps browser-only preview usable outside the Tauri shell.
      });

      window.setTimeout(() => {
        importStore.markParsing(jobId);
        syncImportJobs();
      }, 400);

      window.setTimeout(() => {
        importStore.markParsed(jobId, {
          paperId: paper.id,
          chunks: buildImportedChunksForPaper(paper)
        });
        syncImportJobs();
        pending -= 1;
        if (pending === 0) {
          onComplete?.();
        }
      }, 1200);
    });

    if (pending > 0) {
      return "started";
    }

    if (importing) {
      return "importing";
    }

    if (alreadyImported === papers.length) {
      return "already_imported";
    }

    return "idle";
  }

  function importSelectedSet() {
    const selectedPapers = getSelectedPapers();

    if (selectedPapers.length === 0) {
      const message = "请先在工作区勾选文件，形成选中文献集。";
      onAnalysisHint(message);
      return message;
    }

    const importStatus = queueImportForPapers(selectedPapers, () => {
      onAnalysisHint("选中文献集已完成导入，现在可以通过中栏模态按钮启动分析。");
    });

    if (importStatus === "started") {
      const message = "已将当前选中文献集交给 AI 流程，正在执行解析与索引。";
      onAnalysisHint(message);
      return message;
    }

    if (importStatus === "importing") {
      const message = "当前选中文献集正在导入，请稍后再开始分析。";
      onAnalysisHint(message);
      return message;
    }

    const message = "当前选中文献集已经导入完成，可以直接开始分析。";
    onAnalysisHint(message);
    return message;
  }

  return {
    addExternalPaperToLibrary,
    getImportedChunksByPaperId,
    getImportedSelectedCount,
    getSelectedPapers,
    importSelectedSet,
    queueImportForPapers,
    syncImportJobs,
    syncWorkspace,
    toggleSelection,
    toggleSelectionLock
  };
}
