import { renderWithPdfAnnotations } from "./fixtures/renderWithPdfAnnotations";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PdfReader } from "../app/features/pdf/PdfReader";
import { PdfAnnotationsOverview } from "../app/features/pdf/PdfAnnotationsOverview";
import { PdfAnnotationFilters, matchesPdfAnnotationFacets } from "../app/features/pdf/PdfAnnotationFilters";
import { pdfAnnotationStorageKey, savePdfAnnotations, loadPdfAnnotations, pdfHighlightColors, type PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { TeamAnnotation } from "../app/features/organization/teamAnnotationClient";

const paper = { id: "annotation-filters", title: "Filters", sourcePath: "/papers/filters.pdf" };
const paperIdentity = resolvePaperIdentity(paper);
function item(id: string, kind: PdfAnnotationV2["kind"], color?: PdfAnnotationV2["color"]): PdfAnnotationV2 {
  return { id, kind, color, paperIdentity, page: 1, excerpt: id, text: kind, rects: [{ left: 10, top: 10, width: 20, height: 3 }],
    createdAt: "2026-10-01", updatedAt: "2026-10-01", revision: 1, publication: { desiredVisibility: "private", state: "not_published" } };
}
const items = [item("yellow highlight", "highlight"), item("blue highlight", "highlight", "blue"), item("blue underline", "underline")];
function choose(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option, exact: true }));
}
afterEach(() => { cleanup(); localStorage.clear(); });

test("color filters match rendered defaults and ignore unused colors on note objects", () => {
  expect(matchesPdfAnnotationFacets(items[0], { kind: "all", color: "yellow" })).toBe(true);
  expect(matchesPdfAnnotationFacets(items[2], { kind: "underline", color: "blue" })).toBe(true);
  expect(matchesPdfAnnotationFacets(item("note", "note", "blue"), { kind: "all", color: "blue" })).toBe(false);
});

test("sidebar combines kind and color filters across local and team annotations without hiding page marks", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), items);
  const shared: TeamAnnotation = { annotationId: "shared", body: { ...item("team underline", "underline", "blue"), clientAnnotationId: "shared" },
    createdAt: "2026-10-01", updatedAt: "2026-10-01", revision: 1, uploadedBy: "reader", documentId: "doc", organizationId: "org" };
  renderWithPdfAnnotations(<PdfReader selectedPapers={[paper]} zoom={100} loadOrganizationAnnotations={async () => [shared]} />);
  await screen.findByText("team underline");
  fireEvent.click(screen.getByRole("button", { name: "筛选蓝色批注" }));
  expect(screen.queryByRole("button", { name: "展开批注：yellow highlight" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "展开批注：blue highlight" })).toBeVisible();
  choose("筛选批注类型", "划线");
  expect(screen.queryByRole("button", { name: "展开批注：blue highlight" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "展开批注：blue underline" })).toBeVisible();
  expect(within(screen.getByRole("region", { name: "团队批注" })).getByText("team underline")).toBeVisible();
  expect(screen.getByLabelText("批注检索结果")).toHaveTextContent("2 / 4 条批注");
  expect(document.querySelectorAll(".pdf-overlay-mark")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "清除类型与颜色筛选" }));
  expect(screen.getByLabelText("批注检索结果")).toHaveTextContent("4 / 4 条批注");
});

test("overview combines query, type and color and keeps an empty filter removable", () => {
  renderWithPdfAnnotations(<PdfAnnotationsOverview annotations={items} teamAnnotations={[]} onNavigate={vi.fn()} onClose={vi.fn()} />);
  choose("筛选批注类型", "高亮");
  fireEvent.click(screen.getByRole("button", { name: "筛选蓝色批注" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("blue highlight")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索全部批注" }), { target: { value: "yellow" } });
  expect(screen.getByText("没有匹配的批注。")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "清除类型与颜色筛选" }));
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("yellow", { selector: "mark" })).toBeVisible();
});


test("exposes only present colors with counts and toggles a selected color off", () => {
  const onChange = vi.fn();
  const props = { annotations: [...items, item("violet evidence", "highlight", "purple")], onChange };
  const mounted = renderWithPdfAnnotations(<PdfAnnotationFilters {...props} value={{ kind: "all", color: "purple" }} />);
  expect(screen.queryByRole("combobox", { name: "筛选批注颜色" })).not.toBeInTheDocument();
  const group = screen.getByRole("group", { name: "按批注颜色筛选" });
  expect(within(group).getAllByRole("button")).toHaveLength(3);
  expect(within(group).getByRole("button", { name: "筛选蓝色批注" })).toHaveTextContent("2");
  const purple = within(group).getByRole("button", { name: "筛选紫色批注" });
  expect(purple).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(purple);
  expect(onChange).toHaveBeenCalledWith({ kind: "all", color: "all" });
  mounted.rerender(<PdfAnnotationFilters {...props} annotations={items} value={{ kind: "all", color: "purple" }} />);
  expect(screen.getByRole("button", { name: "筛选紫色批注" })).toHaveTextContent("0");
});

test("every selectable color survives annotation persistence and matches the filter", () => {
  const colored = pdfHighlightColors.map((color) => item(color, "highlight", color));
  savePdfAnnotations(pdfAnnotationStorageKey(paper), colored);
  const restored = loadPdfAnnotations(pdfAnnotationStorageKey(paper));
  expect(restored.map(({ color }) => color)).toEqual([...pdfHighlightColors]);
  for (const color of pdfHighlightColors) {
    expect(restored.filter((annotation) => matchesPdfAnnotationFacets(annotation, { kind: "all", color }))).toHaveLength(1);
  }
});
