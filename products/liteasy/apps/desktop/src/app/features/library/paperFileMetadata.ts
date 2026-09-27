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

function storageKey(paperId: string, accountKey: string) {
  return `${storagePrefix}:${accountKey}:${paperId}`;
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

function loadBrowserMetadata(paperId: string, accountKey: string) {
  try {
    return normalizePaperFileMetadata(JSON.parse(window.localStorage.getItem(storageKey(paperId, accountKey)) ?? "{}"));
  } catch {
    return normalizePaperFileMetadata(undefined);
  }
}

function cacheBrowserMetadata(paperId: string, accountKey: string, metadata: PaperFileMetadata) {
  try {
    window.localStorage.setItem(storageKey(paperId, accountKey), JSON.stringify(metadata));
    return null;
  } catch (error) {
    return error;
  }
}

export async function loadPaperFileMetadata(paperId: string): Promise<PaperFileMetadata> {
  if (typeof window === "undefined" || !paperId.trim()) return normalizePaperFileMetadata(undefined);
  const accountKey = resolveLocalAccountKey();
  const browserMetadata = loadBrowserMetadata(paperId, accountKey);
  if (!isUserPaperArtifactStoreAvailable()) return browserMetadata;
  try {
    const stored = await loadUserPaperArtifact<unknown>({ artifactKind: "file-metadata", paperId });
    // A delayed native response belongs to the caller's original account. Keep
    // the original fallback and do not populate either account's cache after a switch.
    if (resolveLocalAccountKey() !== accountKey) return browserMetadata;
    if (stored === undefined) return browserMetadata;
    const normalized = normalizePaperFileMetadata(stored);
    cacheBrowserMetadata(paperId, accountKey, normalized);
    return normalized;
  } catch {
    return browserMetadata;
  }
}

export async function savePaperFileMetadata(paperId: string, value: unknown): Promise<PaperFileMetadata> {
  const normalized = normalizePaperFileMetadata(value);
  if (typeof window === "undefined" || !paperId.trim()) return normalized;
  const accountKey = resolveLocalAccountKey();
  const browserStorageError = cacheBrowserMetadata(paperId, accountKey, normalized);
  if (isUserPaperArtifactStoreAvailable()) {
    await saveUserPaperArtifact({
      artifactKind: "file-metadata",
      paperId,
      snapshot: normalized
    });
    if (resolveLocalAccountKey() !== accountKey) throw new Error("账号已切换，请重新打开文献。");
  } else if (browserStorageError) {
    throw browserStorageError;
  }
  return normalized;
}
