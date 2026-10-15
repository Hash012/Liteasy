import type { PDFPageProxy } from "pdfjs-dist";
import { loadPdfGlyphGeometry, releasePdfGlyphGeometry, type PdfGlyphGeometry } from "./pdfGlyphGeometry";

type PageData = { text?: ReturnType<PDFPageProxy["getTextContent"]>; glyphs?: Promise<PdfGlyphGeometry[]> };
const documents = new WeakMap<object, Map<number, PageData>>();
export const PDF_PAGE_DATA_CACHE_SIZE = 8;

function entry(document: object, page: number) {
  let pages = documents.get(document);
  if (!pages) { pages = new Map(); documents.set(document, pages); }
  const value = pages.get(page) ?? {};
  pages.delete(page); pages.set(page, value);
  while (pages.size > PDF_PAGE_DATA_CACHE_SIZE) pages.delete(pages.keys().next().value!);
  return value;
}

/** Only decoded text/normalized geometry survive repainting; no canvas or page proxy is retained. */
export function loadPdfPageText(document: object, pageNumber: number, page: PDFPageProxy) {
  const data = entry(document, pageNumber);
  if (!data.text) {
    const request = page.getTextContent(); data.text = request;
    void request.catch(() => { if (data.text === request) data.text = undefined; });
  }
  return data.text;
}

export function loadPdfPageGlyphs(document: object, pageNumber: number, page: PDFPageProxy) {
  const data = entry(document, pageNumber);
  if (!data.glyphs) {
    const request = loadPdfGlyphGeometry(page).finally(() => releasePdfGlyphGeometry(page)); data.glyphs = request;
    void request.catch(() => { if (data.glyphs === request) data.glyphs = undefined; });
  }
  return data.glyphs;
}

export function clearPdfPageData(document: object) { documents.delete(document); }
