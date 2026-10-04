import { expect, test } from "vitest";
import { inferredNoteLabels, isAiOnlyNote, resolvedNoteLabels } from "../app/features/notes/noteLabels";
import type { NotesItem } from "../app/features/notes/notes.types";
import { revisePdfAnnotation } from "../../../../packages/reading-core/src/pdfAnnotations";
import type { PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";

const annotation: PdfAnnotationV2 = {
  id: "guide", kind: "underline", page: 1, excerpt: "MVCC", text: "MVCC", note: "多版本并发控制",
  createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z", revision: 1, rects: [],
  paperIdentity: resolvePaperIdentity({ id: "paper", title: "Cicada" }),
  publication: { state: "not_published", desiredVisibility: "private" },
  aiGuide: { mode: "auto", level: "balanced", category: "term", runId: "guide-run" },
};
const item: NotesItem = { key: "guide", target: { kind: "pdf-annotation", paperId: "paper", annotationId: "guide" },
  title: "翻译只是标题，不是来源", text: "", source: "Cicada", defaultFolderId: "default/paper", updatedAt: annotation.updatedAt, editable: false, annotation };

test("keeps guide origin after personal edits and does not count geometry changes as user writing", () => {
  expect(inferredNoteLabels(item)).toEqual(["ai-guide", "ai-generated"]);
  expect(isAiOnlyNote(inferredNoteLabels(item))).toBe(true);
  const resized = revisePdfAnnotation(annotation, { rects: [{ left: 0, top: 0, width: 1, height: 1 }], updatedAt: "2026-10-04T01:00:00Z" });
  expect(resized.userEditedAt).toBeUndefined();
  const edited = revisePdfAnnotation(resized, { note: "自己的理解", updatedAt: "2026-10-04T02:00:00Z" });
  const labels = inferredNoteLabels({ ...item, annotation: edited });
  expect(labels).toContain("user-edited");
  expect(labels).toContain("ai-guide");
  expect(isAiOnlyNote(labels)).toBe(false);
});

test("allows explicit correction without guessing provenance from old content", () => {
  const unknown = { ...item, annotation: undefined };
  expect(inferredNoteLabels(unknown)).toEqual([]);
  expect(isAiOnlyNote(inferredNoteLabels(unknown))).toBe(false);
  expect(resolvedNoteLabels(item, { translation: true, "ai-guide": false })).toEqual(["translation", "ai-generated"]);
});
