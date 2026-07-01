import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";

export function buildImportedChunksForPaper(paper: Paper): RetrievalChunk[] {
  if (paper.id === "demo-2") {
    return [
      {
        page: 7,
        paperId: paper.id,
        paperTitle: paper.title,
        snippet:
          "deep bidirectional representations are pre-trained by jointly conditioning on left and right context",
        summary: "核心方法是先做深度双向预训练，再把表示迁移到下游语言理解任务。",
        tags: ["核心方法", "方法", "双向预训练", "bert", "bidirectional", "pre-training"]
      },
      {
        page: 8,
        paperId: paper.id,
        paperTitle: paper.title,
        snippet: "masked language model and next sentence prediction are used for pre-training",
        summary: "预训练目标主要包括掩码语言模型和下一句预测。",
        tags: ["掩码语言模型", "下一句预测", "预训练目标", "masked language model"]
      }
    ];
  }

  return [
    {
      page: 3,
      paperId: paper.id,
      paperTitle: paper.title,
      snippet: "self-attention replaces recurrence and convolutions entirely",
      summary: "核心方法是用自注意力替代循环结构，以并行方式建模序列关系。",
      tags: ["核心方法", "方法", "自注意力", "attention", "transformer", "并行"]
    },
    {
      page: 5,
      paperId: paper.id,
      paperTitle: paper.title,
      snippet: "multi-head attention allows the model to jointly attend to information",
      summary: "多头注意力让模型可以同时从多个子空间抽取关系特征。",
      tags: ["多头注意力", "结构", "attention head", "模型结构"]
    }
  ];
}
