import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";
import { extractPdfChunksForPaper, type PdfExtractionOptions } from "./pdfTextExtractor";

export async function extractImportedChunksForPaper(
  paper: Paper,
  options: PdfExtractionOptions = {}
): Promise<RetrievalChunk[]> {
  return extractPdfChunksForPaper(paper, options);
}
