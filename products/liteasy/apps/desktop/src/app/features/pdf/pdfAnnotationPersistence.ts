import { resolveLocalAccountKey } from "../library/localAccountKey";
import {
  isUserPaperArtifactStoreAvailable,
  saveUserPaperArtifact,
} from "../library/userPaperArtifactClient";
import { notifyNotesSourcesChanged } from "../notes/notesPort";
import {
  clearMigratedPdfAnnotationBrowserCache,
  type PdfAnnotationPrivateState,
} from "./pdfAnnotationStorage";

const pendingSaves = new Map<string, Promise<void>>();

/** Serialize snapshots so a slow earlier write cannot replace an edited entry or its review. */
export function persistPdfAnnotationState(input: {
  annotationStorageKey: string;
  autoPublicStorageKey: string | null;
  paperId: string;
  snapshot: PdfAnnotationPrivateState;
}): Promise<void> {
  const scope = resolveLocalAccountKey();
  const previous = pendingSaves.get(input.annotationStorageKey) ?? Promise.resolve();
  const save = previous.catch(() => {}).then(async () => {
    if (resolveLocalAccountKey() !== scope) throw new Error("账号已切换，批注未写入其他账号。");
    if (isUserPaperArtifactStoreAvailable()) {
      await saveUserPaperArtifact({
        artifactKind: "annotations",
        paperId: input.paperId,
        snapshot: input.snapshot,
      });
      clearMigratedPdfAnnotationBrowserCache(input.annotationStorageKey, input.autoPublicStorageKey);
    } else {
      // Do not hide quota/permission failures and claim that a review has been saved.
      window.localStorage.setItem(input.annotationStorageKey, JSON.stringify(input.snapshot.annotations));
      if (input.autoPublicStorageKey) {
        window.localStorage.setItem(input.autoPublicStorageKey, String(input.snapshot.autoPublic));
      }
    }
    notifyNotesSourcesChanged();
  });
  pendingSaves.set(input.annotationStorageKey, save);
  void save.finally(() => {
    if (pendingSaves.get(input.annotationStorageKey) === save) pendingSaves.delete(input.annotationStorageKey);
  }).catch(() => {});
  return save;
}
