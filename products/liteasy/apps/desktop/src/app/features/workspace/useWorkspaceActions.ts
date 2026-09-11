import type { ImportJob, MineruFigure } from "../import/import.types";
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
  extractPaperResources?: (paper: Paper) => Promise<{
    chunks: RetrievalChunk[];
    figures: MineruFigure[];
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
  onPaperIdentityReady?: (input: { firstPageText: string; paper: Paper }) => Promise<void> | void;
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
  extractPaperResources,
  importDocument,
  importStore,
  loadPdfSource,
  moveLocalLibraryResource,
  persistDroppedPdfFiles,
  savePaperArtifact = saveUserPaperArtifact,
  onAnalysisHint,
  onImportJobsChanged,
  onPaperIdentityReady,
  onWorkspaceChanged,
  ocrLanguage = "eng",
  workspaceStore
}: UseWorkspaceActionsInput) {
  const resolvePaperIndex = extractPaperIndex ?? (extractPaperChunks
    ? async (paper: Paper) => ({ chunks: await extractPaperChunks(paper), pages: undefined })
    : async (paper: Paper) => extractPdfIndexForPaper(paper, { loadPdfSource, ocrLanguage }));
  const resolvePaperResources = extractPaperResources
    ? async (paper: Paper) => ({
        ...(await extractPaperResources(paper)),
        pages: undefined
      })
    : async (paper: Paper) => ({
        ...(await resolvePaperIndex(paper)),
        figures: [] as MineruFigure[]
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

    const needed = papers.filter((paper) => importStore.getLatestJobByDocumentId(paper.id)?.status !== "parsed");
    if (needed.length === 0) return "already_imported";
    let started = false;
    let scheduling = true;
    let settled = false;
    let unsubscribe = () => {};
    const check = () => {
      if (settled || scheduling) return;
      const states = papers.map((paper) => ({ paper, job: importStore.getLatestJobByDocumentId(paper.id) }));
      const failed = states.find(({ job }) => job?.status === "failed");
      if (failed) {
        settled = true;
        unsubscribe();
        onFailure?.({ error: new Error(failed.job?.error ?? "PDF 解析失败"), paper: failed.paper });
      } else if (states.every(({ job }) => job?.status === "parsed")) {
        settled = true;
        unsubscribe();
        onComplete?.();
      }
    };
    unsubscribe = importStore.subscribe(check);
    needed.forEach((paper) => {
      const existing = importStore.getLatestJobByDocumentId(paper.id);
      if (existing?.status === "queued" || existing?.status === "parsing") return;
      started = true;
      const sourcePath = paper.sourcePath ?? "";
      const jobId = importStore.startImport({ documentId: paper.id, sourcePath });
      syncImportJobs();
      if (!sourcePath) {
        importStore.markFailed(jobId, "文献没有可读取的 PDF 正文。");
        syncImportJobs();
        return;
      }
      void importDocument?.(sourcePath).catch(() => {});
      window.setTimeout(() => {
        importStore.markParsing(jobId);
        syncImportJobs();
        void resolvePaperResources(paper)
          .then(async ({ chunks, figures, pages }) => {
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
            const resolvedPaper = (inferredIdentity.doi && !paper.doi) || (inferredIdentity.arxivId && !paper.arxivId)
              ? {
                ...paper,
                ...(paper.doi ? {} : inferredIdentity.doi ? { doi: inferredIdentity.doi } : {}),
                ...(paper.arxivId ? {} : inferredIdentity.arxivId ? { arxivId: inferredIdentity.arxivId } : {})
              }
              : paper;
            if (resolvedPaper !== paper) {
              workspaceStore.updatePapers([resolvedPaper]);
              syncWorkspace();
            }
            void Promise.resolve(onPaperIdentityReady?.({ firstPageText, paper: resolvedPaper }))
              .catch((error) => {
                const reason = error instanceof Error ? error.message : String(error);
                onAnalysisHint(`《${paper.title}》文献身份确认失败：${reason}`);
              });
            importStore.markParsed(jobId, {
              paperId: paper.id,
              chunks,
              mineruFigures: figures
            });
          })
          .catch((error) => {
            const reason = error instanceof Error ? error.message : String(error);
            importStore.markFailed(jobId, reason);
            onAnalysisHint(`《${paper.title}》解析失败：${reason}`);
          })
          .finally(syncImportJobs);
      }, 0);
    });
    scheduling = false;
    check();
    return started ? "started" : "importing";
  }

  function ensurePapersImported(papers: Paper[]) {
    if (papers.length === 0) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 120_000;
      let settled = false;
      const finishWithError = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const check = () => {
        if (settled) return;
        const jobs = papers.map((paper) => ({
          job: importStore.getLatestJobByDocumentId(paper.id),
          paper
        }));
        const failed = jobs.find(({ job }) => job?.status === "failed");
        if (failed) {
          finishWithError(new Error(
            `《${failed.paper.title}》解析失败：${failed.job?.error ?? "未知错误"}`
          ));
          return;
        }
        if (jobs.every(({ job }) => job?.status === "parsed")) {
          settled = true;
          resolve();
          return;
        }
        if (Date.now() >= deadline) {
          finishWithError(new Error("等待 @ 文献解析超时，请稍后重试。"));
          return;
        }
        window.setTimeout(check, 50);
      };

      queueImportForPapers(papers, check, ({ error }) => finishWithError(error));
      check();
    });
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
    ensurePapersImported,
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
