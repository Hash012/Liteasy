import { useRef } from "react";
import type { createImportStore } from "../features/import/import.store";
import type { LiteratureAuthorityClient } from "../features/paper-identity/literatureAuthorityClient";
import type { LiteratureRecord } from "../features/paper-identity/literature.types";
import { buildMetadataPdfFileName, buildPdfRecognitionRequest, selectPdfRecognitionCandidate, type PdfRecognitionEvidence } from "../features/metadata/pdfRecognition";
import type { Paper } from "../features/workspace/workspace.types";
import type { createWorkspaceStore } from "../features/workspace/workspace.store";
import type { MoveLocalLibraryResource } from "../features/library/libraryFileSystemClient";
import { getWorkspaceParentPath, isWorkspacePathWithinRoot, joinWorkspacePath, normalizeWorkspacePath } from "../features/workspace/workspacePathOperations";

type Input = {
  workspaceStore: ReturnType<typeof createWorkspaceStore>;
  importStore?: ReturnType<typeof createImportStore>;
  literatureClient: Pick<LiteratureAuthorityClient, "resolveLiterature" | "confirmLiterature">;
  readEvidence?: (paper: Paper) => Promise<PdfRecognitionEvidence>;
  persistLiterature: (paper: Paper, literature: LiteratureRecord) => Promise<Paper>;
  moveResource: MoveLocalLibraryResource;
  onChanged: () => void;
  onHint: (message: string) => void;
  stageIdentity: (paper: Paper, request: NonNullable<ReturnType<typeof buildPdfRecognitionRequest>>) => Promise<unknown>;
};

