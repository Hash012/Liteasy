import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// The legacy distribution supplies polyfills for Android WebViews behind desktop Chrome.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export function loadPdf(bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes,
    cMapUrl: "/pdf-assets/cmaps/", cMapPacked: true,
    standardFontDataUrl: "/pdf-assets/standard_fonts/", wasmUrl: "/pdf-assets/wasm/",
    iccUrl: "/pdf-assets/iccs/", enableXfa: false });
}

export function canvasOutput(width: number, height: number, pixelRatio: number) {
  // One visible page, capped at 4M pixels (~16 MiB), regardless of screen density or zoom.
  const ratio = Math.min(pixelRatio, 2, Math.sqrt(4_000_000 / (width * height)), 4096 / Math.max(width, height));
  return { ratio, width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}

export type SearchMatch = { page: number; excerpt: string; offset: number };
export async function searchPdf(document: pdfjs.PDFDocumentProxy, query: string, signal: AbortSignal,
  onProgress: (page: number) => void): Promise<SearchMatch[]> {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const matches: SearchMatch[] = [];
  for (let index = 1; index <= document.numPages; index++) {
    if (signal.aborted) return [];
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    if (signal.aborted) return [];
    const text = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("");
    const lower = text.toLocaleLowerCase();
    for (let offset = lower.indexOf(needle); offset >= 0; offset = lower.indexOf(needle, offset + needle.length)) {
      matches.push({ page: index, offset, excerpt: text.slice(Math.max(0, offset - 30), offset + needle.length + 70) });
      if (matches.length === 100) return matches;
    }
    // Page cleanup is owned by the renderer; do not race its active operator list.
    onProgress(index);
    if (index % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return matches;
}
