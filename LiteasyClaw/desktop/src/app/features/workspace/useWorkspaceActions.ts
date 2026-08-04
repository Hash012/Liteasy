import type { ImportJob } from "../import/import.types";
import { buildImportedChunksForPaper } from "../import/importFixtures";
import {
  extractPdfIndexForPaper,
  type ExtractedPdfPage,
  type PdfOcrLanguage
} from "../import/pdfTextExtractor";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper, WorkspaceState } from "./workspace.types";
import { inferPaperIdentityMetadataFromPdfText } from "../paper-identity/paperIdentity";
import type { createImportStore } from "../import/import.store";
import type { createWorkspaceStore } from "./workspace.store";
import type { MoveLocalLibraryResource } from "../library/libraryFileSystemClient";
import type { PersistDroppedPdfFiles } from "../library/libraryFileSystemClient";
import type { ReadLocalLibraryPdf } from "../library/libraryFileSystemClient";
import { sanitizeExternalPdfFileName } from "../library/externalPdfDownload";
import { saveUserPaperArtifact } from "../library/userPaperArtifactClient";
import { buildPaperFulltextSnapshot } from "../pdf/paperFulltextStore";
import {
  buildMovedFolderPath,
  buildMovedPaper,
  buildRenamedFolderPath,
  buildRenamedPaper,
  isWorkspacePathWithinRoot,
  normalizeWorkspacePath,
  replaceWorkspacePathPrefix
} from "./workspacePathOperations";

type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
type ImportStore = ReturnType<typeof createImportStore>;
export type ImportQueueStatus = "already_imported" | "idle" | "importing" | "started";

type ExternalLibraryItem = {
  id: string;
  source: string;
  title: string;
};

type ExternalPdfLibraryItem = {
  bytes: Uint8Array;
  fileName: string;
  title: string;
};

function normalizeDroppedFileTitle(name: string) {
  return name.replace(/\.pdf$/i, "");
}

function buildDroppedPaperId(file: File) {
  return `dropped-${file.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${file.size}`;
}

function createBrowserPdfSource(file: File, fallbackPath: string) {
  return typeof URL.createObjectURL === "function"
    ? URL.createObjectURL(file)
    : fallbackPath;
}

