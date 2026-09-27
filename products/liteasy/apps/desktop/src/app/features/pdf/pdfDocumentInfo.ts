/** Metadata already known by the open reader; consumers must not reload the PDF. */
export interface PdfDocumentInfo {
  paperId: string;
  sourcePath?: string;
  pageCount: number;
  size?: number;
}
