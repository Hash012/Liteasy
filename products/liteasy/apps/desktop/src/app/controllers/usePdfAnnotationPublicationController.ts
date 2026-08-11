import { useRef, useState } from "react";
import type {
  ForumAnnotationPublicationOperation,
  ForumLiteratureResolveInput
} from "../features/forum/forum.types";
import type { ForumClient } from "../features/forum/forumClient";
import type {
  LiteratureDialogModel,
  LiteratureSearchDraft
} from "../features/forum/literatureResolution.types";
import type {
  LiteratureCandidate,
  LiteratureRecord,
  LiteratureResolveResult
} from "../features/paper-identity/literature.types";
import {
  literatureResolutionRepository as defaultLiteratureResolutionRepository,
  resolutionStateFromResult,
  type LiteratureResolutionState
} from "../features/paper-identity/literatureResolutionRepository";
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

export type ChangePdfAnnotationPublicationInput = {
  annotation: PdfAnnotationV2;
  literatureHints?: NonNullable<ForumLiteratureResolveInput["hints"]>;
  operation: "publish" | "update" | "retract";
  paper: Paper;
  restartReplay?: true;
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
  literatureResolutionRepository?: {
    load(paperId: string): Promise<LiteratureResolutionState | undefined>;
    save(paperId: string, resolution: LiteratureResolutionState): Promise<void>;
  };
  onPaperUpdated(paper: Paper): void;
  persistPaperLiterature(
    paper: Paper,
    literature: LiteratureRecord
  ): Promise<Paper | void>;
  workspaceStore: ReturnType<typeof createWorkspaceStore>;
};

type PaperLiteraturePersistenceInput = {
  canManageLibraryReference(reference: NonNullable<Paper["libraryReference"]>): boolean;
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
  paperId: string;
  pending: boolean;
  request: ForumLiteratureResolveInput;
  resolve: (literature: LiteratureRecord | undefined) => void;
  unavailableProviders: LiteratureResolveResult["unavailableProviders"];
};

type PendingCreateRecovery = {
  annotation: PdfAnnotationV2;
  operation: Extract<ForumAnnotationPublicationOperation, { operation: "upsert" }>;
};

const busyPublication: PdfAnnotationPublication = {
  desiredVisibility: "public",
  lastError: "已有文献身份确认正在进行，请完成或取消后重试。",
  state: "failed"
};

