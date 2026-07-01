import type { Paper } from "../workspace/workspace.types";
import type { AnswerPayload, RetrievalChunk } from "./retrieval.types";

type RetrievalRequest = {
  importedChunksByPaperId?: Record<string, RetrievalChunk[]>;
  question: string;
  selectedPapers: Paper[];
};

const fixtureKnowledgeBase: Record<string, RetrievalChunk[]> = {
  "demo-1": [
    {
      paperId: "demo-1",
      paperTitle: "Attention Is All You Need",
      page: 3,
      snippet: "self-attention replaces recurrence and convolutions entirely",
      summary: "核心方法是用自注意力替代循环结构，以并行方式建模序列关系。",
      tags: ["核心方法", "方法", "自注意力", "attention", "transformer", "并行"]
    },
    {
      paperId: "demo-1",
      paperTitle: "Attention Is All You Need",
      page: 5,
      snippet: "multi-head attention allows the model to jointly attend to information",
      summary: "多头注意力让模型可以同时从多个子空间抽取关系特征。",
      tags: ["多头注意力", "结构", "attention head", "模型结构"]
    }
  ],
  "demo-2": [
    {
      paperId: "demo-2",
      paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
      page: 7,
      snippet:
        "deep bidirectional representations are pre-trained by jointly conditioning on left and right context",
      summary: "核心方法是先做深度双向预训练，再把表示迁移到下游语言理解任务。",
      tags: ["核心方法", "方法", "双向预训练", "bert", "bidirectional", "pre-training"]
    },
    {
      paperId: "demo-2",
      paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
      page: 8,
      snippet: "masked language model and next sentence prediction are used for pre-training",
      summary: "预训练目标主要包括掩码语言模型和下一句预测。",
      tags: ["掩码语言模型", "下一句预测", "预训练目标", "masked language model"]
    }
  ]
};

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
        page: 3,
        snippet: "self-attention replaces recurrence"
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
