import { buildDemoChunksForPaper } from "../retrieval/demoKnowledgeBase";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";
import { extractPdfChunksForPaper, type PdfExtractionOptions } from "./pdfTextExtractor";

export function buildImportedChunksForPaper(paper: Paper): RetrievalChunk[] {
  return buildDemoChunksForPaper(paper);
}

export async function extractImportedChunksForPaper(
  paper: Paper,
  options: PdfExtractionOptions = {}
): Promise<RetrievalChunk[]> {
  try {
    return await extractPdfChunksForPaper(paper, options);
  } catch (error) {
    if (["demo-1", "demo-2", "demo-3"].includes(paper.id)) {
      return buildImportedChunksForPaper(paper);
    }
    throw error;
  }
}
