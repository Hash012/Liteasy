import type { PaperIdentity } from "../paper-identity/paperIdentity";
import { resolveLocalAccountKey } from "../library/localAccountKey";

export type PdfAnnotationKind = "highlight" | "underline" | "note";
export type PdfHighlightColor = "yellow" | "red" | "blue" | "green" | "pink";
export type PdfAnnotationVisibility = "private" | "pending_public";
export type PdfAnnotationSyncState =
  | { error: string; lastAttemptAt: string; status: "failed" }
  | { forumDraftId: string; status: "synced"; syncedAt: string }
  | { intuechoAnnotationId: string; status: "synced"; syncedAt: string };

export type PdfAnnotationRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type PdfAnnotationPublication = {
  desiredVisibility: "private" | "public";
  lastError?: string;
  remoteAnnotationId?: string;
  remoteRevision?: number;
  state:
    | "not_published"
    | "resolving_identity"
    | "needs_identity_selection"
    | "needs_manual_identity"
    | "pending_create"
    | "published"
    | "pending_update"
    | "pending_retract"
    | "failed";
};

type PdfAnnotationBase = {
  color?: PdfHighlightColor;
  createdAt: string;
  excerpt: string;
  id: string;
  kind: PdfAnnotationKind;
  note?: string;
  page: number;
  paperIdentity: PaperIdentity;
  rects: PdfAnnotationRect[];
  text: string;
  updatedAt: string;
};

export type PdfAnnotation = PdfAnnotationBase & {
  publication?: PdfAnnotationPublication;
  revision?: number;
  syncState?: PdfAnnotationSyncState;
  visibility?: PdfAnnotationVisibility;
};

export type PdfAnnotationV2 = PdfAnnotation & {
  publication: PdfAnnotationPublication;
  revision: number;
  syncState?: never;
  visibility?: never;
};

export type PdfAnnotationV1 = PdfAnnotation & {
  syncState?: PdfAnnotationSyncState;
  visibility: PdfAnnotationVisibility;
};

export type PdfAnnotationPrivateState = {
  annotations: PdfAnnotationV2[];
  autoPublic: boolean;
  version: 2;
};

type PdfAnnotationEdit = Partial<Pick<
  PdfAnnotation,
  "color" | "excerpt" | "kind" | "note" | "page" | "publication" | "rects" | "text"
>> & { updatedAt: string };

type PdfAnnotationPublicationReceipt = {
  annotationId: string;
  queueKey: string;
  remoteAnnotationId: string;
  remoteRevision: number;
  sourceRevision: number;
  state: "published" | "retracted";
  syncedAt: string;
};

const storagePrefix = "liteasy.pdf-annotations/v1";
const autoPublicStoragePrefix = "liteasy.pdf-annotations-auto-public/v1";
const annotationKinds = new Set<PdfAnnotationKind>(["highlight", "underline", "note"]);
const highlightColors = new Set<PdfHighlightColor>(["yellow", "red", "blue", "green", "pink"]);

function canUseTauriArtifactStore() {
  return typeof window !== "undefined" &&
    typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
      .__TAURI_INTERNALS__?.invoke === "function";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAnnotationRect(value: unknown): value is PdfAnnotationRect {
  return Boolean(value) && typeof value === "object" &&
    isFiniteNumber((value as PdfAnnotationRect).height) &&
    isFiniteNumber((value as PdfAnnotationRect).left) &&
    isFiniteNumber((value as PdfAnnotationRect).top) &&
    isFiniteNumber((value as PdfAnnotationRect).width);
}

function isPaperIdentity(value: unknown): value is PaperIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PaperIdentity>;
  return typeof candidate.paperId === "string" && typeof candidate.title === "string" &&
    Array.isArray(candidate.candidates) && Boolean(candidate.primary) &&
    typeof candidate.primary === "object" && typeof candidate.primary.kind === "string" &&
    typeof candidate.primary.value === "string";
}

function isSyncState(value: unknown): value is PdfAnnotationSyncState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PdfAnnotationSyncState>;
  const syncedCandidate = candidate as {
    forumDraftId?: unknown;
    intuechoAnnotationId?: unknown;
    syncedAt?: unknown;
  };
  return (candidate.status === "synced" &&
    (typeof syncedCandidate.forumDraftId === "string" || typeof syncedCandidate.intuechoAnnotationId === "string") &&
    typeof syncedCandidate.syncedAt === "string") ||
    (candidate.status === "failed" && typeof candidate.error === "string" && typeof candidate.lastAttemptAt === "string");
}

