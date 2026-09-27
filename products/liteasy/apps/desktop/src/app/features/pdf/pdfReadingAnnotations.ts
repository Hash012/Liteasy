import type { PdfAnnotationV2 } from "./pdfAnnotationStorage";
import { buildPdfSelectionRange, type PageCharModel } from "./pdfSelectionEngine";
import { compactPdfTextForSearch } from "./pdfTextSearch";

/** Both reader views operate on the PDF reader's live annotations, never a second store. */
export type PdfReadingAnnotations = {
  scopeKey: string;
  ready: boolean;
  error?: string;
  annotations: readonly PdfAnnotationV2[];
  pageTexts: Record<number, string>;
  pageCount: number;
  focusedPage: number;
  selectedId?: string;
  create(input: { page: number; excerpt: string; note: string }): Promise<void>;
  update(id: string, revision: number, note: string): Promise<void>;
  remove(id: string): Promise<void>;
  openPdf(id: string): void;
};

/** Only one exact folded match may become a geometric PDF mark. */
export function readingQuoteRects(model: PageCharModel | undefined, quote: string) {
  const needle = compactPdfTextForSearch(quote);
  if (!model || !needle) return [];
  let text = "";
  const offsets: number[] = [];
  model.chars.forEach((char, index) => {
    const value = char.ignorable ? "" : compactPdfTextForSearch(char.u ?? char.c);
    text += value;
    for (let offset = 0; offset < value.length; offset += 1) offsets.push(index);
  });
  const start = text.indexOf(needle);
  if (start < 0 || text.indexOf(needle, start + 1) >= 0) return [];
  return buildPdfSelectionRange(model, { pageIndex: model.pageIndex,
    anchorOffset: offsets[start], headOffset: offsets[start + needle.length - 1] + 1 }).rects;
}
