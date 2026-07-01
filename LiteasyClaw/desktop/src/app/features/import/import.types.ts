import type { RetrievalChunk } from "../retrieval/retrieval.types";

export type ImportJobStatus = "queued" | "parsing" | "parsed" | "failed";

export type ImportJob = {
  id: string;
  documentId: string;
  sourcePath: string;
  status: ImportJobStatus;
  paperId?: string;
  parsedChunks?: RetrievalChunk[];
};
