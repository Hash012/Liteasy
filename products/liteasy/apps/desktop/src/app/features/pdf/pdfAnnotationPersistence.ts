import { createRecommendationEvidenceStore, localRecommendationScope } from "../recommendations/recommendationEvidence";
import { loadRecommendationPreferences } from "../recommendations/recommendationPreferences";
import { feedHash } from "../recommendations/recommendationCoordinator";
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
  contentHash?: string;
  snapshot: PdfAnnotationPrivateState;
}): Promise<void> {
  const scope = resolveLocalAccountKey();
  const consentEpoch = loadRecommendationPreferences().consentEpoch;
  const previous = pendingSaves.get(input.annotationStorageKey) ?? Promise.resolve();
  const save = previous.catch(() => {}).then(async () => {
    if (resolveLocalAccountKey() !== scope) throw new Error("账号已切换，批注未写入其他账号。");
    if (isUserPaperArtifactStoreAvailable()) {
      await saveUserPaperArtifact({
        artifactKind: "annotations",
        paperId: input.paperId,
        snapshot: { ...input.snapshot, documentId: input.paperId, ...(input.contentHash ? { contentHash: input.contentHash } : {}) },
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
    // Only the committed annotation body is evidence. Generated reviews/answers and color edits are excluded.
    const evidence = createRecommendationEvidenceStore(scope === "guest" ? "local" : scope, localRecommendationScope);
    void (async () => {
      await evidence.forget(Object.keys(input.snapshot.sync?.tombstones ?? {}).map(id => `annotation:${input.paperId}:${id}`));
      for (const annotation of input.snapshot.annotations.slice(-64)) {
        if (annotation.aiGuide || annotation.quickAsk && !annotation.userEditedAt) continue;
        const text = [annotation.note, ["note", "text"].includes(annotation.kind) ? annotation.text : "", annotation.excerpt].filter(Boolean).join("\n").slice(0, 8000);
        if (!text.trim()) continue;
        const sourceId = `annotation:${input.paperId}:${annotation.id}`, revision = feedHash(text);
        await evidence.record({ id: `${sourceId}:${revision}`, producerActionId: sourceId, sourceId, revision,
          type: "annotation_committed", epoch: consentEpoch, at: Date.now(), text });
      }
    })().catch(() => {});
  });
  pendingSaves.set(input.annotationStorageKey, save);
  void save.finally(() => {
    if (pendingSaves.get(input.annotationStorageKey) === save) pendingSaves.delete(input.annotationStorageKey);
  }).catch(() => {});
  return save;
}
