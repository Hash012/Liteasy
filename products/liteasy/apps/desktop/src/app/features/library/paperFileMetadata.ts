import { resolveLocalAccountKey } from "./localAccountKey";
import {
  isUserPaperArtifactStoreAvailable,
  loadUserPaperArtifact,
  saveUserPaperArtifact
} from "./userPaperArtifactClient";

export type PaperFileMetadata = {
  category: string;
  tags: string[];
  version: 1;
};

const storagePrefix = "liteasy.paper-file-metadata/v1";

function storageKey(paperId: string) {
  return `${storagePrefix}:${resolveLocalAccountKey()}:${paperId}`;
}

export function normalizePaperFileMetadata(value: unknown): PaperFileMetadata {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as { category?: unknown; tags?: unknown }
    : {};
  const category = typeof candidate.category === "string"
    ? candidate.category.trim().slice(0, 80)
    : "";
  const tags = Array.isArray(candidate.tags)
    ? Array.from(new Set(candidate.tags.flatMap((tag) => {
        if (typeof tag !== "string") return [];
        const normalized = tag.trim().replace(/\s+/g, " ").slice(0, 40);
        return normalized ? [normalized] : [];
      }))).slice(0, 20)
    : [];
  return { category, tags, version: 1 };
}

function loadBrowserMetadata(paperId: string) {
  try {
    return normalizePaperFileMetadata(JSON.parse(window.localStorage.getItem(storageKey(paperId)) ?? "{}"));
  } catch {
    return normalizePaperFileMetadata(undefined);
  }
}

function cacheBrowserMetadata(paperId: string, metadata: PaperFileMetadata) {
  try {
    window.localStorage.setItem(storageKey(paperId), JSON.stringify(metadata));
    return null;
  } catch (error) {
    return error;
  }
}

export async function loadPaperFileMetadata(paperId: string): Promise<PaperFileMetadata> {
  if (typeof window === "undefined" || !paperId.trim()) return normalizePaperFileMetadata(undefined);
  const browserMetadata = loadBrowserMetadata(paperId);
  if (!isUserPaperArtifactStoreAvailable()) return browserMetadata;
  try {
    const stored = await loadUserPaperArtifact<unknown>({ artifactKind: "file-metadata", paperId });
    if (stored === undefined) return browserMetadata;
    const normalized = normalizePaperFileMetadata(stored);
    cacheBrowserMetadata(paperId, normalized);
    return normalized;
  } catch {
    return browserMetadata;
  }
}

export async function savePaperFileMetadata(paperId: string, value: unknown): Promise<PaperFileMetadata> {
  const normalized = normalizePaperFileMetadata(value);
  if (typeof window === "undefined" || !paperId.trim()) return normalized;
  const browserStorageError = cacheBrowserMetadata(paperId, normalized);
  if (isUserPaperArtifactStoreAvailable()) {
    await saveUserPaperArtifact({
      artifactKind: "file-metadata",
      paperId,
      snapshot: normalized
    });
  } else if (browserStorageError) {
    throw browserStorageError;
  }
  return normalized;
}
