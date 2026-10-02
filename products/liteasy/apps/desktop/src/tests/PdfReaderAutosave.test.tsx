import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PdfReader } from "../app/features/pdf/PdfReader";
import * as persistence from "../app/features/pdf/pdfAnnotationPersistence";
import * as artifacts from "../app/features/library/userPaperArtifactClient";
import { pdfAnnotationStorageKey, savePdfAnnotations, type PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { Paper } from "../app/features/workspace/workspace.types";

const paper: Paper = { id: "autosave-paper", title: "Autosave fixture", sourcePath: "/synthetic/autosave.pdf", contentHash: "old-content" };
function annotation(note = "Original note"): PdfAnnotationV2 {
  return {
    id: "autosave-annotation", kind: "note", page: 1, excerpt: "Synthetic evidence", text: "注释", note,
    rects: [{ height: 2, left: 20, top: 20, width: 30 }], revision: 1,
    createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z",
    paperIdentity: resolvePaperIdentity(paper), publication: { desiredVisibility: "private", state: "not_published" }
  };
}
function snapshot(note: string) {
  return { annotations: [annotation(note)], autoPublic: false, version: 2 };
}
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

test.each([false, true])("a replaced promotion callback does not save unchanged annotations (existing marks: %s)", async (hasAnnotations) => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), hasAnnotations ? [annotation()] : []);
  const save = vi.spyOn(persistence, "persistPdfAnnotationState").mockResolvedValue();
  const first = vi.fn(async () => {});
  const next = vi.fn(async () => {});
  const mounted = render(<PdfReader selectedPapers={[paper]} zoom={100} onPaperAnnotated={first} />);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(first).toHaveBeenCalledTimes(hasAnnotations ? 1 : 0);

  mounted.rerender(<PdfReader selectedPapers={[paper]} zoom={100} onPaperAnnotated={next} />);
  await act(async () => {});
  expect(save).toHaveBeenCalledTimes(1);
  expect(next).not.toHaveBeenCalled();
});

test("an actual annotation edit saves once and uses the latest promotion callback", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [annotation()]);
  const save = vi.spyOn(persistence, "persistPdfAnnotationState").mockResolvedValue();
  const first = vi.fn(async () => {});
  const next = vi.fn(async () => {});
  const mounted = render(<PdfReader selectedPapers={[paper]} zoom={100} onPaperAnnotated={first} />);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  mounted.rerender(<PdfReader selectedPapers={[paper]} zoom={100} onPaperAnnotated={next} />);
  await act(async () => {});
  save.mockClear(); first.mockClear(); next.mockClear();

  fireEvent.click(screen.getByRole("button", { name: "编辑批注：Synthetic evidence" }));
  fireEvent.change(screen.getByRole("textbox", { name: "补充批注笔记" }), { target: { value: "Edited note" } });
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0].snapshot.annotations[0].note).toBe("Edited note");
  expect(next).toHaveBeenCalledExactlyOnceWith(paper.id);
  expect(first).not.toHaveBeenCalled();
});

test("same-path content replacement waits for its artifact read before saving with the new hash", async () => {
  let complete!: (value: unknown) => void;
  let annotationReads = 0;
  vi.spyOn(artifacts, "loadUserPaperArtifact").mockImplementation(async ({ artifactKind }) => {
    if (artifactKind !== "annotations") return undefined;
    annotationReads += 1;
    if (annotationReads === 1) return snapshot("Before replacement") as never;
    return new Promise((resolve) => { complete = resolve; }) as never;
  });
  const save = vi.spyOn(persistence, "persistPdfAnnotationState").mockResolvedValue();
  const mounted = render(<PdfReader selectedPapers={[paper]} zoom={100} onPaperAnnotated={async () => {}} />);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  save.mockClear();

  const replaced = { ...paper, contentHash: "new-content" };
  mounted.rerender(<PdfReader selectedPapers={[replaced]} zoom={100} onPaperAnnotated={async () => {}} />);
  await act(async () => {});
  expect(annotationReads).toBe(2);
  expect(save).not.toHaveBeenCalled();

  await act(async () => { complete(snapshot("Recovered replacement note")); });
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(save.mock.calls[0][0]).toMatchObject({ paperId: paper.id, contentHash: "new-content" });
  expect(save.mock.calls[0][0].snapshot.annotations[0].note).toBe("Recovered replacement note");
});
