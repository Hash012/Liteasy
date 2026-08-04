export type Citation = {
  paperId: string;
  page: number;
  snippet: string;
};

export type RetrievalChunk = {
  pageTextEnd?: number;
  pageTextStart?: number;
  sourceMarkdown?: string;
  textExtraction?: "embedded" | "mineru" | "ocr";
  paperId: string;
  paperTitle: string;
  page: number;
  snippet: string;
  summary: string;
  tags: string[];
};

export type AnswerPayload = {
  answer: string;
  citations: Citation[];
  confidence: number;
};
