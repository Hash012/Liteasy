import { TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { buildPageCharModelFromTextLayer } from "./pdfSelectionEngine";
import { loadPdfGlyphGeometry, releasePdfGlyphGeometry } from "./pdfGlyphGeometry";
import { readingQuoteRects } from "./pdfReadingAnnotations";

/** Resolve one selected quote without resurrecting every PDF canvas behind reading mode. */
export async function resolveReadingQuoteRects(pdf: PDFDocumentProxy, number: number, quote: string) {
  const page = await pdf.getPage(number);
  const viewport = page.getViewport({ scale: 1 });
  const container = document.createElement("div");
  container.className = "pdf-text-layer";
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, { position: "fixed", left: "-100000px", top: "0", width: `${viewport.width}px`, height: `${viewport.height}px`, pointerEvents: "none" });
  container.style.setProperty("--total-scale-factor", "1");
  document.body.appendChild(container);
  let layer: TextLayer | undefined;
  try {
    const text = await page.getTextContent();
    const glyphs = await loadPdfGlyphGeometry(page);
    layer = new TextLayer({ container, textContentSource: text, viewport });
    await layer.render();
    const model = buildPageCharModelFromTextLayer({ glyphs, pageElement: container, pageIndex: number, textLayer: container });
    return readingQuoteRects(model, quote);
  } finally {
    layer?.cancel(); container.remove(); releasePdfGlyphGeometry(page); page.cleanup();
  }
}
