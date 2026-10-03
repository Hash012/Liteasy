import { normalizeLiteratureIdentifier } from "../features/paper-identity/paperIdentity";
import { useRef, useState } from "react";
import type {
  ForumAnnotationPublicationOperation
} from "../features/forum/forum.types";
import type { ForumClient } from "../features/forum/forumClient";
import type {
  LiteratureDialogModel,
  LiteratureSearchDraft
} from "../features/forum/literatureResolution.types";
import type {
  LiteratureCandidate,
  LiteratureResolveInput,
  LiteratureRecord,
  LiteratureResolveResult
} from "../features/paper-identity/literature.types";
import type { LiteratureAuthorityClient } from "../features/paper-identity/literatureAuthorityClient";
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
import { normalizePublicationActorBinding, samePublicationActor, type PublicationActorBinding } from "../features/forum/publicationActorBinding";

export type ChangePdfAnnotationPublicationInput = {
  annotation: PdfAnnotationV2;
  literatureHints?: NonNullable<LiteratureResolveInput["hints"]>;
  operation: "publish" | "update" | "retract";
  paper: Paper;
  newPublication?: true;
  resumePublication?: true;
  onPreparedPublication?: (publication: PdfAnnotationPublication) => Promise<void>;
  restartReplay?: true;
};

type PublicationForumClient = Pick<
  ForumClient,
  "applyAnnotationPublications"
>;

