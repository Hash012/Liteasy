import { invoke } from "@tauri-apps/api/core";
import { resolveLocalAccountKey } from "./localAccountKey";

export type UserPaperArtifactKind =
  | "anchor-graph"
  | "anchors"
  | "annotations"
  | "citations"
  | "fulltext"
  | "reader-state";

function canUseTauriUserPaperStore() {
  return typeof window !== "undefined" &&
    typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
      .__TAURI_INTERNALS__?.invoke === "function";
}

export async function loadUserPaperArtifact<T>(input: {
  artifactKind: UserPaperArtifactKind;
  paperId: string;
}): Promise<T | undefined> {
  if (!canUseTauriUserPaperStore() || !input.paperId.trim()) {
    return undefined;
  }
  const snapshot = await invoke<T | null>("load_user_paper_artifact", {
    ...input,
    accountKey: resolveLocalAccountKey()
  });
  return snapshot ?? undefined;
}

export async function saveUserPaperArtifact(input: {
  artifactKind: UserPaperArtifactKind;
  paperId: string;
  snapshot: unknown;
}) {
  if (!canUseTauriUserPaperStore() || !input.paperId.trim()) {
    return;
  }
  await invoke("save_user_paper_artifact", {
    ...input,
    accountKey: resolveLocalAccountKey()
  });
}
