import type { PaperIdentity } from "../paper-identity/paperIdentity";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import { normalizePdfAnnotations, type PdfAnnotation, type PdfAnnotationPrivateState, type PdfAnnotationV2 } from "../../../../../../packages/reading-core/src/pdfAnnotations";
export * from "../../../../../../packages/reading-core/src/pdfAnnotations";

const storagePrefix = "liteasy.pdf-annotations/v1";
const autoPublicStoragePrefix = "liteasy.pdf-annotations-auto-public/v1";
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

export function pdfAnnotationStorageKey(paper: { id: string; sourcePath?: string; contentHash?: string } | null) {
  if (!paper?.id) {
    return null;
  }
  // Blob URLs are recreated on each browser launch; the file digest identifies the same bytes.
  const sourceIdentity = paper.sourcePath?.startsWith("blob:") && paper.contentHash
    ? `sha256:${paper.contentHash}` : paper.sourcePath ?? "";
  return `${storagePrefix}:${resolveLocalAccountKey()}:${paper.id}:${stableHash(sourceIdentity)}`;
}

export function pdfAnnotationAutoPublicStorageKey(paper: { id: string; sourcePath?: string; contentHash?: string } | null) {
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
