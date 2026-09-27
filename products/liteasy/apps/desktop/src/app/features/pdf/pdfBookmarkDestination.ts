import type { PDFDocumentProxy } from "pdfjs-dist";

export type PdfOutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number];
export type PdfBookmarkTarget = { page: number; topRatio?: number };

/** Resolve only the clicked destination; do not fetch every page to show a TOC. */
export async function resolvePdfBookmark(document: PDFDocumentProxy, destination: PdfOutlineItem["dest"]): Promise<PdfBookmarkTarget> {
  const dest: unknown = typeof destination === "string" ? await document.getDestination(destination) : destination;
  if (!Array.isArray(dest) || !dest.length) throw new Error("此书签没有可用的文档内位置。");
  const ref: unknown = dest[0];
  const index = typeof ref === "number" ? ref
    : ref && typeof ref === "object" && "num" in ref && "gen" in ref && Number.isInteger(ref.num) && Number.isInteger(ref.gen)
      ? await document.getPageIndex(ref as { num: number; gen: number }) : NaN;
  if (!Number.isInteger(index) || index < 0 || index >= document.numPages) throw new Error("书签指向的页面不存在。");
  const page = index + 1;
  const kind = dest[1]?.name;
  const top = kind === "XYZ" ? dest[3] : kind === "FitH" || kind === "FitBH" ? dest[2] : kind === "FitR" ? dest[5] : undefined;
  if (typeof top !== "number" || !Number.isFinite(top)) return { page };
  const pdfPage = await document.getPage(page);
  const viewport = pdfPage.getViewport({ scale: 1 });
  const x = kind === "XYZ" && Number.isFinite(dest[2]) ? dest[2] : pdfPage.view[0];
  const [, y] = viewport.convertToViewportPoint(x, top);
  return { page, topRatio: Math.max(0, Math.min(1, y / viewport.height)) };
}
