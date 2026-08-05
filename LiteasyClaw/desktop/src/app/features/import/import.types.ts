import type { RetrievalChunk } from "../retrieval/retrieval.types";

export type MineruFigureAnalysis = {
  description: string;
  importance: "primary" | "supporting" | "reference";
  kind: "architecture" | "chart" | "comparison" | "example" | "formula" | "result" | "table" | "workflow" | "other";
  placement: "overview" | "evidence" | "method" | "results";
  selectionReason: string;
  title: string;
};

export type ImportJobStatus = "queued" | "parsing" | "parsed" | "failed";

export type MineruFigure = {
  analysis?: MineruFigureAnalysis;
  alt: string;
  dataUrl: string;
  id: string;
  page: number;
  sourcePath: string;
};

export type ImportJob = {
  id: string;
  documentId: string;
  sourcePath: string;
  status: ImportJobStatus;
  paperId?: string;
  parsedChunks?: RetrievalChunk[];
  mineruFigures?: MineruFigure[];
};