const publicationStates = new Set<PdfAnnotationPublication["state"]>([
  "not_published",
  "resolving_identity",
  "needs_identity_selection",
  "needs_manual_identity",
  "pending_create",
  "published",
  "pending_update",
  "pending_retract",
  "failed"
]);

function isPublication(value: unknown): value is PdfAnnotationPublication {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PdfAnnotationPublication>;
  const hasRemoteAnnotation = typeof candidate.remoteAnnotationId === "string" && candidate.remoteAnnotationId.trim().length > 0;
  const remoteRequired = candidate.state === "published" || candidate.state === "pending_update" ||
    candidate.state === "pending_retract" ||
    (candidate.desiredVisibility === "private" && candidate.state === "failed");
  const visibilityCoherent = candidate.state === "failed" ||
    (candidate.desiredVisibility === "private"
      ? candidate.state === "not_published" || candidate.state === "pending_retract"
      : candidate.state !== "not_published" && candidate.state !== "pending_retract");
  return (candidate.desiredVisibility === "private" || candidate.desiredVisibility === "public") &&
    typeof candidate.state === "string" && publicationStates.has(candidate.state as PdfAnnotationPublication["state"]) &&
    (candidate.lastError === undefined || typeof candidate.lastError === "string") &&
    (candidate.remoteAnnotationId === undefined || hasRemoteAnnotation) &&
    (!remoteRequired || hasRemoteAnnotation) && visibilityCoherent &&
    (candidate.remoteRevision === undefined ||
      (hasRemoteAnnotation && typeof candidate.remoteRevision === "number" &&
        Number.isInteger(candidate.remoteRevision) && candidate.remoteRevision > 0));
}

function hasAnnotationFields(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PdfAnnotation>;
  return typeof candidate.id === "string" && candidate.id.length > 0 &&
    typeof candidate.excerpt === "string" && typeof candidate.text === "string" &&
    typeof candidate.kind === "string" && annotationKinds.has(candidate.kind as PdfAnnotationKind) &&
    typeof candidate.page === "number" && Number.isInteger(candidate.page) && candidate.page > 0 &&
    Array.isArray(candidate.rects) && candidate.rects.every(isAnnotationRect) &&
    (candidate.note === undefined || typeof candidate.note === "string") &&
    (candidate.color === undefined || highlightColors.has(candidate.color as PdfHighlightColor)) &&
    typeof candidate.createdAt === "string" && Number.isFinite(Date.parse(candidate.createdAt)) &&
    typeof candidate.updatedAt === "string" && Number.isFinite(Date.parse(candidate.updatedAt)) &&
    isPaperIdentity(candidate.paperIdentity);
}

function isAnnotation(value: unknown): value is PdfAnnotationV2 {
  if (!hasAnnotationFields(value)) return false;
  const candidate = value as Partial<PdfAnnotation>;
  return typeof candidate.revision === "number" && Number.isInteger(candidate.revision) && candidate.revision > 0 &&
    isPublication(candidate.publication);
}

function isVersionOneAnnotation(value: unknown): value is PdfAnnotationV1 {
  if (!hasAnnotationFields(value)) return false;
  const candidate = value as Partial<PdfAnnotation>;
  return (candidate.visibility === "private" || candidate.visibility === "pending_public") &&
    (candidate.syncState === undefined || isSyncState(candidate.syncState));
}

function isLegacyAnnotation(value: unknown): value is Omit<
  PdfAnnotationV1,
  "createdAt" | "paperIdentity" | "updatedAt" | "visibility"
> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PdfAnnotation>;
  return typeof candidate.id === "string" && candidate.id.length > 0 &&
    typeof candidate.excerpt === "string" && typeof candidate.text === "string" &&
    typeof candidate.kind === "string" && annotationKinds.has(candidate.kind as PdfAnnotationKind) &&
    typeof candidate.page === "number" && Number.isInteger(candidate.page) && candidate.page > 0 &&
    Array.isArray(candidate.rects) && candidate.rects.every(isAnnotationRect) &&
    (candidate.note === undefined || typeof candidate.note === "string") &&
    (candidate.color === undefined || highlightColors.has(candidate.color as PdfHighlightColor));
}

export function pdfAnnotationStorageKey(paper: { id: string; sourcePath?: string } | null) {
  if (!paper?.id) {
    return null;
  }
  return `${storagePrefix}:${resolveLocalAccountKey()}:${paper.id}:${stableHash(paper.sourcePath ?? "")}`;
}

export function pdfAnnotationAutoPublicStorageKey(paper: { id: string; sourcePath?: string } | null) {
  const annotationKey = pdfAnnotationStorageKey(paper);
  return annotationKey ? annotationKey.replace(storagePrefix, autoPublicStoragePrefix) : null;
}

