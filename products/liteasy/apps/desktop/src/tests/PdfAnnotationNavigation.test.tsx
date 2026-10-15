import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PdfReader } from "../app/features/pdf/PdfReader";
import { pdfAnnotationStorageKey, savePdfAnnotations, type PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";

const paper = { id: "annotation-navigation", title: "Navigation", sourcePath: "/papers/navigation.pdf" };
function item(id: string, top: number): PdfAnnotationV2 {
  return { id, kind: "highlight", page: 1, text: "", excerpt: id, note: "Original note", paperIdentity: resolvePaperIdentity(paper),
    rects: [{ left: 10, top, height: 3, width: 20 }], createdAt: "2026-10-01", updatedAt: "2026-10-01", revision: 1,
    publication: { desiredVisibility: "private", state: "not_published" } };
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

test("summary arrow keys follow visible entries, preserve editor drafts, and use Ctrl+Enter to locate", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item("first", 10), item("second", 20), item("third", 30)]);
  render(<PdfReader selectedPapers={[paper]} zoom={100} />);
  const first = await screen.findByRole("button", { name: "编辑批注：first" });
  const second = screen.getByRole("button", { name: "编辑批注：second" });
  const third = screen.getByRole("button", { name: "编辑批注：third" });
  fireEvent.click(first);
  const editor = screen.getByRole("textbox", { name: "补充批注笔记" });
  fireEvent.change(editor, { target: { value: "Unsaved draft" } });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(second).toHaveFocus();
  expect(editor).toHaveValue("Unsaved draft");
  expect(first).toHaveAttribute("aria-expanded", "true");
  fireEvent.keyDown(second, { key: "End" });
  expect(third).toHaveFocus();
  fireEvent.keyDown(third, { key: "Home" });
  expect(first).toHaveFocus();
  editor.focus();
  fireEvent.keyDown(editor, { key: "ArrowDown" });
  expect(editor).toHaveFocus();
  fireEvent.keyDown(third, { key: "Enter", ctrlKey: true });
  expect(screen.getByText("已定位到第 1 页的高亮。")).toBeInTheDocument();
  expect(first).toHaveAttribute("aria-expanded", "true");
  fireEvent.change(screen.getByRole("textbox", { name: "搜索批注内容" }), { target: { value: "third" } });
  third.focus();
  fireEvent.keyDown(third, { key: "Home" });
  expect(third).toHaveFocus();
});

test("selecting a filtered page annotation offers to reveal and scroll its sidebar entry", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [item("first", 10), item("second", 20)]);
  await act(async () => { render(<PdfReader selectedPapers={[paper]} zoom={100} />); });
  fireEvent.change(screen.getByRole("textbox", { name: "搜索批注内容" }), { target: { value: "first" } });
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: scrollIntoView, configurable: true });
  fireEvent.click(screen.getByRole("button", { name: "高亮标注：第 1 页：second" }));
  expect(screen.queryByRole("button", { name: "编辑批注：second" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "显示选中批注" }));
  expect(screen.getByRole("button", { name: "编辑批注：second" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("textbox", { name: "搜索批注内容" })).toHaveValue("");
  expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
});
