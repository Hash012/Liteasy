import type {
  CreateThinReadingDocumentInput,
  ThinReadingAnchor,
  ThinReadingAnchorKind,
  ThinReadingExternalSource
} from "./thinReading.types";

const anchorGraphSentences = [
  {
    id: "anchor-graph-sentence-1",
    text: "这篇论文提出用 self-attention 替代 recurrence 作为主要建模机制，在 WMT 2014 英德翻译任务上以更少的训练时间取得更高的 BLEU。"
  },
  {
    id: "anchor-graph-sentence-2",
    text: "训练侧使用 label smoothing 与残差 dropout，位置信息由 positional encoding 注入，使整层结构可以完全并行。"
  }
] as const;

/** Offsets are found in the sentence rather than counted by hand: a miscounted anchor silently
 *  fails the `slice === text` check in the renderer and simply never appears. */
function anchorIn(
  sentenceIndex: number,
  text: string,
  kind: ThinReadingAnchorKind,
  externalSourceIds: readonly string[],
  importance: number
): ThinReadingAnchor {
  const sentence = anchorGraphSentences[sentenceIndex];
  const start = sentence.text.indexOf(text);
  return {
    end: start + text.length,
    evidenceIds: ["evidence-attention-self-attention"],
    externalSourceIds,
    id: `anchor-${text.replace(/\s+/gu, "-").toLowerCase()}`,
    importance,
    kind,
    label: text,
    searchQuery: text,
    start,
    summarySentenceId: sentence.id,
    text
  };
}

function anchorGraphSource(
  id: string,
  title: string,
  relevance: number,
  overrides: Partial<ThinReadingExternalSource> = {}
): ThinReadingExternalSource {
  return {
    abstract: `${title}：来自可追溯来源记录的摘要片段。`,
    authors: ["Researcher", "Coauthor"],
    confidence: 0.3,
    confidenceBasis: "algorithmic_retrieval",
    id,
    provider: "openalex",
    relation: "topic_search",
    relevance,
    retrievalQuery: "self-attention",
    sourceId: id,
    sourceRecordUrl: `https://openalex.org/${id}`,
    title,
    url: `https://openalex.org/${id}`,
    year: 2017,
    ...overrides
  };
}

/**
 * A thin-reading artifact whose anchors carry real association results, for the page-level graph.
 * One source is shared by two anchors, because the crossing is the case the graph exists to show.
 */
export function createThinReadingAnchorGraphFixture(): CreateThinReadingDocumentInput {
  const sources: ThinReadingExternalSource[] = [
    anchorGraphSource("openalex:W1", "核心方法的原始定义与理论依据", 0.96, {
      confidence: 1,
      confidenceBasis: "author_citation",
      fullTextUrl: "https://example.org/paper-1.pdf",
      relation: "cited_by_target"
    }),
    anchorGraphSource("openalex:W2", "相对位置表示下的自注意力扩展", 0.92, {
      confidence: 0.6,
      confidenceBasis: "citation_graph",
      relation: "cites_target"
    }),
    anchorGraphSource("openalex:W3", "并行序列建模的卷积替代路线", 0.88, {
      confidence: 1,
      confidenceBasis: "author_citation",
      relation: "cited_by_target"
    }),
    anchorGraphSource("openalex:W4", "结构化自注意力的句子表示", 0.78),
    anchorGraphSource("openalex:W5", "主题相近但关系依据较弱的研究", 0.6),
    anchorGraphSource("openalex:W6", "该翻译任务的数据集原始论文", 0.99, {
      confidence: 1,
      confidenceBasis: "canonical_registry",
      fullTextUrl: "https://example.org/paper-6.pdf",
      relation: "cited_by_target",
      retrievalQuery: "权威词表：WMT 2014 English-German"
    }),
    anchorGraphSource("openalex:W7", "同任务上的系统级比较基线", 0.72, {
      confidence: 0.6,
      confidenceBasis: "citation_graph",
      relation: "bibliographic_coupling"
    }),
    anchorGraphSource("openalex:W8", "该评测指标的原始论文", 0.94, {
      confidence: 1,
      confidenceBasis: "canonical_registry",
      relation: "cited_by_target"
    }),
    anchorGraphSource("openalex:W9", "该正则化方法的训练来源", 0.9, {
      confidence: 1,
      confidenceBasis: "author_citation",
      relation: "cited_by_target"
    }),
    anchorGraphSource("openalex:W10", "位置编码的替代方案", 0.68)
  ];

  const anchors: ThinReadingAnchor[] = [
    // W3 appears under two anchors on purpose: the graph must draw it once, with two edges.
    anchorIn(0, "self-attention", "method", ["openalex:W1", "openalex:W2", "openalex:W3", "openalex:W4", "openalex:W5"], 0.95),
    anchorIn(0, "WMT 2014", "result", ["openalex:W6", "openalex:W7", "openalex:W3"], 0.82),
    anchorIn(0, "BLEU", "result", ["openalex:W8"], 0.78),
    anchorIn(1, "label smoothing", "concept", ["openalex:W9"], 0.7),
    anchorIn(1, "positional encoding", "concept", ["openalex:W10"], 0.66)
  ];

  return {
    artifactId: "artifact-thin-anchor-graph",
    papers: [{ id: "paper-attention", title: "Attention Is All You Need" }],
    rootSeed: {
      evidence: {
        anchors,
        claims: [],
        externalKnowledge: sources.map((source) => source.id),
        externalSources: sources,
        paperEvidence: ["evidence-attention-self-attention"],
        paperEvidenceSpans: [{
          chunkId: "paper-attention:p2:chunk-1",
          confidence: 0.92,
          id: "evidence-attention-self-attention",
          page: 2,
          paperId: "paper-attention",
          quote: "Self-attention replaces recurrence in the encoder."
        }],
        summarySentences: anchorGraphSentences.map((sentence) => ({
          evidenceIds: ["evidence-attention-self-attention"],
          externalKnowledge: [],
          id: sentence.id,
          status: "grounded" as const,
          text: sentence.text
        }))
      },
      omittedSections: [{ id: "section-experiment", label: "实验", sectionKey: "experiment" }],
      recommendations: [],
      summary: anchorGraphSentences.map((sentence) => sentence.text).join(""),
      withinPaperClosure: true
    },
    targetLanguage: "zh-CN",
    importedChunksByPaperId: {
      "paper-attention": ["Self-attention replaces recurrence in the encoder."]
    }
  };
}

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
        ]),
        summarySentences: Object.freeze([
          Object.freeze({
            evidenceIds: Object.freeze(["evidence-attention-self-attention"]),
            externalKnowledge: Object.freeze([]),
            id: "thin-reading-sentence-attention-core",
            status: "grounded",
            text: "这篇论文的核心不是一般性介绍序列建模，而是提出 Transformer 用 self-attention（自注意力）替代 recurrence（循环结构）作为主要建模机制，使编码器与解码器能并行处理 token 间关系，并把后续 NLP 架构的知识图谱重心推向 attention-based representation（基于注意力的表示）。"
          })
        ])
      }),
      omittedSections: Object.freeze([
        Object.freeze({ id: "section-experiment", label: "实验", sectionKey: "experiment" }),
        Object.freeze({ id: "section-limitations", label: "局限", sectionKey: "limitations" })
      ]),
      recommendations: Object.freeze([]),
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
