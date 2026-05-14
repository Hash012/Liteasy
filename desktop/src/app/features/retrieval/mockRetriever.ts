import type { PaperChunk, AnswerPayload } from "./retrieval.types";

const fixtureChunks: PaperChunk[] = [
  {
    paperId: "paper-attention",
    page: 2,
    sectionTitle: "Background",
    text: "Self-attention, sometimes called intra-attention, is an attention mechanism relating different positions of a single sequence in order to compute a representation of the sequence.",
  },
  {
    paperId: "paper-attention",
    page: 3,
    sectionTitle: "Model Architecture",
    text: "The Transformer follows an encoder-decoder structure using stacked self-attention and point-wise, fully connected layers for both the encoder and decoder.",
  },
  {
    paperId: "paper-attention",
    page: 5,
    sectionTitle: "Why Self-Attention",
    text: "Self-attention layers are faster than recurrent layers when the sequence length n is smaller than the representation dimensionality d.",
  },
  {
    paperId: "paper-bert",
    page: 2,
    sectionTitle: "Introduction",
    text: "BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers.",
  },
  {
    paperId: "paper-bert",
    page: 3,
    sectionTitle: "BERT Architecture",
    text: "BERT's model architecture is a multi-layer bidirectional Transformer encoder based on the original implementation described in Vaswani et al.",
  },
  {
    paperId: "paper-bert",
    page: 4,
    sectionTitle: "Pre-training Tasks",
    text: "BERT pre-trains using two unsupervised tasks: Masked Language Model (MLM) and Next Sentence Prediction (NSP).",
  },
];

const fixtureAnswers: Record<string, AnswerPayload> = {
  attention: {
    answer:
      "自注意力机制（Self-Attention）是 Transformer 模型的核心组件。它通过计算序列中不同位置之间的关系来生成序列的表征，相比 RNN 具有更好的并行性和对长距离依赖的捕捉能力。在 Transformer 中，自注意力层配合全连接层构成编码器和解码器的基本单元。",
    citations: [
      { paperId: "paper-attention", page: 2, snippet: "Self-attention is an attention mechanism relating different positions of a single sequence" },
      { paperId: "paper-attention", page: 3, snippet: "The Transformer follows an encoder-decoder structure using stacked self-attention" },
    ],
    confidence: 0.87,
  },
  transformer: {
    answer:
      "Transformer 是一种基于自注意力机制的序列到序列模型架构，完全摒弃了循环和卷积结构。它采用编码器-解码器结构，编码器由多层自注意力层和前馈网络组成，解码器额外增加了编码器-解码器注意力子层。Transformer 在机器翻译等任务上显著优于以往的 RNN/CNN 模型。",
    citations: [
      { paperId: "paper-attention", page: 3, snippet: "The Transformer follows an encoder-decoder structure" },
      { paperId: "paper-attention", page: 5, snippet: "Self-attention layers are faster than recurrent layers" },
    ],
    confidence: 0.91,
  },
  bert: {
    answer:
      "BERT（Bidirectional Encoder Representations from Transformers）是一种基于 Transformer 编码器的预训练语言模型。其核心创新在于使用 Masked Language Model 和 Next Sentence Prediction 两个无监督任务进行预训练，从而获得深度的双向语言表示。BERT 在 11 项 NLP 任务上取得了当时的最佳结果。",
    citations: [
      { paperId: "paper-bert", page: 2, snippet: "BERT is designed to pre-train deep bidirectional representations" },
      { paperId: "paper-bert", page: 4, snippet: "BERT pre-trains using two unsupervised tasks: MLM and NSP" },
    ],
    confidence: 0.89,
  },
  pretrain: {
    answer:
      "BERT 的预训练包含两个任务：Masked Language Model (MLM) 随机遮蔽输入中的部分 token 让模型预测，从而学习双向上下文信息；Next Sentence Prediction (NSP) 判断两个句子是否连续，帮助理解句子间关系。这种预训练方式使得 BERT 可以通过微调适应各种下游任务。",
    citations: [
      { paperId: "paper-bert", page: 4, snippet: "BERT pre-trains using two unsupervised tasks" },
      { paperId: "paper-bert", page: 3, snippet: "BERT's model architecture is a multi-layer bidirectional Transformer encoder" },
    ],
    confidence: 0.84,
  },
};

export function mockRetrieve(query: string): PaperChunk[] {
  const lower = query.toLowerCase();
  const matched = new Set<string>();
  const chunks: PaperChunk[] = [];

  for (const chunk of fixtureChunks) {
    if (matched.has(chunk.paperId)) continue;
    if (
      lower.includes("attention") && chunk.paperId === "paper-attention" ||
      lower.includes("bert") && chunk.paperId === "paper-bert" ||
      lower.includes("pretrain") && chunk.paperId === "paper-bert" ||
      lower.includes("预训练") && chunk.paperId === "paper-bert" ||
      lower.includes("transformer") && chunk.paperId === "paper-attention" ||
      lower.includes("self-attention") && chunk.paperId === "paper-attention" ||
      lower.includes("自注意力") && chunk.paperId === "paper-attention"
    ) {
      matched.add(chunk.paperId);
      chunks.push(chunk);
    }
  }

  // fallback: return all chunks if nothing matched
  return chunks.length > 0 ? chunks : fixtureChunks.slice(0, 2);
}

export function mockAnswer(query: string): AnswerPayload {
  const lower = query.toLowerCase();
  for (const [key, answer] of Object.entries(fixtureAnswers)) {
    if (lower.includes(key)) return answer;
  }
  // fallback generic answer
  return {
    answer: `关于"${query}"的问题，这是一个很好的研究方向。当前工作区中的论文涵盖了相关的深度学习与自然语言处理领域的前沿工作。你可以进一步锁定具体的论文段落以获得更精准的分析。`,
    citations: [],
    confidence: 0.45,
  };
}
