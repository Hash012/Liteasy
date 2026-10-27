import { pdfAnnotationAction, editExpandedPdfAnnotationNote } from "./fixtures/renderWithPdfAnnotations";
import { renderWithPdfAnnotations as render } from "./fixtures/renderWithPdfAnnotations";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PdfReader } from "../app/features/pdf/PdfReader";
import { loadPdfAnnotations, pdfAnnotationStorageKey, savePdfAnnotations, type PdfAnnotationPublication, type PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import { clearStoredAccountSession, storeAccountSession } from "../app/features/account/accountSessionStorage";

const paper = { id: "delete-safety", title: "Delete safety", sourcePath: "/papers/delete.pdf" };
const published: PdfAnnotationPublication = { desiredVisibility: "public", state: "published", remoteAnnotationId: "remote", remoteRevision: 1 };
function item(excerpt = "Original evidence", publication: PdfAnnotationPublication = { desiredVisibility: "private", state: "not_published" }): PdfAnnotationV2 {
  return { id: "same-id", page: 1, excerpt, kind: "note", text: "", note: "Important note", rects: [], paperIdentity: resolvePaperIdentity(paper),
    createdAt: "2026-10-01", updatedAt: "2026-10-01", revision: 1, publication };
}
function openDeletion(excerpt = "Original evidence") {
  fireEvent.click(screen.getByRole("button", { name: `展开批注：${excerpt}` }));
  fireEvent.click(pdfAnnotationAction(excerpt, "删除批注"));
  return screen.getByRole("dialog", { name: "删除批注确认" });
}
afterEach(() => { cleanup(); localStorage.clear(); clearStoredAccountSession(); vi.restoreAllMocks(); });

test("deletion first offers cancellation and removes the saved private note only after confirmation", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item()]);
  render(<PdfReader selectedPapers={[paper]} zoom={100} />);
  await screen.findByRole("button", { name: "展开批注：Original evidence" });
  const dialog = openDeletion();
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole("button", { name: "保留批注" }));
  expect(screen.queryByRole("dialog", { name: "删除批注确认" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "展开批注：Original evidence" })).toBeVisible();
  fireEvent.click(pdfAnnotationAction("Original evidence", "删除批注"));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(0));
});

test("public deletion explains retraction and disables repeat deletion while the request is pending", async () => {
  let finish!: (publication: PdfAnnotationPublication) => void;
  const onChange = vi.fn(() => new Promise<PdfAnnotationPublication>((resolve) => { finish = resolve; }));
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item(undefined, published)]);
  render(<PdfReader selectedPapers={[paper]} zoom={100} onChangeAnnotationPublication={onChange} />);
  await screen.findByRole("button", { name: "展开批注：Original evidence" });
  const dialog = openDeletion();
  expect(dialog).toHaveTextContent("将先从论坛撤回");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "展开批注：Original evidence" }));
  expect(pdfAnnotationAction("Original evidence", "删除批注")).toHaveAttribute("aria-disabled", "true");
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ operation: "retract", paper, annotation: expect.objectContaining({ id: "same-id" }) }));
  await act(async () => { finish({ desiredVisibility: "private", state: "not_published" }); });
  expect(screen.queryByRole("button", { name: "展开批注：Original evidence" })).not.toBeInTheDocument();
});

test.each(["document", "account"])("late retract results cannot delete or rewrite an identical annotation id after switching %s", async (scope) => {
  let finish!: (publication: PdfAnnotationPublication) => void;
  const onChange = vi.fn(() => new Promise<PdfAnnotationPublication>((resolve) => { finish = resolve; }));
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item(undefined, published)]);
  const view = render(<PdfReader selectedPapers={[paper]} zoom={100} onChangeAnnotationPublication={onChange} />);
  await screen.findByRole("button", { name: "展开批注：Original evidence" });
  openDeletion();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  const nextPaper = scope === "document" ? { ...paper, id: "second-paper", sourcePath: "/papers/second.pdf" } : paper;
  if (scope === "account") storeAccountSession({ accessToken: "test-token", sessionId: "second", userId: "second-user", email: "second@example.test", endpoint: "http://localhost", membershipTier: "basic" });
  const next = { ...item("New scope evidence"), paperIdentity: resolvePaperIdentity(nextPaper) };
  savePdfAnnotations(pdfAnnotationStorageKey(nextPaper), [next]);
  view.rerender(<PdfReader selectedPapers={[nextPaper]} zoom={100} onChangeAnnotationPublication={onChange} />);
  await screen.findByRole("button", { name: "展开批注：New scope evidence" });
  await act(async () => { finish({ desiredVisibility: "private", state: "not_published", remoteAnnotationId: "old-remote", remoteRevision: 2 }); });
  expect(screen.getByRole("button", { name: "展开批注：New scope evidence" })).toBeVisible();
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(nextPaper))).toEqual([next]);
});

test("switching documents dismisses an unconfirmed deletion without changing either document", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item()]);
  const nextPaper = { ...paper, id: "next", sourcePath: "/papers/next.pdf" };
  savePdfAnnotations(pdfAnnotationStorageKey(nextPaper), [{ ...item("Next evidence"), paperIdentity: resolvePaperIdentity(nextPaper) }]);
  const view = render(<PdfReader selectedPapers={[paper]} zoom={100} />);
  await screen.findByRole("button", { name: "展开批注：Original evidence" });
  openDeletion();
  view.rerender(<PdfReader selectedPapers={[nextPaper]} zoom={100} />);
  expect(screen.queryByRole("dialog", { name: "删除批注确认" })).not.toBeInTheDocument();
  expect(await screen.findByRole("button", { name: "展开批注：Next evidence" })).toBeVisible();
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))).toHaveLength(1);
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(nextPaper))).toHaveLength(1);
});

test("a user edit made while retracting cancels deletion without discarding the newer content", async () => {
  let finish!: (publication: PdfAnnotationPublication) => void;
  const onChange = vi.fn(() => new Promise<PdfAnnotationPublication>((resolve) => { finish = resolve; }));
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item(undefined, published)]);
  render(<PdfReader selectedPapers={[paper]} zoom={100} onChangeAnnotationPublication={onChange} />);
  await screen.findByRole("button", { name: "展开批注：Original evidence" });
  openDeletion();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "展开批注：Original evidence" }));
  editExpandedPdfAnnotationNote();
  fireEvent.change(screen.getByRole("textbox", { name: "补充批注笔记" }), { target: { value: "New evidence added while waiting" } });
  fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
  await act(async () => { finish({ desiredVisibility: "private", state: "not_published" }); });
  expect(screen.getByRole("button", { name: "展开批注：Original evidence" })).toBeVisible();
  expect(loadPdfAnnotations(pdfAnnotationStorageKey(paper))[0].note).toBe("New evidence added while waiting");
  expect(screen.getByText("批注已更新，删除已取消。请核对后重试。")).toBeVisible();
});