export function createPersistPaperLiterature({
  canManageLibraryReference,
  cloudLibraryClient,
  literatureMetadataRepository
}: PaperLiteraturePersistenceInput) {
  return async (paper: Paper, literature: LiteratureRecord): Promise<Paper> => {
    const reference = paper.libraryReference;
    const persistInCloud = reference && (
      reference.scopeType === "user" || canManageLibraryReference(reference)
    );
    if (!reference || !persistInCloud) {
      await literatureMetadataRepository.save(paper.id, literature);
      return { ...paper, literature };
    }
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
  error: unknown,
  priorPublication?: PdfAnnotationPublication,
  pendingCreateOperation?: PendingCreateRecovery["operation"]
): PdfAnnotationPublication {
  const message = errorMessage(error, "论坛发布请求失败，请稍后重试。");
  return {
    desiredVisibility: operation === "retract" ? "private" : "public",
    lastError: operation === "retract" && !message.includes("论坛仍公开")
      ? `撤回未完成，论坛仍公开。${message}`
      : message,
    ...(priorPublication?.remoteAnnotationId
      ? { remoteAnnotationId: priorPublication.remoteAnnotationId }
      : {}),
    ...(priorPublication?.remoteRevision !== undefined
      ? { remoteRevision: priorPublication.remoteRevision }
      : {}),
    ...(pendingCreateOperation ? { pendingCreateOperation } : {}),
    state: "failed"
  };
}

function unknownCreateOutcome(
  error: unknown,
  pendingCreateOperation: PendingCreateRecovery["operation"]
): PdfAnnotationPublication {
  return {
    desiredVisibility: "private",
    lastError: `撤回未完成，论坛发布状态未知。${errorMessage(error, "请稍后重试恢复请求。")}`,
    pendingCreateOperation,
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
  const pmlr = hints.pmlr && Number.isInteger(hints.pmlr.volume) && Number.isInteger(hints.pmlr.year)
    ? { source: "pmlr" as const, volume: hints.pmlr.volume, year: hints.pmlr.year }
    : undefined;
  return {
    ...(authors?.length ? { authors } : {}),
    ...(identifiers?.length ? { identifiers } : {}),
    ...(pmlr ? { pmlr } : {}),
    ...(title ? { title } : {}),
    ...(year ? { year } : {})
  };
}

function searchDraftFromRequest(request: ForumLiteratureResolveInput): LiteratureSearchDraft | undefined {
  const hints = request.hints;
  if (!hints?.title || !hints.authors?.length || !hints.year) return undefined;
  return {
    authors: [...hints.authors],
    title: hints.title,
    year: hints.year
  };
}

export function usePdfAnnotationPublicationController({
  forumClient,
  literatureMetadataRepository,
  literatureResolutionRepository = defaultLiteratureResolutionRepository,
  onPaperUpdated,
  persistPaperLiterature,
  workspaceStore
}: PdfAnnotationPublicationControllerInput) {
  const [literatureDialog, setLiteratureDialog] = useState<LiteratureDialogModel | null>(null);
  const activeResolutionRef = useRef<ActiveResolution | null>(null);
  const forumClientRef = useRef(forumClient);
  const latestPublicationRef = useRef(new Map<string, PdfAnnotationPublication>());
  const latestPapersRef = useRef(new Map<string, Paper>());
  const pendingCreateRecoveryRef = useRef(new Map<string, PendingCreateRecovery>());
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

  async function saveResolution(paperId: string, resolution: LiteratureResolutionState) {
    await literatureResolutionRepository.save(paperId, resolution);
  }

  async function saveConfirmedResolution(
    active: Pick<ActiveResolution, "paperId" | "request">,
    literature: LiteratureRecord
  ) {
    await saveResolution(active.paperId, {
      literatureId: literature.literatureId,
      request: active.request,
      revision: literature.revision,
      status: "confirmed",
      updatedAt: new Date().toISOString()
    });
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
      ...(searchDraftFromRequest(active.request) ? { searchDraft: searchDraftFromRequest(active.request) } : {}),
      unavailableProviders
    });
  }

  async function confirmCandidate(
    active: ActiveResolution,
    candidateKey: string,
    mode: "candidate" | "corroborated" = "candidate"
  ) {
    if (!isActive(active) || active.pending ||
      !active.candidates.some((candidate) => candidate.candidateKey === candidateKey)) return;
    active.pending = true;
    const candidate = active.candidates.find((item) => item.candidateKey === candidateKey)!;
    setLiteratureDialog({
      candidate,
      kind: "confirming",
      pending: true,
      unavailableProviders: active.unavailableProviders
    });
    try {
      const confirmed = await forumClientRef.current.confirmLiterature({ candidateKey, mode });
      await saveConfirmedResolution(active, confirmed.literature);
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
    await saveResolution(active.paperId, resolutionStateFromResult(active.request, result));
    if (!isActive(active)) return;
    if (result.status === "exact") {
      active.candidates = [result.candidate];
      await confirmCandidate(active, result.candidate.candidateKey, result.confirmationMode);
      return;
    }
    active.pending = false;
    if (result.status === "ambiguous") {
      showCandidates(active, result.candidates, result.unavailableProviders);
      return;
    }
    if (result.status === "conflict") {
      setLiteratureDialog({
        kind: "conflict",
        message: "来源返回的稳定标识与题录互相冲突，当前文件不能公开。",
        pending: false,
        ...(searchDraftFromRequest(active.request) ? { searchDraft: searchDraftFromRequest(active.request) } : {}),
        unavailableProviders: result.unavailableProviders
      });
      return;
    }
    if (result.status === "not_found") {
      setLiteratureDialog({
        kind: "unresolved",
        message: "尚未找到可由公开来源确认的文献版本。",
        pending: false,
        ...(searchDraftFromRequest(active.request) ? { searchDraft: searchDraftFromRequest(active.request) } : {}),
        unavailableProviders: result.unavailableProviders
      });
      return;
    }
    setLiteratureDialog({
      kind: "unavailable",
      pending: false,
      ...(searchDraftFromRequest(active.request) ? { searchDraft: searchDraftFromRequest(active.request) } : {}),
      unavailableProviders: result.unavailableProviders
    });
  }

  async function attemptResolution(active: ActiveResolution) {
    if (!isActive(active) || active.pending) return;
    active.pending = true;
    setLiteratureDialog((current) => current ? { ...current, message: undefined, pending: true } : current);
    try {
      await saveResolution(active.paperId, {
        request: active.request,
        status: "resolving",
        updatedAt: new Date().toISOString()
      });
      const result = await forumClientRef.current.resolveLiterature(active.request);
      if (!isActive(active)) return;
      active.pending = false;
      await applyResolveResult(active, result);
    } catch (error) {
      if (!isActive(active)) return;
      active.pending = false;
      await saveResolution(active.paperId, {
        request: active.request,
        status: "unavailable",
        unavailableProviders: active.unavailableProviders,
        updatedAt: new Date().toISOString()
      }).catch(() => undefined);
      setLiteratureDialog({
        kind: "unavailable",
        message: errorMessage(error, "文献检索暂时不可用，请重试。"),
        pending: false,
        ...(searchDraftFromRequest(active.request) ? { searchDraft: searchDraftFromRequest(active.request) } : {}),
        unavailableProviders: active.unavailableProviders
      });
    }
  }

  function resolveAndConfirm(
    hints: ChangePdfAnnotationPublicationInput["literatureHints"],
    paperId: string
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
        paperId,
        pending: false,
        request,
        resolve,
        unavailableProviders: []
      };
      activeResolutionRef.current = active;
      setLiteratureDialog({
        kind: "resolving",
        pending: true,
        unavailableProviders: []
      });
      void literatureResolutionRepository.load(paperId).then((stored) => {
        if (!isActive(active)) return;
        if (stored?.status === "candidate") {
          active.request = stored.request;
          showCandidates(active, stored.candidates, stored.unavailableProviders);
          return;
        }
        void attemptResolution(active);
      }).catch(() => {
        if (isActive(active)) void attemptResolution(active);
      });
    });
  }

  async function resolvePaperIdentity(
    paper: Paper,
    hints: ChangePdfAnnotationPublicationInput["literatureHints"]
  ): Promise<LiteratureResolutionState | undefined> {
    if (paper.literature || await literatureMetadataRepository.load(paper.id)) return undefined;
    const request: ForumLiteratureResolveInput = {
      ...(hints ? { hints: boundedHints(hints) } : {}),
      limit: 5,
      purpose: "liteasy_pdf_annotation"
    };
    await saveResolution(paper.id, {
      request,
      status: "resolving",
      updatedAt: new Date().toISOString()
    });
    let result: LiteratureResolveResult;
    try {
      result = await forumClientRef.current.resolveLiterature(request);
    } catch {
      const unavailable: LiteratureResolutionState = {
        request,
        status: "unavailable",
        unavailableProviders: [],
        updatedAt: new Date().toISOString()
      };
      await saveResolution(paper.id, unavailable);
      return unavailable;
    }
    const state = resolutionStateFromResult(request, result);
    await saveResolution(paper.id, state);
    if (result.status !== "exact") return state;
    const confirmed = await forumClientRef.current.confirmLiterature({
      candidateKey: result.candidate.candidateKey,
      mode: result.confirmationMode
    });
    await saveResolution(paper.id, {
      literatureId: confirmed.literature.literatureId,
      request,
      revision: confirmed.literature.revision,
      status: "confirmed",
      updatedAt: new Date().toISOString()
    });
    const persistedPaper = await persistPaperLiterature(paper, confirmed.literature) ?? {
      ...paper,
      literature: confirmed.literature
    };
    latestPapersRef.current.set(persistedPaper.id, persistedPaper);
    workspaceStore.updatePapers([persistedPaper]);
    onPaperUpdated(persistedPaper);
    return {
      literatureId: confirmed.literature.literatureId,
      request,
      revision: confirmed.literature.revision,
      status: "confirmed",
      updatedAt: new Date().toISOString()
    };
  }

  async function performPublication(
    input: ChangePdfAnnotationPublicationInput
  ): Promise<PdfAnnotationPublication> {
    const queueKey = `${input.annotation.paperIdentity.paperId}:${input.annotation.id}`;
    let priorPublication = latestPublicationRef.current.get(queueKey) ?? input.annotation.publication;
    let operation: ForumAnnotationPublicationOperation | undefined;
    try {
      if (input.operation === "retract") {
        const latest = latestPublicationRef.current.get(queueKey);
        let remoteAnnotationId = latest?.remoteAnnotationId ?? input.annotation.publication.remoteAnnotationId;
        if (!remoteAnnotationId) {
          const durableOperation = input.annotation.publication.pendingCreateOperation;
          const recovery = pendingCreateRecoveryRef.current.get(queueKey) ?? (durableOperation ? {
            annotation: {
              ...input.annotation,
              publication: { desiredVisibility: "public", state: "pending_create" as const },
              revision: durableOperation.revision
            },
            operation: durableOperation
          } : undefined);
          if (!recovery) {
            return input.annotation.publication.desiredVisibility === "private" &&
              input.annotation.publication.state === "failed"
              ? { ...input.annotation.publication }
              : { desiredVisibility: "private", state: "not_published" };
          }
          const replayResponse = await forumClientRef.current.applyAnnotationPublications([recovery.operation]);
          const replayResult = replayResponse.results[0];
          if (!replayResult || replayResult.state === "failed") {
            return unknownCreateOutcome(
              replayResult?.error ?? "论坛发布响应缺少该批注的可验证结果。",
              recovery.operation
            );
          }
          try {
            priorPublication = confirmPdfAnnotationPublication(
              recovery.annotation,
              replayResult
            ).publication;
          } catch (error) {
            return unknownCreateOutcome(error, recovery.operation);
          }
          latestPublicationRef.current.set(queueKey, priorPublication);
          pendingCreateRecoveryRef.current.delete(queueKey);
          remoteAnnotationId = priorPublication.remoteAnnotationId;
          if (!remoteAnnotationId) {
            return unknownCreateOutcome("恢复回执缺少远端批注 ID。", recovery.operation);
          }
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
        const durableOperation = input.restartReplay
          ? input.annotation.publication.pendingCreateOperation
          : undefined;
        if (durableOperation) {
          operation = durableOperation;
        } else {
          const currentPaper = latestPapersRef.current.get(input.paper.id) ?? input.paper;
          let confirmedLiterature = input.restartReplay
            ? await literatureMetadataRepository.load(currentPaper.id)
            : currentPaper.literature;
          if (!confirmedLiterature) {
            confirmedLiterature = await literatureMetadataRepository.load(currentPaper.id);
          }
          if (!confirmedLiterature) {
            const pendingResolution = resolveAndConfirm(input.literatureHints, currentPaper.id);
            if (!pendingResolution) return { ...busyPublication };
            confirmedLiterature = await pendingResolution;
            if (!confirmedLiterature) {
              return { desiredVisibility: "private", state: "not_published" };
            }
          }
          const persistedPaper = await persistPaperLiterature(currentPaper, confirmedLiterature) ?? {
            ...currentPaper,
            literature: confirmedLiterature
          };
          latestPapersRef.current.set(persistedPaper.id, persistedPaper);
          workspaceStore.updatePapers([persistedPaper]);
          onPaperUpdated(persistedPaper);
          operation = createUpsertOperation(input.annotation, confirmedLiterature);
        }
      }

      const response = await forumClientRef.current.applyAnnotationPublications([operation]);
      const result = response.results[0];
      if (!result || result.state === "failed") {
        if (input.operation === "publish" && operation.operation === "upsert" &&
          !priorPublication.remoteAnnotationId) {
          pendingCreateRecoveryRef.current.set(queueKey, {
            annotation: input.annotation,
            operation
          });
        }
        return failedPublication(
          input.operation,
          result?.error ?? "论坛发布响应缺少该批注的可验证结果。",
          priorPublication,
          input.operation === "publish" && operation.operation === "upsert" &&
            !priorPublication.remoteAnnotationId ? operation : undefined
        );
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
      pendingCreateRecoveryRef.current.delete(queueKey);
      return publication;
    } catch (error) {
      if (input.operation === "publish" && operation?.operation === "upsert" &&
        !priorPublication.remoteAnnotationId) {
        pendingCreateRecoveryRef.current.set(queueKey, {
          annotation: input.annotation,
          operation
        });
      }
      return failedPublication(
        input.operation,
        error,
        priorPublication,
        input.operation === "publish" && operation?.operation === "upsert" &&
          !priorPublication.remoteAnnotationId ? operation : undefined
      );
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

  function retryResolution() {
    const active = activeResolutionRef.current;
    if (active && new Set(["conflict", "unavailable", "unresolved"]).has(literatureDialog?.kind ?? "")) void attemptResolution(active);
  }

  function searchLiterature(draft: LiteratureSearchDraft) {
    const active = activeResolutionRef.current;
    if (!active || active.pending) return;
    const hints = boundedHints(draft);
    if (!hints?.title || !hints.authors?.length || !hints.year) {
      setLiteratureDialog((current) => current ? {
        ...current,
        message: "请填写题名、完整作者和出版年份后检索。"
      } : current);
      return;
    }
    active.candidates = [];
    active.request = {
      hints: {
        authors: hints.authors,
        title: hints.title,
        year: hints.year
      },
      limit: 5,
      purpose: "liteasy_pdf_annotation",
      query: hints.title
    };
    active.unavailableProviders = [];
    setLiteratureDialog({
      kind: "resolving",
      pending: false,
      searchDraft: draft,
      unavailableProviders: []
    });
    void attemptResolution(active);
  }

  function cancelResolution() {
    const active = activeResolutionRef.current;
    if (active) finishResolution(active, undefined);
  }

  return {
    actions: {
      cancelResolution,
      changePublication,
      resolvePaperIdentity,
      retryResolution,
      searchLiterature,
      selectCandidate
    },
    model: { literatureDialog }
  };
}
