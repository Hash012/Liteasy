import { pdfAnnotationReviewMarkdown } from "../pdf/pdfAnnotationReview";
import { resolvePaperIdentity } from "../paper-identity/paperIdentity";
import {
  isUserPaperArtifactStoreAvailable,
  loadUserPaperArtifact,
} from "../library/userPaperArtifactClient";
import {
  pdfAnnotationStorageKey,
  recoverPdfAnnotationPrivateState,
} from "../pdf/pdfAnnotationStorage";
import type { Paper } from "../workspace/workspace.types";
import {
  notesTargetKey,
  type NotesItem,
  type NotesTarget,
} from "./notes.types";

/** Read-only adapter. Never imports legacy data or updates the PDF publication state. */
export async function loadPdfNotes(
  papers: Paper[],
  onError?: (paperId: string, error: unknown) => void,
): Promise<NotesItem[]> {
  const result: NotesItem[] = [];
  for (const paper of papers) {
    try {
      const snapshot = isUserPaperArtifactStoreAvailable()
        ? await loadUserPaperArtifact({
            artifactKind: "annotations",
            paperId: paper.id,
          })
        : {
            annotations: JSON.parse(
              window.localStorage.getItem(pdfAnnotationStorageKey(paper)!) ??
                "[]",
            ),
            version: 2,
          };
      const state = recoverPdfAnnotationPrivateState(
        snapshot,
        resolvePaperIdentity(paper),
      );
      for (const annotation of state.annotations) {
        const text =
          annotation.note?.trim() ||
          (annotation.kind === "text" || annotation.kind === "note"
            ? annotation.text.trim()
            : "");
        const target: NotesTarget = {
          kind: "pdf-annotation",
          paperId: paper.id,
          annotationId: annotation.id,
        };
        result.push({
          key: notesTargetKey(target),
          target,
          title:
            text.split("\n")[0].slice(0, 100) ||
            annotation.quickAsk?.question ||
            annotation.excerpt.split("\n")[0].slice(0, 100) ||
            "论文笔记",
          text: [
            text || annotation.quickAsk?.answer || annotation.excerpt,
            pdfAnnotationReviewMarkdown(annotation),
          ]
            .filter(Boolean)
            .join("\n\n"),
          source: `${paper.title} · 第 ${annotation.page} 页`,
          defaultFolderId: "default/paper",
          updatedAt: annotation.updatedAt,
          editable: false,
          automaticallyListed: Boolean(
            text || annotation.quickAsk || annotation.review,
          ),
          paper,
          annotation,
        });
      }
    } catch (error) {
      onError?.(paper.id, error);
    }
  }
  return result;
}