type PdfAnnotationPublicationControllerInput = {
  getActorBinding?: () => PublicationActorBinding | undefined;
  forumClient: PublicationForumClient;
  literatureClient: Pick<
    LiteratureAuthorityClient,
    "confirmLiterature" | "resolveLiterature" | "verifyLiterature"
  >;
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
  paper: Paper;
  pending: boolean;
  request: LiteratureResolveInput;
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

function paperWithLiterature(paper: Paper, literature: LiteratureRecord): Paper {
  return { ...paper, literature, title: literature.title, authors: literature.authors, year: literature.year,
    doi: literature.identifiers.find((id) => id.kind === "doi")?.value,
    arxivId: literature.identifiers.find((id) => id.kind === "arxiv_id")?.value };
}

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
      return paperWithLiterature(paper, literature);
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
      ...paperWithLiterature(paper, literature),
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
    ...(priorPublication?.actorBinding ? { actorBinding: priorPublication.actorBinding } : {}),
    ...(priorPublication?.pendingOperation ? { pendingOperation: priorPublication.pendingOperation, outcome: "unknown" as const } : {}),
    desiredVisibility: operation === "retract" ? "private" : "public",
    lastError: priorPublication?.pendingOperation
      ? `${operation === "retract" ? "撤回" : "发布"}结果待核实。${message}`
      : operation === "retract" && !message.includes("论坛仍公开")
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
  pendingCreateOperation: PendingCreateRecovery["operation"],
  priorPublication: PdfAnnotationPublication
): PdfAnnotationPublication {
  return {
    actorBinding: priorPublication.actorBinding,
    desiredVisibility: "private",
    lastError: `撤回未完成，论坛发布状态未知。${errorMessage(error, "请稍后重试恢复请求。")}`,
    pendingCreateOperation,
    pendingOperation: pendingCreateOperation,
    outcome: "unknown",
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

function searchDraftFromRequest(request: LiteratureResolveInput): LiteratureSearchDraft | undefined {
  const hints = request.hints;
  if (!hints?.title && !request.query && !hints?.identifiers?.length) return undefined;
  return {
    authors: [...(hints?.authors ?? [])],
    title: hints?.title ?? request.query ?? "",
    year: hints?.year,
    identifier: hints?.identifiers?.find((id) => id.kind === "doi" || id.kind === "arxiv_id")?.value
  };
}

export function usePdfAnnotationPublicationController({
  getActorBinding,
  forumClient,
  literatureClient,
  literatureMetadataRepository,
  literatureResolutionRepository = defaultLiteratureResolutionRepository,
  onPaperUpdated,
  persistPaperLiterature,
  workspaceStore
}: PdfAnnotationPublicationControllerInput) {
  const [literatureDialog, setLiteratureDialog] = useState<LiteratureDialogModel | null>(null);
  const [resolutionsByPaperId, setResolutionsByPaperId] = useState<Record<string, LiteratureResolutionState>>({});
  const activeResolutionRef = useRef<ActiveResolution | null>(null);
  const forumClientRef = useRef(forumClient);
  const actorBindingGetterRef = useRef(getActorBinding);
  actorBindingGetterRef.current = getActorBinding;
  const boundPapersRef = useRef(new Map<string, Paper>());
  const literatureClientRef = useRef(literatureClient);
  const latestPublicationRef = useRef(new Map<string, PdfAnnotationPublication>());
  const latestPapersRef = useRef(new Map<string, Paper>());
  const pendingCreateRecoveryRef = useRef(new Map<string, PendingCreateRecovery>());
  const publicationQueuesRef = useRef(new Map<string, Promise<void>>());
  forumClientRef.current = forumClient;
  literatureClientRef.current = literatureClient;

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
    setResolutionsByPaperId((current) => ({ ...current, [paperId]: resolution }));
  }

  async function persistConfirmedLiterature(active: ActiveResolution, literature: LiteratureRecord) {
    const currentPaper = latestPapersRef.current.get(active.paperId) ?? active.paper;
    const persistedPaper = await persistPaperLiterature(currentPaper, literature) ?? {
      ...currentPaper,
      literature
    };
    latestPapersRef.current.set(persistedPaper.id, persistedPaper);
    workspaceStore.updatePapers([persistedPaper]);
    onPaperUpdated(persistedPaper);
    setResolutionsByPaperId((current) => {
      const next = { ...current };
      delete next[active.paperId];
      return next;
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
      const confirmed = await literatureClientRef.current.confirmLiterature({ candidateKey, mode });
      if (!isActive(active)) return;
      await persistConfirmedLiterature(active, confirmed.literature);
      if (!isActive(active)) return;
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
      const result = await literatureClientRef.current.resolveLiterature(active.request);
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

  function dialogForStoredState(active: ActiveResolution, stored: LiteratureResolutionState) {
    active.request = stored.request;
    if (stored.status === "candidate" || stored.status === "ambiguous") {
      showCandidates(active, stored.candidates, stored.unavailableProviders);
      return;
    }
    active.pending = false;
    active.unavailableProviders = "unavailableProviders" in stored ? stored.unavailableProviders : [];
    if (stored.status === "conflict") {
      setLiteratureDialog({
        kind: "conflict",
        message: "来源返回的稳定标识与题录互相冲突，需修正线索后重试。",
        pending: false,
        ...(searchDraftFromRequest(stored.request) ? { searchDraft: searchDraftFromRequest(stored.request) } : {}),
        unavailableProviders: stored.unavailableProviders
      });
      return;
    }
    if (stored.status === "unavailable" || stored.status === "resolving") {
      setLiteratureDialog({
        kind: "unavailable",
        message: stored.status === "resolving" ? "上次识别未完成，请重新检索。" : undefined,
        pending: false,
        ...(searchDraftFromRequest(stored.request) ? { searchDraft: searchDraftFromRequest(stored.request) } : {}),
        unavailableProviders: stored.status === "unavailable" ? stored.unavailableProviders : []
      });
      return;
    }
    setLiteratureDialog({
      kind: "unresolved",
      message: stored.status === "confirmed"
        ? "已确认记录的本地快照需要重新恢复。"
        : "文献身份尚未由公开来源确认。",
      pending: false,
      ...(searchDraftFromRequest(stored.request) ? { searchDraft: searchDraftFromRequest(stored.request) } : {}),
      unavailableProviders: []
    });
  }

  function resolveAndConfirm(
    hints: ChangePdfAnnotationPublicationInput["literatureHints"],
    paper: Paper,
    { startUnresolved = true }: { startUnresolved?: boolean } = {}
  ): Promise<LiteratureRecord | undefined> | undefined {
    if (activeResolutionRef.current) return undefined;
    const request: LiteratureResolveInput = {
      ...(hints ? { hints: boundedHints(hints) } : {}),
      limit: 5,
      purpose: "liteasy_pdf_annotation"
    };
    return new Promise<LiteratureRecord | undefined>((resolve) => {
      const active: ActiveResolution = {
        candidates: [],
        paper,
        paperId: paper.id,
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
      void literatureResolutionRepository.load(paper.id).then(async (stored) => {
        if (!isActive(active)) return;
        if (stored?.status === "confirmed") {
          try {
            const literature = await literatureClientRef.current.verifyLiterature({
              literatureId: stored.literatureId,
              revision: stored.revision
            });
            if (!isActive(active)) return;
            await persistConfirmedLiterature(active, literature);
            finishResolution(active, literature);
          } catch {
            if (isActive(active)) dialogForStoredState(active, stored);
          }
          return;
        }
        if (stored && (stored.status !== "unresolved" || !startUnresolved)) {
          dialogForStoredState(active, stored);
          return;
        }
        if (stored) active.request = stored.request;
        void attemptResolution(active);
      }).catch(() => {
        if (isActive(active)) void attemptResolution(active);
      });
    });
  }

  async function stagePaperIdentity(
    paper: Paper,
    hints: ChangePdfAnnotationPublicationInput["literatureHints"],
    query?: string,
    result?: LiteratureResolveResult
  ): Promise<LiteratureResolutionState | undefined> {
    if (paper.literature || await literatureMetadataRepository.load(paper.id)) return undefined;
    const request: LiteratureResolveInput = {
      ...(hints ? { hints: boundedHints(hints) } : {}),
      ...(query?.trim() ? { query: query.trim().slice(0, 1000) } : {}),
      limit: 5,
      purpose: "liteasy_pdf_annotation"
    };
    const state: LiteratureResolutionState = result ? resolutionStateFromResult(request, result) : {
      request,
      status: "unresolved",
      unavailableProviders: [],
      updatedAt: new Date().toISOString()
    };
    await saveResolution(paper.id, state);
    return state;
  }

  function resolvePaperIdentity(paper: Paper, hints?: ChangePdfAnnotationPublicationInput["literatureHints"]) {
    return resolveAndConfirm(hints, paper, { startUnresolved: true });
  }

  async function hydrateResolutionStates(papers: readonly Paper[]) {
    const entries = await Promise.all(papers.filter((paper) => !paper.literature).map(async (paper) => {
      try {
        const resolution = await literatureResolutionRepository.load(paper.id);
        return resolution ? [paper.id, resolution] as const : undefined;
      } catch {
        return undefined;
      }
    }));
    setResolutionsByPaperId(Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))));
  }

  async function performPublication(
    input: ChangePdfAnnotationPublicationInput,
    requestActor: PublicationActorBinding | undefined,
    requestClient: PublicationForumClient
  ): Promise<PdfAnnotationPublication> {
    const queueKey = `${JSON.stringify(requestActor)}:${input.annotation.paperIdentity.paperId}:${input.annotation.id}`;
    let priorPublication = latestPublicationRef.current.get(queueKey) ?? input.annotation.publication;
    let operation: ForumAnnotationPublicationOperation | undefined;
    function assertPublicSource() {
      if (input.paper.libraryReference?.scopeType === "organization") {
        throw new Error("组织来源尚未允许公开发布；已有论坛批注仍可撤回。");
      }
    }
    function assertCurrentActor() {
      if (!requestActor || !samePublicationActor(requestActor, actorBindingGetterRef.current?.())) {
        throw new Error("账号或会话已变化，发布结果需由原账号核实。");
      }
    }
    async function sendOperation(value: ForumAnnotationPublicationOperation) {
      assertCurrentActor();
      if (value.operation === "upsert") assertPublicSource();
      if (!input.onPreparedPublication) throw new Error("发布任务尚未安全保存，未发送到论坛。");
      const { pendingCreateOperation: _legacyPending, ...prior } = priorPublication;
      priorPublication = {
        ...prior,
        actorBinding: requestActor,
        desiredVisibility: input.operation === "retract" ? "private" : "public",
        outcome: "unknown",
        pendingOperation: value,
        ...(input.operation === "retract" && value.operation === "upsert" && !prior.remoteAnnotationId
          ? { pendingCreateOperation: value } : {}),
        state: input.operation === "retract" ? "pending_retract" : prior.remoteAnnotationId ? "pending_update" : "pending_create"
      };
      await input.onPreparedPublication(priorPublication);
      assertCurrentActor();
      latestPublicationRef.current.set(queueKey, priorPublication);
      const response = await requestClient.applyAnnotationPublications([value], requestActor);
      assertCurrentActor();
      return response;
    }
    try {
      const recordedActor = priorPublication.actorBinding;
      if (!recordedActor) {
        if (!input.newPublication || input.restartReplay || priorPublication.pendingOperation ||
          priorPublication.pendingCreateOperation || priorPublication.remoteAnnotationId) {
          throw new Error("旧发布任务缺少原账号归属，已保留本地内容，请核实原发布账号。");
        }
      } else if (!samePublicationActor(recordedActor, requestActor) &&
        !(input.resumePublication && samePublicationActor(recordedActor, requestActor, { includeGeneration: false }))) {
        throw new Error("发布任务属于原账号或先前会话，请使用原账号明确恢复。");
      }
      if (requestActor) priorPublication = { ...priorPublication, actorBinding: requestActor };
      assertCurrentActor();
      if (input.operation === "retract") {
        const latest = latestPublicationRef.current.get(queueKey);
        let remoteAnnotationId = latest?.remoteAnnotationId ?? input.annotation.publication.remoteAnnotationId;
        if (!remoteAnnotationId) {
          const pending = input.annotation.publication.pendingOperation;
          const durableOperation = pending?.operation === "upsert" ? pending : input.annotation.publication.pendingCreateOperation;
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
          const replayResponse = await sendOperation(recovery.operation);
          const replayResult = replayResponse.results[0];
          if (!replayResult || replayResult.state === "failed") {
            return unknownCreateOutcome(
              replayResult?.error ?? "论坛发布响应缺少该批注的可验证结果。",
              recovery.operation,
              priorPublication
            );
          }
          try {
            priorPublication = confirmPdfAnnotationPublication(
              { ...recovery.annotation, publication: priorPublication },
              replayResult
            ).publication;
          } catch (error) {
            return unknownCreateOutcome(error, recovery.operation, priorPublication);
          }
          latestPublicationRef.current.set(queueKey, priorPublication);
          pendingCreateRecoveryRef.current.delete(queueKey);
          remoteAnnotationId = priorPublication.remoteAnnotationId;
          if (!remoteAnnotationId) {
            return unknownCreateOutcome("恢复回执缺少远端批注 ID。", recovery.operation, priorPublication);
          }
        }
        const durableRetract = input.annotation.publication.pendingOperation;
        operation = durableRetract?.operation === "retract" ? durableRetract : createRetractOperation({
          ...input.annotation,
          publication: {
            ...input.annotation.publication,
            remoteAnnotationId,
            remoteRevision: latest?.remoteRevision ?? input.annotation.publication.remoteRevision
          }
        });
      } else {
        assertPublicSource();
        const durableOperation = input.annotation.publication.pendingOperation ?? (input.restartReplay
          ? input.annotation.publication.pendingCreateOperation : undefined);
        if (durableOperation) {
          operation = durableOperation;
        } else {
          const paperKey = `${JSON.stringify(requestActor)}:${input.paper.id}`;
          const currentPaper = boundPapersRef.current.get(paperKey) ?? input.paper;
          let confirmedLiterature = input.restartReplay
            ? await literatureMetadataRepository.load(currentPaper.id)
            : currentPaper.literature;
          if (!confirmedLiterature) {
            confirmedLiterature = await literatureMetadataRepository.load(currentPaper.id);
          }
          assertCurrentActor();
          if (!confirmedLiterature) {
            const pendingResolution = resolveAndConfirm(input.literatureHints, currentPaper);
            if (!pendingResolution) return { ...busyPublication };
            confirmedLiterature = await pendingResolution;
            assertCurrentActor();
            if (!confirmedLiterature) {
              return { desiredVisibility: "private", state: "not_published" };
            }
          }
          const persistedPaper = await persistPaperLiterature(currentPaper, confirmedLiterature) ?? {
            ...currentPaper,
            literature: confirmedLiterature
          };
          assertCurrentActor();
          boundPapersRef.current.set(paperKey, persistedPaper);
          workspaceStore.updatePapers([persistedPaper]);
          onPaperUpdated(persistedPaper);
          operation = createUpsertOperation(input.annotation, confirmedLiterature);
        }
      }

      const response = await sendOperation(operation);
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
            revision: operation.revision,
            publication: {
              ...priorPublication,
              remoteAnnotationId: operation.remoteAnnotationId
            }
          }
        : { ...input.annotation, publication: priorPublication, revision: operation.revision };
      let publication = confirmPdfAnnotationPublication(currentAnnotation, result).publication;
      if (operation.operation === "upsert") {
        const currentPayload = createUpsertOperation(input.annotation, { literatureId: operation.literatureId });
        if (currentPayload.body !== operation.body || JSON.stringify(currentPayload.sourcePassage) !== JSON.stringify(operation.sourcePassage)) {
          publication = { ...publication, state: "failed", lastError: "原请求已核实，本地修改尚未发布，请确认更新。" };
        }
      } else if (input.operation !== "retract") {
        publication = { ...publication, desiredVisibility: "public", state: "failed", lastError: "原撤回已核实，请重新确认是否发布。" };
      }
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
    const requestActor = normalizePublicationActorBinding(actorBindingGetterRef.current?.());
    const requestClient = forumClientRef.current;
    const queueKey = `${JSON.stringify(requestActor)}:${input.annotation.paperIdentity.paperId}:${input.annotation.id}`;
    const previous = publicationQueuesRef.current.get(queueKey) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(() => performPublication(input, requestActor, requestClient));
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
    const identifier = draft.identifier?.trim();
    const doi = normalizeLiteratureIdentifier("doi", identifier);
    const arxiv = normalizeLiteratureIdentifier("arxiv_id", identifier);
    const identifiers = doi ? [{ kind: "doi" as const, value: doi }] : arxiv ? [{ kind: "arxiv_id" as const, value: arxiv }] : [];
    const hints = boundedHints({ ...draft, identifiers });
    if ((!hints?.title && !identifiers.length) || (identifier && !identifiers.length)) {
      setLiteratureDialog((current) => current ? {
        ...current,
        message: "请填写文献标题，或有效的 DOI / arXiv 编号；作者和年份可选。"
      } : current);
      return;
    }
    active.candidates = [];
    active.request = {
      hints,
      limit: 5,
      purpose: "liteasy_pdf_annotation",
      query: hints?.title || identifier
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
      hydrateResolutionStates,
      resolvePaperIdentity,
      retryResolution,
      searchLiterature,
      selectCandidate,
      stagePaperIdentity
    },
    model: { literatureDialog, resolutionsByPaperId }
  };
}
