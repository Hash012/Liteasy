import { useRef, useState } from "react";
import type { ForumLiteratureResolveInput } from "../features/forum/forum.types";
import type { ForumClient } from "../features/forum/forumClient";
import type {
  LiteratureCandidate,
  LiteratureRecord,
  LiteratureResolveResult,
  ManualLiteratureInput
} from "../features/paper-identity/literature.types";
import {
  confirmPdfAnnotationPublication,
  type PdfAnnotationPublication,
  type PdfAnnotationV2
} from "../features/pdf/pdfAnnotationStorage";
import {
  createRetractOperation,
  createUpsertOperation
} from "../features/pdf/pdfAnnotationIntuechoSync";
import type { createWorkspaceStore } from "../features/workspace/workspace.store";
import type { Paper } from "../features/workspace/workspace.types";

export type LiteratureDialogModel =
  | {
      candidates: LiteratureCandidate[];
      kind: "candidates";
      message?: string;
      pending: boolean;
      unavailableProviders: LiteratureResolveResult["unavailableProviders"];
    }
  | {
      kind: "manual";
      message?: string;
      pending: boolean;
      unavailableProviders: LiteratureResolveResult["unavailableProviders"];
    }
  | {
      kind: "unavailable";
      message?: string;
      pending: boolean;
      unavailableProviders: LiteratureResolveResult["unavailableProviders"];
    };

export type ChangePdfAnnotationPublicationInput = {
  annotation: PdfAnnotationV2;
  literatureHints?: NonNullable<ForumLiteratureResolveInput["hints"]>;
  operation: "publish" | "update" | "retract";
  paper: Paper;
};

type PublicationForumClient = Pick<
  ForumClient,
  "applyAnnotationPublications" | "confirmLiterature" | "resolveLiterature"
>;

type PdfAnnotationPublicationControllerInput = {
  forumClient: PublicationForumClient;
  literatureMetadataRepository: {
    load(paperId: string): Promise<LiteratureRecord | undefined>;
  };
  persistPaperLiterature(
    paper: Paper,
    literature: LiteratureRecord
  ): Promise<Paper | void>;
  workspaceStore: ReturnType<typeof createWorkspaceStore>;
};

type PaperLiteraturePersistenceInput = {
  cloudLibraryClient: {
    updateLiterature(
      scope: { scopeId: string; scopeType: "organization" | "user" },
      documentId: string,
      expectedRevision: number,
      literature: LiteratureRecord
    ): Promise<{ revision: number }>;
  };
  literatureMetadataRepository: {
    save(paperId: string, literature: LiteratureRecord): Promise<void>;
  };
};

type ActiveResolution = {
  candidates: LiteratureCandidate[];
  pending: boolean;
  request: ForumLiteratureResolveInput;
  resolve: (literature: LiteratureRecord | undefined) => void;
  unavailableProviders: LiteratureResolveResult["unavailableProviders"];
};

const busyPublication: PdfAnnotationPublication = {
  desiredVisibility: "public",
  lastError: "已有文献身份确认正在进行，请完成或取消后重试。",
  state: "failed"
};

