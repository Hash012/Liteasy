import { invoke } from "@tauri-apps/api/core";

export const PAPER_ANNOTATIONS_SAVED_EVENT = "liteasy:paper-annotations-saved";
export const PAPER_FULLTEXT_SAVED_EVENT = "liteasy:paper-fulltext-saved";

/** Observe successful reader/OCR writes without subscribing to unrelated paper settings. */
export function subscribePaperFulltextSaved(listener: (paperId: string) => void) {
  if (typeof window === "undefined") return () => undefined;
  const receive = (event: Event) => {
    const paperId = (event as CustomEvent<unknown>).detail;
    if (typeof paperId === "string" && paperId.trim()) listener(paperId);
  };
  window.addEventListener(PAPER_FULLTEXT_SAVED_EVENT, receive);
  return () => window.removeEventListener(PAPER_FULLTEXT_SAVED_EVENT, receive);
}

export type UserPaperArtifactKind =
  | "anchor-graph"
  | "anchors"
  | "annotations"
  | "bibliographic-identity"
  | "citations"
  | "fulltext"
  | "file-metadata"
  | "literature-resolution"
  | "reader-state"
  | "whiteboard";

export function isUserPaperArtifactStoreAvailable() {
  return typeof window !== "undefined" &&
    typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
      .__TAURI_INTERNALS__?.invoke === "function";
}

export async function loadUserPaperArtifact<T>(input: {
  artifactKind: UserPaperArtifactKind;
  paperId: string;
}): Promise<T | undefined> {
  if (!isUserPaperArtifactStoreAvailable() || !input.paperId.trim()) {
    return undefined;
  }
  const snapshot = await invoke<T | null>("load_user_paper_artifact", {
    ...input
  });
  return snapshot ?? undefined;
}

export async function saveUserPaperArtifact(input: {
  artifactKind: UserPaperArtifactKind;
  paperId: string;
  snapshot: unknown;
}) {
  if (!isUserPaperArtifactStoreAvailable() || !input.paperId.trim()) {
    return;
  }
  await invoke("save_user_paper_artifact", {
    ...input
  });
  if (input.artifactKind === "annotations") window.dispatchEvent(new CustomEvent(PAPER_ANNOTATIONS_SAVED_EVENT, { detail: input.paperId }));
  if (input.artifactKind === "fulltext") {
    window.dispatchEvent(new CustomEvent(PAPER_FULLTEXT_SAVED_EVENT, { detail: input.paperId }));
  }
}
