import type { RetrievalChunk } from "./retrieval.types";
import type { Paper } from "../workspace/workspace.types";
import type { AnswerPayload } from "./retrieval.types";
import { retrieveAnswer } from "./localRetriever";

export function getMockAnswer(
  selectedPapers: Paper[] = [],
  importedChunksByPaperId: Record<string, RetrievalChunk[]> = {},
  question = "总结这篇论文的核心方法"
): AnswerPayload {
  const primaryPaper = selectedPapers[0];

  if (primaryPaper) {
    return retrieveAnswer({
      importedChunksByPaperId,
      question,
      selectedPapers
    });
  }

  return {
    answer: "当前示例回答基于本地文献片段整理，后续会接入真实检索链路。",
    citations: [
      {
        paperId: "demo-1",
        page: 3,
        snippet: "self-attention replaces recurrence"
      }
    ],
    confidence: 0.84
  };
}
