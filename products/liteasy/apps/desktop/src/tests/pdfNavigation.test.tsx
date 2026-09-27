import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { resolvePdfBookmark, type PdfOutlineItem } from "../app/features/pdf/pdfBookmarkDestination";
import { PdfOutline } from "../app/features/pdf/PdfOutline";
import { PdfPagesOverview, thumbnailWindow } from "../app/features/pdf/PdfPagesOverview";
import { PdfAnnotationsOverview } from "../app/features/pdf/PdfAnnotationsOverview";
import { schedulePdfThumbnail } from "../app/features/pdf/pdfThumbnailQueue";
import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import type { PdfAnnotationV2 } from "../app/features/pdf/pdfAnnotationStorage";
import type { TeamAnnotation } from "../app/features/organization/teamAnnotationClient";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function documentMock(overrides: object = {}) {
  return { numPages: 3, getOutline: vi.fn().mockResolvedValue([]), getDestination: vi.fn(),
    getPageIndex: vi.fn().mockResolvedValue(1), getPage: vi.fn().mockResolvedValue({ view: [0, 0, 400, 600],
      getViewport: () => ({ height: 600, convertToViewportPoint: (x: number, y: number) => [x, 600 - y] }) }),
    ...overrides } as unknown as PDFDocumentProxy;
}
function item(title: string, dest: PdfOutlineItem["dest"], items: PdfOutlineItem[] = []) {
  return { title, dest, items, bold: false, italic: false, color: new Uint8ClampedArray([0, 0, 0]), url: null, unsafeUrl: undefined, newWindow: false, count: items.length } as PdfOutlineItem;
}

describe("PDF bookmarks", () => {
  test("resolves named reference destinations and PDF coordinates only on navigation", async () => {
    const doc = documentMock({ getDestination: vi.fn().mockResolvedValue([{ num: 6, gen: 0 }, { name: "XYZ" }, 0, 450, null]) });
    expect(await resolvePdfBookmark(doc, "chapter")).toEqual({ page: 2, topRatio: .25 });
    expect(doc.getDestination).toHaveBeenCalledWith("chapter");
    expect(doc.getPageIndex).toHaveBeenCalledWith({ num: 6, gen: 0 });
    expect(await resolvePdfBookmark(doc, [0, { name: "Fit" }])).toEqual({ page: 1 });
    expect(await resolvePdfBookmark(doc, [2, { name: "XYZ" }, null, null, null])).toEqual({ page: 3 });
    expect(doc.getPage).toHaveBeenCalledTimes(1);
  });
  test("rejects missing, fractional and out-of-document destinations", async () => {
    const doc = documentMock({ getDestination: vi.fn().mockResolvedValue(null) });
    for (const dest of [null, "missing", [-1], [3], [1.2], [{}]]) {
      await expect(resolvePdfBookmark(doc, dest)).rejects.toThrow();
    }
  });
  test("shows nested bookmarks and ignores a slow destination after switching documents", async () => {
    const destination = deferred<unknown>();
    const first = documentMock({ getOutline: vi.fn().mockResolvedValue([item("Chapter", [0], [item("Section", "slow")])]), getDestination: () => destination.promise });
    const onNavigate = vi.fn();
    const { rerender } = render(<PdfOutline document={first} onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Section" }));
    expect(first.getPage).not.toHaveBeenCalled();
    rerender(<PdfOutline document={documentMock()} onNavigate={onNavigate} />);
    await screen.findByText(/此 PDF 没有内置书签/);
    await act(async () => destination.resolve([0, { name: "Fit" }]));
    expect(onNavigate).not.toHaveBeenCalled();
  });
  test("allows retrying outline loading failures", async () => {
    const doc = documentMock({ getOutline: vi.fn().mockRejectedValueOnce(new Error("load")).mockResolvedValue([item("Recovered", [0])]) });
    render(<PdfOutline document={doc} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "重试读取目录" }));
    expect(await screen.findByRole("button", { name: "Recovered" })).toBeVisible();
  });
});

test("thumbnail queue caps concurrent work and cancels queued and active jobs", async () => {
  const doc = {};
  const first = deferred<void>(); const second = deferred<void>();
  let signal: AbortSignal | undefined;
  const cancel = schedulePdfThumbnail(doc, async (value) => { signal = value; await first.promise; });
  schedulePdfThumbnail(doc, () => second.promise);
  const discarded = vi.fn(); const last = vi.fn().mockResolvedValue(undefined);
  const cancelQueued = schedulePdfThumbnail(doc, discarded);
  schedulePdfThumbnail(doc, last);
  await Promise.resolve();
  expect(last).not.toHaveBeenCalled();
  cancelQueued(); cancel();
  expect(signal?.aborted).toBe(true);
  first.resolve();
  await waitFor(() => expect(last).toHaveBeenCalledOnce());
  expect(discarded).not.toHaveBeenCalled();
  second.resolve();
});

test("a ten-thousand-page overview mounts a bounded window and reaches the final page", () => {
  const range = thumbnailWindow(10_000, 800, 600, Number.MAX_SAFE_INTEGER, 160);
  expect(range.end).toBe(10_000);
  expect(range.end - range.first).toBeLessThan(50);
  render(<PdfPagesOverview document={null} count={10_000} currentPage={1} annotations={[]} onNavigate={vi.fn()} onClose={vi.fn()} />);
  const overview = screen.getByRole("region", { name: "全部页面缩略图" });
  expect(within(overview).getAllByRole("button", { name: /转到第/ }).length).toBeLessThan(50);
  const scroller = overview.querySelector(".pdf-pages-scroll")!;
  fireEvent.scroll(scroller, { target: { scrollTop: Number.MAX_SAFE_INTEGER } });
  expect(within(overview).getByRole("button", { name: "转到第 10000 页" })).toBeInTheDocument();
});

const paperIdentity = resolvePaperIdentity({ id: "navigation", title: "Navigation" });
function annotation(kind: PdfAnnotationV2["kind"], page: number): PdfAnnotationV2 {
  return { id: kind, kind, page, paperIdentity, excerpt: `${kind} excerpt`, text: kind, note: `**${kind} note**`,
    createdAt: "2026-09-01", updatedAt: "2026-09-01", rects: [], revision: 1, publication: { desiredVisibility: "private", state: "not_published" } };
}
test("all-annotation view covers each kind, deduplicates team copies, filters, and locates", () => {
  const annotations = (["highlight", "underline", "note", "text", "ink"] as const).map((kind, i) => annotation(kind, i + 1));
  const team = (id: string, clientId: string): TeamAnnotation => ({ annotationId: id, body: { ...annotations[0], clientAnnotationId: clientId },
    createdAt: "2026-09-01", updatedAt: "2026-09-01", documentId: "doc", organizationId: "org", uploadedBy: "reader", revision: 1 });
  const onNavigate = vi.fn();
  render(<PdfAnnotationsOverview annotations={annotations} teamAnnotations={[team("copy", "highlight"), team("shared", "other")]}
    paperIdentity={paperIdentity} onNavigate={onNavigate} onClose={vi.fn()} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(6);
  expect(screen.getByText("text note").tagName).toBe("STRONG");
  fireEvent.change(screen.getByLabelText("筛选批注类型"), { target: { value: "text" } });
  expect(screen.getAllByRole("listitem")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /定位第 4 页文本框/ }));
  expect(onNavigate).toHaveBeenCalledWith(annotations[3]);
  fireEvent.change(screen.getByLabelText("搜索全部批注"), { target: { value: "missing" } });
  expect(screen.getByText("没有匹配的批注。")).toBeVisible();
});
