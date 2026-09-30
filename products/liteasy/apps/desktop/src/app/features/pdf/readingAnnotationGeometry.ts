import { TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { buildPageCharModelFromGlyphs, buildPageCharModelFromTextLayer } from "./pdfSelectionEngine";
import { loadPdfGlyphGeometry, releasePdfGlyphGeometry } from "./pdfGlyphGeometry";
import { readingQuoteRects } from "./pdfReadingAnnotations";

/** Resolve a complete quote without creating page canvases or depending on visible-page fonts. */
export async function resolveReadingQuoteRects(pdf: PDFDocumentProxy, number: number, quote: string) {
  const page = await pdf.getPage(number);
  let container: HTMLDivElement | undefined;
  let layer: TextLayer | undefined;
  try {
    const glyphs = await loadPdfGlyphGeometry(page);
    // Offscreen TextLayer measurements vary with font loading/substitution in WebView.
    // Match all of the quote against painted PDF glyphs before accepting any rectangles.
    const native = readingQuoteRects(buildPageCharModelFromGlyphs(glyphs, number), quote);
    if (native.length) return native;
    // Unsupported fonts (for example Type3) retain the existing exact text-layer fallback.
    const viewport = page.getViewport({ scale: 1 });
    container = document.createElement("div");
    container.className = "pdf-text-layer";
    container.setAttribute("aria-hidden", "true");
    Object.assign(container.style, { position: "fixed", left: "-100000px", top: "0", width: `${viewport.width}px`, height: `${viewport.height}px`, pointerEvents: "none" });
    container.style.setProperty("--total-scale-factor", "1");
    document.body.appendChild(container);
    const text = await page.getTextContent();
    layer = new TextLayer({ container, textContentSource: text, viewport });
    await layer.render();
    const model = buildPageCharModelFromTextLayer({ glyphs, pageElement: container, pageIndex: number, textLayer: container });
    return readingQuoteRects(model, quote);
  } finally {
    layer?.cancel(); container?.remove(); releasePdfGlyphGeometry(page); page.cleanup();
  }
}