function legacyAnnotationStorageKey(storageKey: string) {
  const accountSegment = `:${resolveLocalAccountKey()}:`;
  return storageKey.includes(accountSegment)
    ? storageKey.replace(accountSegment, ":")
    : storageKey;
}

function matchingArtifactStorageKeys(storageKey: string, prefix: string) {
  const unscopedKey = legacyAnnotationStorageKey(storageKey);
  const suffix = unscopedKey.slice(prefix.length);
  return Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((key): key is string => typeof key === "string" &&
      key.startsWith(`${prefix}:`) && key.endsWith(suffix));
}

function loadScopedAnnotationValue(storageKey: string) {
  const scopedValue = window.localStorage.getItem(storageKey);
  if (scopedValue !== null) return scopedValue;
  const legacyKey = legacyAnnotationStorageKey(storageKey);
  if (legacyKey === storageKey) return null;
  const legacyValue = window.localStorage.getItem(legacyKey);
  if (legacyValue !== null) {
    window.localStorage.setItem(storageKey, legacyValue);
    window.localStorage.removeItem(legacyKey);
  }
  return legacyValue;
}

export function loadPdfAnnotationAutoPublic(storageKey: string | null) {
  if (!storageKey || typeof window === "undefined") return false;
  return loadScopedAnnotationValue(storageKey) === "true";
}

export function savePdfAnnotationAutoPublic(storageKey: string | null, enabled: boolean) {
  if (!storageKey || typeof window === "undefined" || canUseTauriArtifactStore()) return;
  try {
    window.localStorage.setItem(storageKey, String(enabled));
  } catch {
    // Storage can be unavailable in private or quota-constrained webviews.
  }
}

export function normalizePdfAnnotations(value: unknown, fallbackPaperIdentity?: PaperIdentity): PdfAnnotationV2[] {
  if (!Array.isArray(value)) return [];
  const now = new Date().toISOString();
  return value.flatMap((annotation) => {
    if (isAnnotation(annotation)) {
      const { syncState: _syncState, visibility: _visibility, ...current } = annotation;
      return [{ ...current, publication: { ...annotation.publication! }, rects: annotation.rects.map((rect) => ({ ...rect })) }];
    }
    if (annotation && typeof annotation === "object" && !Array.isArray(annotation) &&
      ("publication" in annotation || "revision" in annotation)) {
      return [];
    }
    if (isVersionOneAnnotation(annotation)) {
      const { syncState, visibility, ...legacy } = annotation;
      let publication: PdfAnnotationPublication;
      if (visibility === "private") {
        publication = { desiredVisibility: "private", state: "not_published" };
      } else if (syncState?.status === "synced" && "intuechoAnnotationId" in syncState) {
        publication = {
          desiredVisibility: "public",
          remoteAnnotationId: syncState.intuechoAnnotationId,
          state: "published"
        };
      } else if (syncState?.status === "synced") {
        publication = {
          desiredVisibility: "public",
          lastError: `旧论坛交接 ${syncState.forumDraftId} 未确认直接发布，请重新发布。`,
          state: "failed"
        };
      } else if (syncState?.status === "failed") {
        publication = { desiredVisibility: "public", lastError: syncState.error, state: "failed" };
      } else {
        publication = { desiredVisibility: "public", state: "pending_create" };
      }
      return [{ ...legacy, publication, rects: annotation.rects.map((rect) => ({ ...rect })), revision: 1 }];
    }
    if (fallbackPaperIdentity && isLegacyAnnotation(annotation)) {
      return [{
        ...annotation,
        createdAt: now,
        paperIdentity: fallbackPaperIdentity,
        publication: { desiredVisibility: "private", state: "not_published" },
        rects: annotation.rects.map((rect) => ({ ...rect })),
        revision: 1,
        updatedAt: now,
      }];
    }
    return [];
  });
}

export function revisePdfAnnotation(annotation: PdfAnnotationV2, edit: PdfAnnotationEdit): PdfAnnotationV2 {
  const currentRevision = annotation.revision;
  if (typeof currentRevision !== "number" || !Number.isInteger(currentRevision) || currentRevision <= 0) {
    throw new Error("PDF 批注缺少可递增的本地修订号。");
  }
  return {
    ...annotation,
    ...edit,
    ...(edit.publication ? { publication: { ...edit.publication } } : {}),
    ...(edit.rects ? { rects: edit.rects.map((rect) => ({ ...rect })) } : {}),
    revision: currentRevision + 1
  };
}

