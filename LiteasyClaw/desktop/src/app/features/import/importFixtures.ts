import { buildDemoChunksForPaper } from "../retrieval/demoKnowledgeBase";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";

export function buildImportedChunksForPaper(paper: Paper): RetrievalChunk[] {
  return buildDemoChunksForPaper(paper);
}
