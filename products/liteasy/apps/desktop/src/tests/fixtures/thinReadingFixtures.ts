import type {
  CreateThinReadingDocumentInput,
  ThinReadingAnchor,
  ThinReadingExternalSource
} from "../../app/features/thin-reading/thinReading.types";

export function createThinReadingFixture(): CreateThinReadingDocumentInput {
  return {
    artifactId: "artifact-thin-fixture",
    papers: [
      { id: "paper-attention", title: "Attention Is All You Need" },
      { id: "paper-bert", title: "BERT: Pre-training of Deep Bidirectional Transformers" }
    ],
    rootSeed: {
      evidence: {
        claims: [{
          evidenceIds: ["evidence-attention-self-attention"],
          id: "thin-reading-claim-attention-core",
          status: "grounded",
          text: "Transformer 用 self-attention 替代 recurrence，改变了序列建模的主轴。"
        }],
        externalKnowledge: [],
        paperEvidence: ["evidence-attention-self-attention"],
        paperEvidenceSpans: [{
          chunkId: "paper-attention:p2:chunk-1",
          confidence: 0.92,
          id: "evidence-attention-self-attention",
          normalizedQuote: "self-attention replaces recurrence in the encoder.",
          page: 2,
          paperId: "paper-attention",
          quote: "Self-attention replaces recurrence in the encoder."
        }],
        summarySentences: [{
          evidenceIds: ["evidence-attention-self-attention"],
          externalKnowledge: [],
          id: "thin-reading-sentence-attention-core",
          status: "grounded",
          text: "这篇论文提出 Transformer 用 self-attention 替代 recurrence 作为主要建模机制。"
        }]
      },
      omittedSections: [
        { id: "section-experiment", label: "实验", sectionKey: "experiment" },
        { id: "section-limitations", label: "局限", sectionKey: "limitations" }
      ],
      recommendations: [],
      summary: "这篇论文提出 Transformer 用 self-attention 替代 recurrence 作为主要建模机制。",
      withinPaperClosure: true
    },
    targetLanguage: "zh-CN",
    importedChunksByPaperId: {
      "paper-attention": ["Self-attention replaces recurrence in the encoder."],
      "paper-bert": ["Pre-training provides bidirectional language context."]
    }
  };
}

function source(id: string, title: string, relevance: number): ThinReadingExternalSource {
  return {
    abstract: `${title} 的测试摘要。`,
    authors: ["Researcher"],
    confidence: 0.6,
    confidenceBasis: "citation_graph",
    id,
    provider: "openalex",
    relation: "topic_search",
    relevance,
    retrievalQuery: "self-attention",
    sourceId: id,
    sourceRecordUrl: `https://openalex.org/${id}`,
    title,
    url: `https://openalex.org/${id}`,
    year: 2017
  };
}

export function createThinReadingAnchorGraphFixture(): CreateThinReadingDocumentInput {
  const input = createThinReadingFixture();
  const sentences = [
    { id: "anchor-graph-sentence-1", text: "这篇论文提出用 self-attention 替代 recurrence，并在 WMT 2014 上取得更高的 BLEU。" },
    { id: "anchor-graph-sentence-2", text: "训练侧使用 label smoothing，位置信息由 positional encoding 注入。" }
  ];
  const sourceTitles = [
    "核心方法的原始定义与理论依据",
    "相对位置表示下的自注意力扩展",
    "并行序列建模的卷积替代路线",
    "结构化自注意力的句子表示",
    "主题相近但关系依据较弱的研究",
    "该翻译任务的数据集原始论文",
    "同任务上的系统级比较基线",
    "该评测指标的原始论文",
    "该正则化方法的训练来源",
    "位置编码的替代方案"
  ];
  const sources = sourceTitles.map((title, index) =>
    source(`openalex:W${index + 1}`, title, 0.96 - index * 0.03)
  );
  const anchor = (
    sentenceIndex: number,
    text: string,
    externalSourceIds: string[],
    importance: number
  ): ThinReadingAnchor => {
    const sentence = sentences[sentenceIndex];
    const start = sentence.text.indexOf(text);
    return {
      end: start + text.length,
      evidenceIds: ["evidence-attention-self-attention"],
      externalSourceIds,
      id: `anchor-${text.replace(/\s+/gu, "-")}`,
      importance,
      kind: text === "self-attention" ? "method" : "concept",
      label: text,
      searchQuery: text,
      start,
      summarySentenceId: sentence.id,
      text
    };
  };
  return {
    ...input,
    artifactId: "artifact-thin-anchor-graph",
    rootSeed: {
      ...input.rootSeed,
      evidence: {
        ...input.rootSeed.evidence,
        anchors: [
          anchor(0, "self-attention", ["openalex:W1", "openalex:W2", "openalex:W3", "openalex:W4", "openalex:W5"], 0.95),
          anchor(0, "WMT 2014", ["openalex:W6", "openalex:W7", "openalex:W3"], 0.82),
          anchor(0, "BLEU", ["openalex:W8"], 0.78),
          anchor(1, "label smoothing", ["openalex:W9"], 0.7),
          anchor(1, "positional encoding", ["openalex:W10"], 0.66)
        ],
        externalKnowledge: sources.map(({ id }) => id),
        externalSources: sources,
        summarySentences: sentences.map((sentence) => ({
          evidenceIds: ["evidence-attention-self-attention"],
          externalKnowledge: [],
          id: sentence.id,
          status: "grounded" as const,
          text: sentence.text
        }))
      },
      summary: sentences.map(({ text }) => text).join("")
    }
  };
}
