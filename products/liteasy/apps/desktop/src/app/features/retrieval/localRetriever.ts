import type { Paper } from "../workspace/workspace.types";
import type { AnswerPayload, RetrievalChunk } from "./retrieval.types";

type RetrievalRequest = {
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  question: string;
  selectedPapers: Paper[];
};

function scoreChunk(question: string, chunk: RetrievalChunk) {
  const normalizedQuestion = question.toLowerCase();

  return chunk.tags.reduce((score, tag) => {
    return normalizedQuestion.includes(tag.toLowerCase()) ? score + 2 : score;
  }, chunk.paperTitle.toLowerCase().includes(normalizedQuestion) ? 1 : 0);
}

export function retrieveAnswer(request: RetrievalRequest): AnswerPayload {
  const candidateChunks = request.selectedPapers.flatMap((paper) => {
    const importedChunks = request.importedChunksByPaperId?.[paper.id];
    return importedChunks ?? [];
  });

  if (candidateChunks.length === 0) {
    throw new Error("选中文献没有可检索的真实文本索引。");
  }

  const scoredChunks = candidateChunks
    .map((chunk) => ({
      chunk,
      score: scoreChunk(request.question, chunk)
    }))
    .sort((left, right) => right.score - left.score);

  const bestChunk = scoredChunks[0]?.chunk ?? candidateChunks[0];

  return {
    answer: `根据《${bestChunk.paperTitle}》的相关片段，${bestChunk.summary}`,
    citations: [
      {
        page: bestChunk.page,
        paperId: bestChunk.paperId,
        snippet: bestChunk.snippet
      }
    ],
    confidence: Math.min(0.95, 0.65 + Math.max(0, scoredChunks[0]?.score ?? 0) * 0.05)
  };
}
