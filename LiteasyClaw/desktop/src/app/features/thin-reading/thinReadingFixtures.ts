import type { CreateThinReadingDocumentInput } from "./thinReading.types";

export function createThinReadingFixture(): CreateThinReadingDocumentInput {
  return Object.freeze({
    artifactId: "artifact-thin-fixture",
    papers: Object.freeze([
      Object.freeze({ id: "paper-attention", title: "Attention Is All You Need" }),
      Object.freeze({
        id: "paper-bert",
        title: "BERT: Pre-training of Deep Bidirectional Transformers"
      })
    ]),
    rootSeed: Object.freeze({
      evidence: Object.freeze({
        claims: Object.freeze([
          Object.freeze({
            evidenceIds: Object.freeze(["evidence-attention-self-attention"]),
            id: "thin-reading-claim-attention-core",
            status: "grounded",
            text: "Transformer 用 self-attention 替代 recurrence，改变了序列建模的主轴。"
          })
        ]),
        externalKnowledge: Object.freeze([]),
        paperEvidence: Object.freeze(["evidence-attention-self-attention"]),
        paperEvidenceSpans: Object.freeze([
          Object.freeze({
            chunkId: "paper-attention:p2:chunk-1",
            confidence: 0.92,
            id: "evidence-attention-self-attention",
            normalizedQuote: "self-attention replaces recurrence in the encoder.",
            page: 2,
            paperId: "paper-attention",
            quote: "Self-attention replaces recurrence in the encoder."
          })
        ])
      }),
      omittedSections: Object.freeze([
        Object.freeze({ id: "section-experiment", label: "实验", sectionKey: "experiment" }),
        Object.freeze({ id: "section-limitations", label: "局限", sectionKey: "limitations" })
      ]),
      recommendations: Object.freeze([
        Object.freeze({
          compatibility: 0.82,
          id: "intuecho-fixture-method",
          note: "本地待同步的理解线索，关注 self-attention 如何替代 recurrence。",
          relationship: "方法与问题设定"
        })
      ]),
      summary:
        "这篇论文的核心不是一般性介绍序列建模，而是提出 Transformer 用 self-attention（自注意力）替代 recurrence（循环结构）作为主要建模机制，使编码器与解码器能并行处理 token 间关系，并把后续 NLP 架构的知识图谱重心推向 attention-based representation（基于注意力的表示）。",
      withinPaperClosure: true
    }),
    targetLanguage: "zh-CN",
    importedChunksByPaperId: Object.freeze({
      "paper-attention": Object.freeze(["Self-attention replaces recurrence in the encoder."]),
      "paper-bert": Object.freeze(["Pre-training provides bidirectional language context."])
    })
  });
}
