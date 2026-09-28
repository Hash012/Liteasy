export const MAX_PDF_CANVAS_PIXELS = 16 * 1024 * 1024;
export const MAX_PDF_RENDERED_PAGES = 6;

/** Preserve native pixels at ordinary zoom; bound extreme zoom and unusual page sizes. */
export function pdfCanvasSize(width: number, height: number, deviceRatio: number) {
  const ratio = Math.min(Math.max(1, deviceRatio), Math.sqrt(MAX_PDF_CANVAS_PIXELS / (width * height)), 8192 / Math.max(width, height));
  const round = ratio < Math.max(1, deviceRatio) ? Math.floor : Math.ceil;
  return { width: Math.max(1, round(width * ratio)), height: Math.max(1, round(height * ratio)), ratio };
}

export function pdfPagesInViewport(pages: { page: number; top: number; bottom: number }[], top: number, bottom: number) {
  const margin = (bottom - top) / 2;
  const center = (top + bottom) / 2;
  return pages.filter((page) => page.bottom >= top - margin && page.top <= bottom + margin)
    .sort((a, b) => Number(b.bottom > top && b.top < bottom) - Number(a.bottom > top && a.top < bottom)
      || Math.abs((a.top + a.bottom) / 2 - center) - Math.abs((b.top + b.bottom) / 2 - center))
    .slice(0, MAX_PDF_RENDERED_PAGES).map((page) => page.page);
}
