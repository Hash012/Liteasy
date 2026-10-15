import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { PdfReader } from "../app/features/pdf/PdfReader";
import { PdfAnnotationsOverview } from "../app/features/pdf/PdfAnnotationsOverview";
import { compilePdfAnnotationQuery } from "../app/features/pdf/pdfAnnotationQuery";
import { pdfAnnotationStorageKey, savePdfAnnotations, type PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { TeamAnnotation } from "../app/features/organization/teamAnnotationClient";

const paper = { id: "annotation-query", title: "Search annotations", sourcePath: "/papers/query.pdf" };
const identity = resolvePaperIdentity(paper);
function annotation(id: string, page = 1): PdfAnnotationV2 {
  return { id, page, paperIdentity: identity, excerpt: `Passage ${id}`, text: "高亮", kind: "highlight", rects: [],
    createdAt: "2026-10-01", updatedAt: "2026-10-01", revision: 1, publication: { desiredVisibility: "private", state: "not_published" } };
}
function team(): TeamAnnotation {
  return { annotationId: "team", body: { ...annotation("shared", 12), clientAnnotationId: "shared" },
    createdAt: "2026-10-01", updatedAt: "2026-10-01", revision: 1, uploadedBy: "陈老师", documentId: "doc", organizationId: "org" };
}
afterEach(() => { cleanup(); localStorage.clear(); });

test("annotation query searches questions, answers, reviews, pages, authors and existing metadata facets", () => {
  const item = { ...annotation("first", 12), quickAsk: { question: "retrieval question", answer: "graph answer", pageText: "", abstractText: "" },
    review: { text: "review evidence", generatedAt: "2026-10-01", updatedAt: "2026-10-01", sourceRevision: 1 } };
  for (const query of ["retrieval", "graph", "evidence", "12", "陈老师", "format:pdf"]) {
    expect(compilePdfAnnotationQuery(query).matches(item, "陈老师")).toBe(true);
  }
  expect(compilePdfAnnotationQuery('tag:"AI 生成"').matches(item)).toBe(true);
  expect(compilePdfAnnotationQuery("absent").matches(item)).toBe(false);
});

test("sidebar searches local and team entries and overview starts from the complete collection", async () => {
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [annotation("local", 3), annotation("other", 8)]);
  render(<PdfReader selectedPapers={[paper]} zoom={100} loadOrganizationAnnotations={async () => [team()]} />);
  await screen.findByText("陈老师 · 第 12 页");
  const search = screen.getByRole("textbox", { name: "搜索批注内容" });
  fireEvent.change(search, { target: { value: "陈老师" } });
  expect(screen.queryByRole("button", { name: "编辑批注：Passage local" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "团队批注" })).getByText("Passage shared")).toBeInTheDocument();
  expect(screen.getByLabelText("批注检索结果")).toHaveTextContent("1 / 3 条批注");
  fireEvent.change(search, { target: { value: "3" } });
  expect(screen.getByRole("button", { name: "编辑批注：Passage local" })).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "团队批注" })).queryByText("Passage shared")).not.toBeInTheDocument();
  fireEvent.doubleClick(screen.getByRole("button", { name: "批注", exact: true }));
  expect(within(screen.getByRole("region", { name: "全部批注" })).getAllByRole("listitem")).toHaveLength(3);
});

test("overview includes quick-ask and review content in its query", () => {
  const item = { ...annotation("review"), review: { text: "独有的审阅证据", generatedAt: "2026-10-01", updatedAt: "2026-10-01", sourceRevision: 1 } };
  render(<PdfAnnotationsOverview annotations={[item, annotation("other")]} teamAnnotations={[]} onNavigate={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "搜索全部批注" }), { target: { value: "审阅证据" } });
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("Passage review")).toBeVisible();
});