export function createPersistPaperLiterature({
  cloudLibraryClient,
  literatureMetadataRepository
}: PaperLiteraturePersistenceInput) {
  return async (paper: Paper, literature: LiteratureRecord): Promise<Paper> => {
    if (!paper.libraryReference) {
      await literatureMetadataRepository.save(paper.id, literature);
      return { ...paper, literature };
    }
    const reference = paper.libraryReference;
    const result = await cloudLibraryClient.updateLiterature(
      { scopeId: reference.scopeId, scopeType: reference.scopeType },
      reference.documentId,
      reference.revision,
      literature
    );
    if (!Number.isSafeInteger(result.revision) || result.revision < 0) {
      throw new Error("云端文献元数据写入响应无效。");
    }
    return {
      ...paper,
      libraryReference: { ...reference, revision: result.revision },
      literature
    };
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim()) return error;
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function failedPublication(
  operation: ChangePdfAnnotationPublicationInput["operation"],
  error: unknown
): PdfAnnotationPublication {
  const message = errorMessage(error, "论坛发布请求失败，请稍后重试。");
  return {
    desiredVisibility: operation === "retract" ? "private" : "public",
    lastError: operation === "retract" && !message.includes("论坛仍公开")
      ? `撤回未完成，论坛仍公开。${message}`
      : message,
    state: "failed"
  };
}

function boundedHints(
  hints: ChangePdfAnnotationPublicationInput["literatureHints"]
): ChangePdfAnnotationPublicationInput["literatureHints"] {
  if (!hints) return undefined;
  const authors = hints.authors
    ?.map((author) => author.replace(/\s+/g, " ").trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, 200);
  const identifiers = hints.identifiers
    ?.map((identifier) => ({
      kind: identifier.kind,
      value: identifier.value.trim().slice(0, 1000)
    }))
    .filter((identifier) => identifier.value)
    .slice(0, 20);
  const title = hints.title?.replace(/\s+/g, " ").trim().slice(0, 1000);
  const year = Number.isInteger(hints.year) && hints.year! >= 1000 && hints.year! <= 9999
    ? hints.year
    : undefined;
  return {
    ...(authors?.length ? { authors } : {}),
    ...(identifiers?.length ? { identifiers } : {}),
    ...(title ? { title } : {}),
    ...(year ? { year } : {})
  };
}

function validManualRecord(record: ManualLiteratureInput) {
  return Boolean(record.title.trim()) && (
    record.identifiers.some((identifier) => identifier.value.trim()) ||
    (record.authors.some((author) => author.trim()) && Number.isInteger(record.year))
  );
}

export function usePdfAnnotationPublicationController({
  forumClient,
  literatureMetadataRepository,
  persistPaperLiterature,
  workspaceStore
}: PdfAnnotationPublicationControllerInput) {
  const [literatureDialog, setLiteratureDialog] = useState<LiteratureDialogModel | null>(null);
  const activeResolutionRef = useRef<ActiveResolution | null>(null);
  const forumClientRef = useRef(forumClient);
  const latestPublicationRef = useRef(new Map<string, PdfAnnotationPublication>());
  const publicationQueuesRef = useRef(new Map<string, Promise<void>>());
  forumClientRef.current = forumClient;

  function isActive(active: ActiveResolution) {
    return activeResolutionRef.current === active;
  }

  function finishResolution(active: ActiveResolution, literature: LiteratureRecord | undefined) {
    if (!isActive(active)) return;
    activeResolutionRef.current = null;
    setLiteratureDialog(null);
    active.resolve(literature);
  }

  function showCandidates(
    active: ActiveResolution,
    candidates: LiteratureCandidate[],
    unavailableProviders: LiteratureResolveResult["unavailableProviders"],
    message?: string
  ) {
    if (!isActive(active)) return;
    active.candidates = candidates;
    active.pending = false;
    active.unavailableProviders = unavailableProviders;
    setLiteratureDialog({
      candidates,
      kind: "candidates",
      ...(message ? { message } : {}),
      pending: false,
      unavailableProviders
    });
  }

  async function confirmCandidate(active: ActiveResolution, candidateKey: string) {
    if (!isActive(active) || active.pending ||
      !active.candidates.some((candidate) => candidate.candidateKey === candidateKey)) return;
    active.pending = true;
    setLiteratureDialog((current) => current ? { ...current, message: undefined, pending: true } : current);
    try {
      const confirmed = await forumClientRef.current.confirmLiterature({ candidateKey, mode: "candidate" });
      finishResolution(active, confirmed.literature);
    } catch (error) {
      showCandidates(
        active,
        active.candidates,
        active.unavailableProviders,
        errorMessage(error, "文献身份确认失败，请重试。")
      );
    }
  }

  async function applyResolveResult(active: ActiveResolution, result: LiteratureResolveResult) {
    if (!isActive(active)) return;
    active.unavailableProviders = result.unavailableProviders;
    if (result.status === "exact") {
      active.candidates = [result.candidate];
      await confirmCandidate(active, result.candidate.candidateKey);
      return;
    }
    active.pending = false;
    if (result.status === "ambiguous") {
      showCandidates(active, result.candidates, result.unavailableProviders);
      return;
    }
    if (result.status === "not_found") {
      setLiteratureDialog({
        kind: "manual",
        pending: false,
        unavailableProviders: result.unavailableProviders
      });
      return;
    }
    setLiteratureDialog({
      kind: "unavailable",
      pending: false,
      unavailableProviders: result.unavailableProviders
    });
  }

  async function attemptResolution(active: ActiveResolution) {
    if (!isActive(active) || active.pending) return;
    active.pending = true;
    setLiteratureDialog((current) => current ? { ...current, message: undefined, pending: true } : current);
    try {
      const result = await forumClientRef.current.resolveLiterature(active.request);
      if (!isActive(active)) return;
      active.pending = false;
      await applyResolveResult(active, result);
    } catch (error) {
      if (!isActive(active)) return;
      active.pending = false;
      setLiteratureDialog({
        kind: "unavailable",
        message: errorMessage(error, "文献检索暂时不可用，请重试。"),
        pending: false,
        unavailableProviders: active.unavailableProviders
      });
    }
  }

  function resolveAndConfirm(
    hints: ChangePdfAnnotationPublicationInput["literatureHints"]
  ): Promise<LiteratureRecord | undefined> | undefined {
    if (activeResolutionRef.current) return undefined;
    const request: ForumLiteratureResolveInput = {
      ...(hints ? { hints: boundedHints(hints) } : {}),
      limit: 5,
      purpose: "liteasy_pdf_annotation"
    };
    return new Promise<LiteratureRecord | undefined>((resolve) => {
      const active: ActiveResolution = {
        candidates: [],
        pending: false,
        request,
        resolve,
        unavailableProviders: []
      };
      activeResolutionRef.current = active;
      void attemptResolution(active);
    });
  }

  async function performPublication(
    input: ChangePdfAnnotationPublicationInput
  ): Promise<PdfAnnotationPublication> {
    const queueKey = `${input.annotation.paperIdentity.paperId}:${input.annotation.id}`;
    try {
      let operation;
      if (input.operation === "retract") {
        const latest = latestPublicationRef.current.get(queueKey);
        const remoteAnnotationId = latest?.remoteAnnotationId ?? input.annotation.publication.remoteAnnotationId;
        if (!remoteAnnotationId) {
          return failedPublication(input.operation, "PDF 批注缺少可撤回的论坛批注 ID。");
        }
        operation = createRetractOperation({
          ...input.annotation,
          publication: {
            ...input.annotation.publication,
            remoteAnnotationId,
            remoteRevision: latest?.remoteRevision ?? input.annotation.publication.remoteRevision
          }
        });
      } else {
        let confirmedLiterature = input.paper.literature;
        if (!confirmedLiterature) {
          confirmedLiterature = await literatureMetadataRepository.load(input.paper.id);
        }
        if (!confirmedLiterature) {
          const pendingResolution = resolveAndConfirm(input.literatureHints);
          if (!pendingResolution) return { ...busyPublication };
          confirmedLiterature = await pendingResolution;
          if (!confirmedLiterature) {
            return { desiredVisibility: "private", state: "not_published" };
          }
        }
        const persistedPaper = await persistPaperLiterature(input.paper, confirmedLiterature);
        workspaceStore.updatePapers([persistedPaper ?? { ...input.paper, literature: confirmedLiterature }]);
        operation = createUpsertOperation(input.annotation, confirmedLiterature);
      }

      const response = await forumClientRef.current.applyAnnotationPublications([operation]);
      const result = response.results[0];
      if (!result || result.state === "failed") {
        return failedPublication(input.operation, result?.error ?? "论坛发布响应缺少该批注的可验证结果。");
      }
      const currentAnnotation = operation.operation === "retract"
        ? {
            ...input.annotation,
            publication: {
              ...input.annotation.publication,
              remoteAnnotationId: operation.remoteAnnotationId
            }
          }
        : input.annotation;
      const publication = confirmPdfAnnotationPublication(currentAnnotation, result).publication;
      latestPublicationRef.current.set(queueKey, publication);
      return publication;
    } catch (error) {
      return failedPublication(input.operation, error);
    }
  }

  function changePublication(input: ChangePdfAnnotationPublicationInput) {
    const queueKey = `${input.annotation.paperIdentity.paperId}:${input.annotation.id}`;
    const previous = publicationQueuesRef.current.get(queueKey) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(() => performPublication(input));
    const tail = result.then(() => undefined, () => undefined);
    publicationQueuesRef.current.set(queueKey, tail);
    void tail.finally(() => {
      if (publicationQueuesRef.current.get(queueKey) === tail) {
        publicationQueuesRef.current.delete(queueKey);
      }
    });
    return result;
  }

  function selectCandidate(candidateKey: string) {
    const active = activeResolutionRef.current;
    if (active) void confirmCandidate(active, candidateKey);
  }

  function submitManual(record: ManualLiteratureInput) {
    const active = activeResolutionRef.current;
    if (!active || active.pending || literatureDialog?.kind !== "manual" || !validManualRecord(record)) return;
    active.pending = true;
    setLiteratureDialog((current) => current ? { ...current, message: undefined, pending: true } : current);
    void forumClientRef.current.confirmLiterature({ mode: "manual", record })
      .then(({ literature }) => finishResolution(active, literature))
      .catch((error) => {
        if (!isActive(active)) return;
        active.pending = false;
        setLiteratureDialog({
          kind: "manual",
          message: errorMessage(error, "手工文献信息确认失败，请重试。"),
          pending: false,
          unavailableProviders: active.unavailableProviders
        });
      });
  }

  function retryResolution() {
    const active = activeResolutionRef.current;
    if (active && literatureDialog?.kind === "unavailable") void attemptResolution(active);
  }

  function cancelResolution() {
    const active = activeResolutionRef.current;
    if (active) finishResolution(active, undefined);
  }

  return {
    actions: {
      cancelResolution,
      changePublication,
      retryResolution,
      selectCandidate,
      submitManual
    },
    model: { literatureDialog }
  };
}
