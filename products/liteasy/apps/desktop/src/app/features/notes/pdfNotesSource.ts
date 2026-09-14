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
export async function loadPdfNotes(papers: Paper[]): Promise<NotesItem[]> {
  const result: NotesItem[] = [];
  for (const paper of papers) {
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
          "论文笔记",
        text: text || annotation.quickAsk?.answer || annotation.excerpt,
        source: `${paper.title} · 第 ${annotation.page} 页`,
        defaultFolderId: "default/paper",
        updatedAt: annotation.updatedAt,
        editable: false,
        automaticallyListed: Boolean(text || annotation.quickAsk),
        paper,
        annotation,
      });
    }
  }
  return result;
}
