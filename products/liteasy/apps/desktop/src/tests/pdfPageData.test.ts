import { beforeEach, expect, test, vi } from "vitest";
import type { PDFPageProxy } from "pdfjs-dist";
import { clearPdfPageData, loadPdfPageGlyphs, loadPdfPageText, PDF_PAGE_DATA_CACHE_SIZE } from "../app/features/pdf/pdfPageData";
import { loadPdfGlyphGeometry } from "../app/features/pdf/pdfGlyphGeometry";
vi.mock("../app/features/pdf/pdfGlyphGeometry", () => ({ loadPdfGlyphGeometry: vi.fn(async () => []), releasePdfGlyphGeometry: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
const page = () => ({ getTextContent: vi.fn(async () => ({ items: [], styles: {} })) }) as unknown as PDFPageProxy;

test("repaints share pending and completed page text and glyph extraction", async () => {
  const document = {}, source = page();
  await Promise.all(Array.from({ length: 10 }, () => Promise.all([loadPdfPageText(document, 1, source), loadPdfPageGlyphs(document, 1, source)])));
  await loadPdfPageText(document, 1, source); await loadPdfPageGlyphs(document, 1, source);
  expect(source.getTextContent).toHaveBeenCalledOnce(); expect(loadPdfGlyphGeometry).toHaveBeenCalledOnce();
  clearPdfPageData(document); await loadPdfPageText(document, 1, source);
  expect(source.getTextContent).toHaveBeenCalledTimes(2);
});

test("evicts distant pages, keeps recent pages, and isolates documents", async () => {
  const document = {}, source = page();
  for (let number = 1; number <= PDF_PAGE_DATA_CACHE_SIZE; number++) await loadPdfPageText(document, number, source);
  await loadPdfPageText(document, 1, source);
  await loadPdfPageText(document, PDF_PAGE_DATA_CACHE_SIZE + 1, source);
  await loadPdfPageText(document, 1, source);
  expect(source.getTextContent).toHaveBeenCalledTimes(PDF_PAGE_DATA_CACHE_SIZE + 1);
  await loadPdfPageText(document, 2, source);
  await loadPdfPageText({}, 1, source);
  expect(source.getTextContent).toHaveBeenCalledTimes(PDF_PAGE_DATA_CACHE_SIZE + 3);
});

test("a failed text extraction is retried without poisoning the cache", async () => {
  const document = {}, source = page();
  vi.mocked(source.getTextContent).mockRejectedValueOnce(new Error("temporary failure"));
  await expect(loadPdfPageText(document, 1, source)).rejects.toThrow("temporary failure");
  await expect(loadPdfPageText(document, 1, source)).resolves.toMatchObject({ items: [] });
});
