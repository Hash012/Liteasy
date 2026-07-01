import type { Paper } from "../workspace/workspace.types";
import type { AnswerPayload, RetrievalChunk } from "./retrieval.types";
import { demoKnowledgeBase } from "./demoKnowledgeBase";

type RetrievalRequest = {
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  question: string;
  selectedPapers: Paper[];
};

const fixtureKnowledgeBase: Record<string, RetrievalChunk[]> = demoKnowledgeBase;

function scoreChunk(question: string, chunk: RetrievalChunk) {
  const normalizedQuestion = question.toLowerCase();

  return chunk.tags.reduce((score, tag) => {
    return normalizedQuestion.includes(tag.toLowerCase()) ? score + 2 : score;
  }, chunk.paperTitle.toLowerCase().includes(normalizedQuestion) ? 1 : 0);
}

function getFallbackAnswer(): AnswerPayload {
  return {
    answer: "当前示例回答基于本地文献片段整理，后续会接入真实检索链路。",
    citations: [
      {
        paperId: "demo-1",
        page: 2,
        snippet: "late interaction independently encodes query and document tokens"
      }
    ],
    confidence: 0.84
  };
}

export function retrieveAnswer(request: RetrievalRequest): AnswerPayload {
  const candidateChunks = request.selectedPapers.flatMap((paper) => {
    const importedChunks = request.importedChunksByPaperId?.[paper.id];
    return importedChunks?.length ? importedChunks : (fixtureKnowledgeBase[paper.id] ?? []);
  });

  if (candidateChunks.length === 0) {
    return getFallbackAnswer();
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
    confidence: bestChunk.paperId === "demo-2" ? 0.86 : 0.85
  };
}