export function createPdfMetadataImportController(input: Input) {
  let queue = Promise.resolve();
  return (imported: { paper: Paper; firstPageText: string; manual?: boolean }) => {
    const task = queue.then(async () => {
      const { paper } = imported;
      const initial = input.workspaceStore.getState();
      if (initial.workspaceSource.type !== "local_library" || paper.libraryReference || (paper.literature && !imported.manual)) return;
      const rootPath = initial.workspaceSource.rootPath;
      const unchanged = () => {
        const state = input.workspaceStore.getState();
        const current = state.papers.find((item) => item.id === paper.id);
        return state.workspaceSource.type === "local_library" && state.workspaceSource.rootPath === rootPath &&
          current && current.literature === paper.literature && current.title === paper.title && current.sourcePath === paper.sourcePath ? current : undefined;
      };
      if (!unchanged()) return;
      let evidence: PdfRecognitionEvidence = { firstPageText: imported.firstPageText };
      if (!evidence.firstPageText && imported.manual) {
        const chunks = input.importStore?.getParsedChunksByDocumentId(paper.id) ?? [];
        evidence.firstPageText = chunks.filter((chunk) => chunk.page === 1).map((chunk) => chunk.snippet).join("\n");
      }
      try {
        const read = await input.readEvidence?.(paper);
        if (read?.firstPageText.trim()) evidence = read;
      } catch { /* Existing extracted/OCR text remains usable if a second read fails. */ }
      const request = buildPdfRecognitionRequest(evidence);
      if (!unchanged()) return;
      if (!request) return "未能从 PDF 中提取可用的元数据线索，请使用“确认文献身份”手动检索。";
      await input.stageIdentity(paper, request);
      let result = await input.literatureClient.resolveLiterature(request);
      let candidate = selectPdfRecognitionCandidate(result, evidence);
      if (!candidate && unchanged() && (result.status === "not_found" || result.status === "exact" || result.status === "ambiguous") &&
        request.hints?.identifiers?.some((id) => id.kind === "doi") &&
        !request.hints.identifiers.some((id) => id.kind === "arxiv_id")) {
        const titleRequest = { ...request, hints: { ...request.hints, identifiers: [] } };
        await input.stageIdentity(paper, titleRequest);
        result = await input.literatureClient.resolveLiterature(titleRequest);
        candidate = selectPdfRecognitionCandidate(result, evidence);
      }
      if (!unchanged()) return;
      if (!candidate) return result.status === "not_found"
        ? `未检索到${request.hints?.title ? `《${request.hints.title}》的` : "对应"}题录，已保留原文件名。可在“确认文献身份”中补充 DOI 或 arXiv 编号。`
        : "检索结果的标题、作者或版本尚不能与 PDF 首页唯一对应，已保留原文件名。可在“确认文献身份”中查看候选。";
      const { literature } = await input.literatureClient.confirmLiterature({
        candidateKey: candidate.candidateKey,
        mode: result.status === "exact" ? result.confirmationMode : "candidate"
      });
      const current = unchanged();
      if (!current) return;
      // Save the bibliographic record before attempting a filesystem operation.
      const persisted = await input.persistLiterature(current, literature);
      const latest = input.workspaceStore.getState().papers.find((item) => item.id === paper.id);
      if (!latest || input.workspaceStore.getState().workspaceSource.rootPath !== rootPath) return;
      let updated: Paper = { ...latest, literature: persisted.literature,
        title: latest.title === current.title ? literature.title : latest.title,
        authors: literature.authors, year: literature.year,
        doi: literature.identifiers.find((id) => id.kind === "doi")?.value,
        arxivId: literature.identifiers.find((id) => id.kind === "arxiv_id")?.value };
      let renameWarning = "";
      const source = latest.sourcePath;
      if (source && source === current.sourcePath && latest.title === current.title &&
        isWorkspacePathWithinRoot(source, rootPath)) {
        const fileName = buildMetadataPdfFileName(literature);
        const occupied = new Set(input.workspaceStore.getState().papers.filter((item) => item.id !== paper.id && item.sourcePath)
          .map((item) => normalizeWorkspacePath(item.sourcePath!).toLowerCase()));
        let target = joinWorkspacePath(getWorkspaceParentPath(source), fileName);
        let suffix = 2;
        while (occupied.has(target.toLowerCase())) {
          target = joinWorkspacePath(getWorkspaceParentPath(source), `${fileName.slice(0, -4)} (${suffix++}).pdf`);
        }
        if (target !== normalizeWorkspacePath(source)) {
          try {
            await input.moveResource({ sourcePath: source, targetPath: target });
            updated = { ...updated, sourcePath: target };
          } catch (error) {
            renameWarning = `《${literature.title}》元数据已保存，PDF 保留原文件名：${error instanceof Error ? error.message : String(error)}`;
            input.onHint(renameWarning);
          }
        }
      }
      const state = input.workspaceStore.getState();
      const afterMove = state.papers.find((item) => item.id === paper.id);
      if (state.workspaceSource.rootPath !== rootPath || !afterMove) return;
      const concurrentLiterature = afterMove.literature !== paper.literature ? afterMove.literature : undefined;
      updated = { ...afterMove, literature: concurrentLiterature ?? updated.literature,
        authors: concurrentLiterature?.authors ?? updated.authors,
        year: concurrentLiterature?.year ?? updated.year,
        doi: updated.doi, arxivId: updated.arxivId,
        title: afterMove.title === latest.title ? updated.title : afterMove.title,
        sourcePath: afterMove.sourcePath === latest.sourcePath ? updated.sourcePath : afterMove.sourcePath };
      input.workspaceStore.updatePapers([updated]);
      const job = input.importStore?.getLatestJobByDocumentId(paper.id);
      if (job?.status === "parsed") input.importStore?.markParsed(job.id, {
        paperId: paper.id,
        chunks: job.parsedChunks?.map((chunk) => ({ ...chunk, paperTitle: updated.title })),
        mineruFigures: job.mineruFigures
      });
      input.onChanged();
      return renameWarning || `已获取《${updated.title}》的元数据。`;
    }).catch((error) => {
      const message = `《${imported.paper.title}》元数据识别未完成，已保留 PDF：${error instanceof Error ? error.message : String(error)}`;
      input.onHint(message);
      return message;
    });
    queue = task.then(() => undefined);
    return task;
  };
}

export function usePdfMetadataImportController(input: Input) {
  const latest = useRef(input);
  latest.current = input;
  const controller = useRef<ReturnType<typeof createPdfMetadataImportController>>();
  if (!controller.current) controller.current = createPdfMetadataImportController({
    workspaceStore: input.workspaceStore,
    importStore: input.importStore,
    literatureClient: {
      resolveLiterature: (request) => latest.current.literatureClient.resolveLiterature(request),
      confirmLiterature: (request) => latest.current.literatureClient.confirmLiterature(request)
    },
    readEvidence: (paper) => latest.current.readEvidence?.(paper) ?? Promise.resolve({ firstPageText: "" }),
    persistLiterature: (...args) => latest.current.persistLiterature(...args),
    moveResource: (request) => latest.current.moveResource(request),
    onChanged: () => latest.current.onChanged(),
    onHint: (message) => latest.current.onHint(message),
    stageIdentity: (...args) => latest.current.stageIdentity(...args)
  });
  return controller.current;
}
