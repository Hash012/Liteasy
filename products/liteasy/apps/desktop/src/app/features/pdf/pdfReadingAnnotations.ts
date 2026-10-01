import type { ReactNode } from "react";
import type { PdfAnnotationV2, PdfHighlightColor } from "./pdfAnnotationStorage";
import { buildPdfSelectionRange, type PageCharModel } from "./pdfSelectionEngine";
import { compactPdfTextForSearch } from "./pdfTextSearch";
import type { SelectionLookupPort } from "../selection-lookup/selectionLookup.types";

export type ReadingMarkStyle = { kind?: "highlight" | "underline" | "note"; color?: PdfHighlightColor };

/** Both reader views operate on the PDF reader's live annotations, never a second store. */
export type PdfReadingAnnotations = {
  scopeKey: string;
  lookup?: SelectionLookupPort;
  paperId?: string;
  paperTitle?: string;
  ready: boolean;
  error?: string;
  annotations: readonly PdfAnnotationV2[];
  pageTexts: Record<number, string>;
  pageCount: number;
  focusedPage: number;
  selectedId?: string;
  guideControls?: ReactNode;
  extensionActions?(input: { page: number; excerpt: string }): ReactNode;
  create(input: { page: number; excerpt: string; note: string } & ReadingMarkStyle): Promise<void>;
  update(id: string, revision: number, note: string, style?: ReadingMarkStyle): Promise<void>;
  remove(id: string): Promise<void>;
  openPdf(id: string): void;
  capture?: (input: { page: number; excerpt: string }, target: "board" | "tray" | "conversation") => Promise<void>;
  quickAsk?: (input: { page: number; excerpt: string; question: string; systemPrompt?: string }, signal: AbortSignal) => Promise<void>;
  annotationTools?: (annotation: PdfAnnotationV2) => ReactNode;

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
