import type { PdfAnnotationRect } from "@liteasy/reading-core/pdfAnnotations";
import type { PdfInkPoint } from "@liteasy/reading-core/pdfInk";
export function pagePoint(clientX: number, clientY: number, bounds: Pick<DOMRect, "left" | "top" | "width" | "height">): PdfInkPoint {
  return { x: Math.max(0, Math.min(100, (clientX - bounds.left) / bounds.width * 100)),
    y: Math.max(0, Math.min(100, (clientY - bounds.top) / bounds.height * 100)) };
}
export function selectedPageText(page: HTMLElement): { excerpt: string; rects: PdfAnnotationRect[] } | undefined {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0);
  if (!page.querySelector(".textLayer")?.contains(range.commonAncestorContainer)) return;
  const bounds = page.getBoundingClientRect();
  const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => {
    const start = pagePoint(rect.left, rect.top, bounds), end = pagePoint(rect.right, rect.bottom, bounds);
    return { left: start.x, top: start.y, width: end.x - start.x, height: end.y - start.y };
  }).filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) return;
  return { excerpt: selection.toString().trim(), rects };
}