type UseWorkspaceActionsInput = {
  extractPaperChunks?: (paper: Paper) => Promise<RetrievalChunk[]>;
  extractPaperIndex?: (paper: Paper) => Promise<{
    chunks: RetrievalChunk[];
    pages: ExtractedPdfPage[];
  }>;
  ocrLanguage?: PdfOcrLanguage;
  importDocument?: (sourcePath: string) => Promise<unknown>;
  importStore: ImportStore;
  loadPdfSource?: ReadLocalLibraryPdf;
  moveLocalLibraryResource?: MoveLocalLibraryResource;
  persistDroppedPdfFiles?: PersistDroppedPdfFiles;
  savePaperArtifact?: typeof saveUserPaperArtifact;
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
    workspaceSource: { ...state.workspaceSource },
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
  extractPaperChunks,
  extractPaperIndex,
  importDocument,
  importStore,
  loadPdfSource,
  moveLocalLibraryResource,
  persistDroppedPdfFiles,
  savePaperArtifact = saveUserPaperArtifact,
  onAnalysisHint,
  onImportJobsChanged,
  onWorkspaceChanged,
  ocrLanguage = "eng",
  workspaceStore
}: UseWorkspaceActionsInput) {
  const resolvePaperIndex = extractPaperIndex ?? (extractPaperChunks
    ? async (paper: Paper) => ({ chunks: await extractPaperChunks(paper), pages: undefined })
    : async (paper: Paper) => {
        try {
          return await extractPdfIndexForPaper(paper, { loadPdfSource, ocrLanguage });
        } catch (error) {
          if (["demo-1", "demo-2", "demo-3"].includes(paper.id)) {
            return { chunks: buildImportedChunksForPaper(paper), pages: undefined };
          }
          throw error;
        }
      });

  /**
   * The durable text of an imported paper.
   *
   * Kept at import time, and kept in the library rather than the cache, because thin reading
   * positions its evidence against these offsets and OCR is not reproducible: re-extracting a
   * scanned paper later can yield different text and silently move every span that points into it.
   */
  async function persistExtractedPaperArtifacts(paper: Paper, pages: ExtractedPdfPage[]) {
    await savePaperArtifact({
      artifactKind: "fulltext",
      paperId: paper.id,
      snapshot: buildPaperFulltextSnapshot({
        extractedAt: new Date().toISOString(),
        pageTextExtractions: Object.fromEntries(pages
          .filter((page) => page.textExtraction)
          .map((page) => [page.page, page.textExtraction!])),
        pageTexts: Object.fromEntries(pages.map((page) => [page.page, page.text]))
      })
    });
  }

  function syncWorkspace() {
    onWorkspaceChanged(cloneWorkspaceState(workspaceStore.getState()));
  }

  function syncImportJobs() {
    onImportJobsChanged(buildImportJobsByDocumentId(workspaceStore, importStore));
  }

  function requireLocalWorkspace() {
    const state = workspaceStore.getState();
    if (state.workspaceSource.type !== "local_library") {
      throw new Error("组织共享文献库是只读视图，不能在这里移动或重命名。");
    }
    return state;
  }

  function ensureTargetPathsAvailable(updatedPapers: Paper[], changedPaperIds: Set<string>) {
    const state = workspaceStore.getState();
    const occupiedPaths = new Set(
      state.papers
        .filter((paper) => !changedPaperIds.has(paper.id) && paper.sourcePath)
        .map((paper) => normalizeWorkspacePath(paper.sourcePath!))
    );
    const nextPaths = new Set<string>();
    updatedPapers.forEach((paper) => {
      if (!paper.sourcePath) {
        return;
      }
      const path = normalizeWorkspacePath(paper.sourcePath);
      if (occupiedPaths.has(path) || nextPaths.has(path)) {
        throw new Error(`目标位置已存在同名条目：${path}`);
      }
      nextPaths.add(path);
    });
  }

  async function movePhysicalResourceIfManaged(sourcePath: string, targetPath: string) {
    const state = workspaceStore.getState();
    if (
      moveLocalLibraryResource &&
      isWorkspacePathWithinRoot(sourcePath, state.workspaceSource.rootPath) &&
      isWorkspacePathWithinRoot(targetPath, state.workspaceSource.rootPath)
    ) {
      await moveLocalLibraryResource({ sourcePath, targetPath });
    }
  }

  async function renamePaper(paperId: string, requestedName: string) {
    try {
      const state = requireLocalWorkspace();
      const paper = state.papers.find((candidate) => candidate.id === paperId);
      if (!paper) {
        throw new Error("找不到要重命名的文献条目。");
      }
      const updatedPaper = buildRenamedPaper(paper, requestedName);
      ensureTargetPathsAvailable([updatedPaper], new Set([paper.id]));
      if (paper.sourcePath && updatedPaper.sourcePath && paper.sourcePath !== updatedPaper.sourcePath) {
        await movePhysicalResourceIfManaged(paper.sourcePath, updatedPaper.sourcePath);
      }
      workspaceStore.updatePapers([updatedPaper]);
      syncWorkspace();
      const message = `已将文献条目重命名为《${updatedPaper.title}》。`;
      onAnalysisHint(message);
      return message;
    } catch (error) {
      const message = `重命名失败：${error instanceof Error ? error.message : String(error)}`;
      onAnalysisHint(message);
      return message;
    }
  }

  async function movePaper(paperId: string, targetFolderPath: string) {
    try {
      const state = requireLocalWorkspace();
      const paper = state.papers.find((candidate) => candidate.id === paperId);
      if (!paper) {
        throw new Error("找不到要移动的文献条目。");
      }
      const updatedPaper = buildMovedPaper(paper, targetFolderPath);
      if (updatedPaper.sourcePath === paper.sourcePath) {
        return "条目已经位于目标目录。";
      }
      ensureTargetPathsAvailable([updatedPaper], new Set([paper.id]));
      await movePhysicalResourceIfManaged(paper.sourcePath!, updatedPaper.sourcePath!);
      workspaceStore.updatePapers([updatedPaper]);
      syncWorkspace();
      const message = `已将《${paper.title}》移动到 ${normalizeWorkspacePath(targetFolderPath)}。`;
      onAnalysisHint(message);
      return message;
    } catch (error) {
      const message = `移动失败：${error instanceof Error ? error.message : String(error)}`;
      onAnalysisHint(message);
      return message;
    }
  }

  async function renameFolder(folderPath: string, requestedName: string) {
    try {
      const state = requireLocalWorkspace();
      if (folderPath === "未归档文献") {
        throw new Error("“未归档文献”是虚拟分组，不能重命名。");
      }
      const targetFolderPath = buildRenamedFolderPath(folderPath, requestedName);
      if (normalizeWorkspacePath(targetFolderPath) === normalizeWorkspacePath(folderPath)) {
        return "目录名称未发生变化。";
      }
      const affectedPapers = state.papers.filter((paper) =>
        paper.sourcePath
          ? normalizeWorkspacePath(paper.sourcePath).startsWith(`${normalizeWorkspacePath(folderPath)}/`)
          : false
      );
      if (affectedPapers.length === 0) {
        throw new Error("目录中没有可更新的文献条目。");
      }
      const updatedPapers = affectedPapers.map((paper) => ({
        ...paper,
        sourcePath: replaceWorkspacePathPrefix(
          paper.sourcePath!,
          folderPath,
          targetFolderPath
        )
      }));
      const changedIds = new Set(affectedPapers.map((paper) => paper.id));
      ensureTargetPathsAvailable(updatedPapers, changedIds);
      await movePhysicalResourceIfManaged(folderPath, targetFolderPath);
      workspaceStore.updatePapers(updatedPapers);
      syncWorkspace();
      const message = `已将目录重命名为 ${targetFolderPath}。`;
      onAnalysisHint(message);
      return message;
    } catch (error) {
      const message = `重命名目录失败：${error instanceof Error ? error.message : String(error)}`;
      onAnalysisHint(message);
      return message;
    }
  }

  async function moveFolder(folderPath: string, targetFolderPath: string) {
    try {
      const state = requireLocalWorkspace();
      if (folderPath === "未归档文献") {
        throw new Error("“未归档文献”是虚拟分组，不能移动。");
      }
      const destinationPath = buildMovedFolderPath(folderPath, targetFolderPath);
      if (normalizeWorkspacePath(destinationPath) === normalizeWorkspacePath(folderPath)) {
        return "目录已经位于目标位置。";
      }
      const affectedPapers = state.papers.filter((paper) =>
        paper.sourcePath
          ? normalizeWorkspacePath(paper.sourcePath).startsWith(`${normalizeWorkspacePath(folderPath)}/`)
          : false
      );
      if (affectedPapers.length === 0) {
        throw new Error("目录中没有可移动的文献条目。");
      }
      const updatedPapers = affectedPapers.map((paper) => ({
        ...paper,
        sourcePath: replaceWorkspacePathPrefix(paper.sourcePath!, folderPath, destinationPath)
      }));
      const changedIds = new Set(affectedPapers.map((paper) => paper.id));
      ensureTargetPathsAvailable(updatedPapers, changedIds);
      await movePhysicalResourceIfManaged(folderPath, destinationPath);
      workspaceStore.updatePapers(updatedPapers);
      syncWorkspace();
      const message = `已将目录移动到 ${destinationPath}。`;
      onAnalysisHint(message);
      return message;
    } catch (error) {
      const message = `移动目录失败：${error instanceof Error ? error.message : String(error)}`;
      onAnalysisHint(message);
      return message;
    }
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

  async function addDroppedPdfFiles(files: File[], targetFolderPath?: string) {
    const pdfFiles = files.filter((file) => file.name.toLowerCase().endsWith(".pdf"));

    if (pdfFiles.length === 0) {
      onAnalysisHint("请拖入 PDF 文件。");
      return;
    }

    const state = workspaceStore.getState();
    if (persistDroppedPdfFiles && state.workspaceSource.type === "local_library") {
      try {
        const previousPapersById = new Map(state.papers.map((paper) => [paper.id, paper]));
        const snapshot = await persistDroppedPdfFiles({ files: pdfFiles, targetFolderPath });
        const persistedPapers = snapshot.entries.map((entry) => ({
          id: entry.id,
          // Bodyless entries carry no path; they stay listed but not openable.
          sourcePath: entry.path ?? undefined,
          title: entry.title
        }));
        workspaceStore.openWorkspace(persistedPapers, {
          rootPath: snapshot.rootPath,
          type: "local_library"
        });
        syncWorkspace();
        const target = targetFolderPath ? normalizeWorkspacePath(targetFolderPath) : `${snapshot.rootPath}/papers`;
        onAnalysisHint(`已保存 ${pdfFiles.length} 个 PDF 到 ${target}。`);
        const papersToExtract = persistedPapers.filter((paper) => {
          const previous = previousPapersById.get(paper.id);
          return Boolean(paper.sourcePath) && (!previous || previous.sourcePath !== paper.sourcePath);
        });
        queueImportForPapers(papersToExtract, () => {
          onAnalysisHint(`已完成 ${papersToExtract.length} 篇 PDF 的全文抽取与搜索索引。`);
        });
        return;
      } catch (error) {
        onAnalysisHint(`保存到本地文献库失败：${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }

    const addedPapers: Paper[] = [];
    pdfFiles.forEach((file) => {
      const title = normalizeDroppedFileTitle(file.name);
      const targetRoot = state.workspaceSource.rootPath || "本地文献库";
      const fallbackPath = `${targetFolderPath ?? `${targetRoot}/papers`}/${file.name}`;
      const sourcePath = createBrowserPdfSource(file, fallbackPath);
      const added = workspaceStore.addPaper({
        id: buildDroppedPaperId(file),
        sourcePath,
        title
      });

      if (added) {
        addedPapers.push({
          id: buildDroppedPaperId(file),
          sourcePath,
          title
        });
      }
    });

    if (addedPapers.length > 0) {
      syncWorkspace();
      onAnalysisHint(`已将 ${addedPapers.length} 个 PDF 加入文献库。`);
      queueImportForPapers(addedPapers, () => {
        onAnalysisHint(`已完成 ${addedPapers.length} 篇 PDF 的全文抽取与搜索索引。`);
      });
      return;
    }

    onAnalysisHint("拖入的 PDF 已经在文献库中。");
  }

  async function addExternalPdfToLibrary(item: ExternalPdfLibraryItem) {
    if (item.bytes.byteLength < 5) {
      throw new Error("下载的 PDF 文件为空。");
    }
    if (workspaceStore.getState().workspaceSource.type !== "local_library") {
      throw new Error("请先切换到你的本地文献库，再保存关联论文。");
    }
    const fileBytes = new Uint8Array(item.bytes.byteLength);
    fileBytes.set(item.bytes);
    const file = new File([fileBytes.buffer], sanitizeExternalPdfFileName(item.fileName || item.title), {
      type: "application/pdf"
    });
    await addDroppedPdfFiles([file]);
  }

  function toggleSelection(paperId: string) {
    workspaceStore.toggleSelection(paperId);
    syncWorkspace();
  }

  function toggleSelectionLock() {
    const state = workspaceStore.getState();
    if (state.selectionLocked) {
      workspaceStore.unlockSelection();
      onAnalysisHint("已解除锁定。请调整选中文献集后，再选择 AI 按钮启动分析。");
    } else {
      workspaceStore.lockSelection();
      onAnalysisHint("选中文献集已锁定。可以先交给 AI 流程，或直接用 AI 按钮开始分析。");
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

  function queueImportForPapers(
    papers: Paper[],
    onComplete?: () => void,
    onFailure?: (input: { error: Error; paper: Paper }) => void
  ): ImportQueueStatus {
    if (papers.length === 0) {
      return "idle";
    }

    let pending = 0;
    let importing = false;
    let alreadyImported = 0;
    let failed = false;

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
        void resolvePaperIndex(paper)
          .then(async ({ chunks, pages }) => {
            if (chunks.length === 0) {
              throw new Error("PDF did not contain extractable text");
            }
            if (pages?.length) {
              await persistExtractedPaperArtifacts(paper, pages);
            }
            const firstPage = Math.min(...chunks.map((chunk) => chunk.page));
            const firstPageText = chunks
              .filter((chunk) => chunk.page === firstPage)
              .map((chunk) => chunk.snippet)
              .join("\n");
            const inferredIdentity = inferPaperIdentityMetadataFromPdfText(firstPageText);
            if ((inferredIdentity.doi && !paper.doi) || (inferredIdentity.arxivId && !paper.arxivId)) {
              workspaceStore.updatePapers([{
                ...paper,
                ...(paper.doi ? {} : inferredIdentity.doi ? { doi: inferredIdentity.doi } : {}),
                ...(paper.arxivId ? {} : inferredIdentity.arxivId ? { arxivId: inferredIdentity.arxivId } : {})
              }]);
              syncWorkspace();
            }
            importStore.markParsed(jobId, {
              paperId: paper.id,
              chunks
            });
          })
          .catch((error) => {
            failed = true;
            importStore.markFailed(jobId);
            const normalizedError = error instanceof Error ? error : new Error(String(error));
            const reason = normalizedError.message;
            onAnalysisHint(`《${paper.title}》解析失败：${reason}`);
            onFailure?.({ error: normalizedError, paper });
          })
          .finally(() => {
            syncImportJobs();
            pending -= 1;
            if (pending === 0 && !failed) {
              onComplete?.();
            }
          });
      }, 0);
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
      onAnalysisHint("选中文献集已完成导入，现在可以通过中栏 AI 按钮启动分析。");
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
    addDroppedPdfFiles,
    addExternalPdfToLibrary,
    addExternalPaperToLibrary,
    getImportedChunksByPaperId,
    getImportedSelectedCount,
    getSelectedPapers,
    importSelectedSet,
    moveFolder,
    movePaper,
    queueImportForPapers,
    syncImportJobs,
    syncWorkspace,
    renameFolder,
    renamePaper,
    toggleSelection,
    toggleSelectionLock
  };
}
