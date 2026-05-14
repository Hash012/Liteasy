export type Citation = {
  paperId: string;
  page: number;
  snippet: string;
};

export type PaperChunk = {
  paperId: string;
  page: number;
  sectionTitle: string;
  text: string;
};

export type AnswerPayload = {
  answer: string;
  citations: Citation[];
  confidence: number;
};
