import type { PDFDocumentProxy } from "pdfjs-dist";
export type OutlineEntry = { title: string; page: number; depth: number };
export type PdfReaderState = {
  document?: PDFDocumentProxy; outline: OutlineEntry[]; page: number; navigate: (page: number) => void;
  zoom: number; setZoom: (zoom: number) => void; error: string; passwordRequired: boolean; unlock: (password: string) => void;
};
