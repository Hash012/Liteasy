import { expect, test } from "vitest";
import { isUntouchedGuide, mergePdfGuides } from "../app/features/pdf/pdfGuideAnnotations";
import { normalizePdfAnnotations, revisePdfAnnotation, type PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";

const guide = (id: string, patch: Partial<PdfAnnotationV2> = {}): PdfAnnotationV2 => ({
  id, page: 1, kind: "underline", color: "blue", excerpt: id, text: "概念", note: "简明讲解",
  rects: [{ left: 10, top: 20, width: 20, height: 3 }], createdAt: "2026-09-29T00:00:00Z", updatedAt: "2026-09-29T00:00:00Z", revision: 1,
  paperIdentity: resolvePaperIdentity({ id: "p", title: "Paper" }), publication: { desiredVisibility: "private", state: "not_published" },
  aiGuide: { mode: "auto", level: "balanced", category: "term", runId: "r" }, ...patch
});

test("regeneration preserves user highlights, edits, publication and unfinished pages; avoids duplicates of protected guides", () => {
  const unchanged = guide("old");
  const edit = revisePdfAnnotation(guide("edited"), { note: "自己的解释", updatedAt: "2026-09-29T01:00:00Z" });
  const highlight = guide("manual", { kind: "highlight", aiGuide: undefined });
  const other = guide("other", { page: 2 });
  const publicMark = guide("shared", { publication: { state: "published", desiredVisibility: "public", remoteAnnotationId: "remote" } });
  const merged = mergePdfGuides([unchanged, edit, highlight, other, publicMark], [guide("fresh"), guide("duplicate", { excerpt: "edited" })], [1]);
  expect(merged.map((mark) => mark.id)).toEqual(["edited", "manual", "other", "shared", "fresh"]);
  expect(merged.filter((mark) => !isUntouchedGuide(mark)).map((mark) => mark.id)).toEqual(["edited", "manual", "shared"]);
});

test("annotation persistence preserves guide metadata, old annotations and edited explanations; malformed optional metadata cannot delete notes", () => {
  const marks = [guide("ai"), guide("old", { aiGuide: undefined })];
  expect(normalizePdfAnnotations(JSON.parse(JSON.stringify(marks)))).toEqual(marks);
  const edited = revisePdfAnnotation(marks[0], { note: "保留我的修改", updatedAt: "2026-09-29T02:00:00Z" });
  expect(normalizePdfAnnotations([edited])[0]).toMatchObject({ note: "保留我的修改", revision: 2, aiGuide: marks[0].aiGuide });
  expect(normalizePdfAnnotations([{ ...edited, aiGuide: { mode: "future" } }])[0]).toMatchObject({ id: "ai", note: "保留我的修改" });
});
