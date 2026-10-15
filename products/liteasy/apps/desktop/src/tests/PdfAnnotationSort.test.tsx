import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PdfReader } from "../app/features/pdf/PdfReader";
import { PdfAnnotationsOverview } from "../app/features/pdf/PdfAnnotationsOverview";
import { comparePdfAnnotations } from "../app/features/pdf/pdfAnnotationSort";
import { pdfAnnotationStorageKey, savePdfAnnotations, type PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";

const paper = { id: "annotation-sort", title: "Sort", sourcePath: "/papers/sort.pdf" };
function item(id: string, page: number, created: number, modified: number): PdfAnnotationV2 {
  return { id, page, excerpt: id, kind: "highlight", text: "", rects: [], paperIdentity: resolvePaperIdentity(paper),
    createdAt: `2026-10-0${created}`, updatedAt: `2026-10-0${modified}`, revision: 1, publication: { desiredVisibility: "private", state: "not_published" } };
}
const annotations = [item("first", 1, 1, 9), item("second", 2, 3, 4), item("third", 3, 2, 8)];
function choose(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "批注排序" }));
  fireEvent.click(screen.getByRole("option", { name, exact: true }));
}
afterEach(() => { cleanup(); localStorage.clear(); });

test("date ties and invalid legacy dates fall back deterministically to reading order", () => {
  const sameDate = { ...annotations[1], createdAt: annotations[0].createdAt };
  expect(comparePdfAnnotations(annotations[0], sameDate, "created")).toBeLessThan(0);
  expect(comparePdfAnnotations({ ...annotations[0], updatedAt: "invalid" }, { ...sameDate, updatedAt: "invalid" }, "modified")).toBeLessThan(0);
});

test("sidebar sort changes presentation while keeping annotation storage intact", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), annotations);
  render(<PdfReader selectedPapers={[paper]} zoom={100} />);
  await screen.findByRole("button", { name: "编辑批注：first" });
  const order = () => screen.getAllByRole("button", { name: /^编辑批注：/ }).map((button) => button.getAttribute("aria-label"));
  expect(order()).toEqual(["编辑批注：first", "编辑批注：second", "编辑批注：third"]);
  const stored = localStorage.getItem(pdfAnnotationStorageKey(paper)!);
  choose("最近创建");
  expect(order()).toEqual(["编辑批注：second", "编辑批注：third", "编辑批注：first"]);
  choose("最近修改");
  expect(order()).toEqual(["编辑批注：first", "编辑批注：third", "编辑批注：second"]);
  expect(localStorage.getItem(pdfAnnotationStorageKey(paper)!)).toBe(stored);
});

test("overview sorts local and team entries together and retains the query", () => {
  const teamItem = item("shared", 4, 4, 5);
  render(<PdfAnnotationsOverview annotations={annotations} paperIdentity={resolvePaperIdentity(paper)}
    teamAnnotations={[{ annotationId: "shared", body: { ...teamItem, clientAnnotationId: "shared" }, uploadedBy: "reader", createdAt: teamItem.createdAt,
      updatedAt: teamItem.updatedAt, revision: 1, documentId: "doc", organizationId: "org" }]} onNavigate={vi.fn()} onClose={vi.fn()} />);
  choose("最近创建");
  const entries = screen.getAllByRole("listitem");
  expect(within(entries[0]).getByText("shared")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索全部批注" }), { target: { value: "first" } });
  choose("最近修改");
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("first", { selector: "mark" })).toBeVisible();
});