export function confirmPdfAnnotationPublication(
  annotation: PdfAnnotationV2,
  receipt: PdfAnnotationPublicationReceipt
): PdfAnnotationV2 {
  const queueKey = `${annotation.paperIdentity.paperId}:${annotation.id}`;
  if (receipt.annotationId !== annotation.id || receipt.queueKey !== queueKey || receipt.sourceRevision !== annotation.revision ||
    !Number.isInteger(receipt.remoteRevision) || receipt.remoteRevision <= 0 ||
    !receipt.remoteAnnotationId.trim() ||
    (annotation.publication.remoteAnnotationId !== undefined &&
      annotation.publication.remoteAnnotationId !== receipt.remoteAnnotationId) ||
    (annotation.publication.remoteRevision !== undefined &&
      receipt.remoteRevision < annotation.publication.remoteRevision)) {
    throw new Error("论坛发布回执与本地批注不匹配。");
  }
  return {
    ...annotation,
    publication: {
      desiredVisibility: receipt.state === "retracted" ? "private" : "public",
      remoteAnnotationId: receipt.remoteAnnotationId,
      remoteRevision: receipt.remoteRevision,
      state: receipt.state === "retracted" ? "not_published" : "published"
    }
  };
}

export function normalizePdfAnnotationPrivateState(
  value: unknown,
  fallbackPaperIdentity?: PaperIdentity
): PdfAnnotationPrivateState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as { annotations?: unknown; autoPublic?: unknown; version?: unknown };
  if (!Array.isArray(candidate.annotations)) {
    return undefined;
  }
  return {
    annotations: normalizePdfAnnotations(candidate.annotations, fallbackPaperIdentity),
    autoPublic: candidate.autoPublic === true,
    version: 2
  };
}

export function loadPdfAnnotationBrowserMigrationState(
  annotationStorageKey: string | null,
  autoPublicStorageKey: string | null,
  fallbackPaperIdentity?: PaperIdentity
): PdfAnnotationPrivateState | undefined {
  if (!annotationStorageKey || !autoPublicStorageKey || typeof window === "undefined" ||
    !canUseTauriArtifactStore()) {
    return undefined;
  }
  const annotationsById = new Map<string, PdfAnnotationV2>();
  let found = false;
  try {
    for (const key of matchingArtifactStorageKeys(annotationStorageKey, storagePrefix)) {
      const serialized = window.localStorage.getItem(key);
      if (serialized === null) continue;
      found = true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(serialized);
      } catch {
        continue;
      }
      for (const annotation of normalizePdfAnnotations(parsed, fallbackPaperIdentity)) {
        const current = annotationsById.get(annotation.id);
        if (!current || Date.parse(annotation.updatedAt) >= Date.parse(current.updatedAt)) {
          annotationsById.set(annotation.id, annotation);
        }
      }
    }
    const autoPublic = matchingArtifactStorageKeys(autoPublicStorageKey, autoPublicStoragePrefix)
      .some((key) => {
        const value = window.localStorage.getItem(key);
        found ||= value !== null;
        return value === "true";
      });
    return found ? { annotations: [...annotationsById.values()], autoPublic, version: 2 } : undefined;
  } catch {
    return undefined;
  }
}

export function loadPdfAnnotations(storageKey: string | null, fallbackPaperIdentity?: PaperIdentity): PdfAnnotation[] {
  if (!storageKey || typeof window === "undefined") {
    return [];
  }
  try {
    return normalizePdfAnnotations(
      JSON.parse(loadScopedAnnotationValue(storageKey) ?? "[]"),
      fallbackPaperIdentity
    );
  } catch {
    return [];
  }
}

export function savePdfAnnotations(storageKey: string | null, annotations: readonly PdfAnnotation[]) {
  if (!storageKey || typeof window === "undefined" || canUseTauriArtifactStore()) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(annotations));
  } catch {
    // Storage can be unavailable in private or quota-constrained webviews.
  }
}

export function clearMigratedPdfAnnotationBrowserCache(
  annotationStorageKey: string | null,
  autoPublicStorageKey: string | null
) {
  if (typeof window === "undefined" || !canUseTauriArtifactStore()) return;
  try {
    for (const [storageKey, prefix] of [
      [annotationStorageKey, storagePrefix],
      [autoPublicStorageKey, autoPublicStoragePrefix]
    ] as const) {
      if (!storageKey) continue;
      for (const key of matchingArtifactStorageKeys(storageKey, prefix)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // A successful disk migration remains authoritative even if WebView cache cleanup fails.
  }
}
