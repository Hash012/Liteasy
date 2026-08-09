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

function source(
  id: string,
  title: string,
  relevance: number,
  confidenceBasis: ThinReadingExternalSource["confidenceBasis"] = "citation_graph"
): ThinReadingExternalSource {
  return {
    abstract: `${title} 的测试摘要。`,
    authors: ["Researcher"],
    confidence: 0.6,
    confidenceBasis,
    id,
    provider: "openalex",
    relation: confidenceBasis === "author_citation" ? "cited_by_target" : "topic_search",
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
  const confidenceBases: ThinReadingExternalSource["confidenceBasis"][] = [
    "author_citation",
    "citation_graph",
    "algorithmic_retrieval",
    "citation_graph",
    "algorithmic_retrieval",
    "author_citation",
    "citation_graph",
    "canonical_registry",
    "citation_graph",
    "algorithmic_retrieval"
  ];
  const sources = sourceTitles.map((title, index) =>
    source(`openalex:W${index + 1}`, title, 0.96 - index * 0.03, confidenceBases[index])
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
      quality: {
        citationProvenance: text === "self-attention" || text === "WMT 2014" ? 1 : 0,
        evidenceAttention: Math.max(0.35, importance - 0.08),
        evidenceCoverage: Math.max(0.5, importance - 0.04),
        reason: text === "self-attention"
          ? "核心方法 · 1 条证据 · 原文有引用"
          : `${text} · 1 条证据${text === "WMT 2014" ? " · 原文有引用" : ""}`,
        score: importance
      },
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
        recommendationPaperEdges: [{
          directed: true,
          evidenceRecordUrls: ["https://openalex.org/W1", "https://openalex.org/W6"],
          kind: "direct_citation",
          provider: "openalex",
          sourcePaperId: "openalex:W1",
          strength: 0.92,
          targetPaperId: "openalex:W6"
        }, {
          directed: false,
          evidenceRecordUrls: ["https://openalex.org/W4", "https://openalex.org/W10"],
          kind: "bibliographic_coupling",
          provider: "openalex",
          sourcePaperId: "openalex:W4",
          strength: 0.71,
          targetPaperId: "openalex:W10"
        }],
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

const maximumDensityConfidenceBases: readonly ThinReadingExternalSource["confidenceBasis"][] = [
  "author_citation",
  "canonical_registry",
  "citation_graph",
  "algorithmic_retrieval"
];

function maximumDensitySource(
  paperIndex: number,
  anchorLabel: string,
  sourceIndex: number
): ThinReadingExternalSource {
  const graphId = `W${String(paperIndex).padStart(3, "0")}`;
  const sharedDoi = "10.1000/liteasy-maximum-density-shared";
  const crossrefAlias = paperIndex === 32;
  const confidenceBasis = maximumDensityConfidenceBases[sourceIndex]!;
  const id = crossrefAlias ? "maximum-crossref-shared" : `maximum-openalex-${graphId}`;
  const provider = crossrefAlias ? "crossref" : "openalex";
  const sourceId = crossrefAlias ? sharedDoi : graphId;
  const sourceRecordUrl = crossrefAlias
    ? `https://api.crossref.org/works/${sharedDoi}`
    : `https://openalex.org/${graphId}`;
  return {
    abstract: `${anchorLabel} 的页级关联研究摘要，用于验证高密度关系图。`,
    authors: [`Researcher ${paperIndex}`],
    canonicalPaperId: crossrefAlias ? undefined : `openalex:${graphId}`,
    confidence: [1, 0.82, 0.62, 0.38][sourceIndex],
    confidenceBasis,
    doi: paperIndex === 5 || crossrefAlias ? sharedDoi : undefined,
    id,
    provider,
    relation: confidenceBasis === "author_citation"
      ? "cited_by_target"
      : confidenceBasis === "citation_graph"
        ? "co_cited"
        : confidenceBasis === "canonical_registry"
          ? "related"
          : "topic_search",
    relevance: 0.98 - sourceIndex * 0.07 - Math.floor((paperIndex - 1) / 4) * 0.005,
    retrievalQuery: anchorLabel,
    sourceId,
    sourceRecordUrl,
    title: `${anchorLabel} 的关联研究 ${String(paperIndex).padStart(2, "0")}`,
    url: crossrefAlias ? `https://doi.org/${sharedDoi}` : `https://openalex.org/${graphId}`,
    year: 2010 + paperIndex % 15
  };
}

export function createThinReadingMaximumDensityAnchorGraphFixture(): CreateThinReadingDocumentInput {
  const input = createThinReadingFixture();
  const sentences = [
    {
      id: "maximum-density-sentence-1",
      text: "为保持全页证据可核验且关系可追溯，页级阅读先围绕证据链定位识别原文中的关键定义、实验前提与可追溯出处，再逐项核对支撑论断的页码、引文片段、作者信息和来源标识。这个过程还要区分论文直接陈述的事实、读者可以复核的推导以及外部检索补充的背景，避免把相似表述误当成同一证据。只有当分散的作者引用、数据库记录和检索结果被归一到稳定论文身份后，系统才在同时记录每次身份合并的依据并检查冲突来源供读者复核后通过引用拓扑比较这些文献在全页语境中的距离、方向和证据强度，并保留每条关系的可审计出处。读者因此能够沿着任意节点返回提供方记录，确认关系方向、证据类型与归一化强度，而不需要接受无法说明来源的视觉暗示。"
    },
    {
      id: "maximum-density-sentence-2",
      text: "为保证候选论文也在页面范围内保持稳定且可审计，当语义检索补充主题相近的候选时，系统仍需区分只是内容相似的结果和具备真实引用依据的关系。候选论文会先按锚点覆盖、证据来源、置信度与相关度排序，再统一处理 DOI、OpenAlex 和 Semantic Scholar 等身份别名，使同一成果不会因提供方不同而占用多个节点。这些步骤完成并形成稳定候选集合之后再继续核验，关系服务只接受能够从来源记录复核的直接引用、共同被引或共享参考文献事实，最后再用完整的别名联合结果核验书目耦合，避免跨提供方的同一篇论文被重复绘制或产生没有出处的连线。即使部分提供方暂时不可用，页面也只保留已经核验的关系和基础推荐，不会用语义相似度补造论文之间的事实。"
    },
    {
      id: "maximum-density-sentence-3",
      text: "在核对每个关键论断时，高价值概念的判断首先考察原文出处是否明确，包括概念所在句是否能够回到论文证据、局部是否存在可解析引用以及引用匹配质量是否足够稳定。与此同时，评分还会结合概念重要度、独立证据覆盖和生成期间实际执行过的搜索、阅读与复核操作，但会给重复动作设置上限，防止无意义调用抬高权重。系统据此归一生成过程投入的证据关注度，并进一步把模型思考量作为可审计指标而不是隐藏思维链；这些信号共同决定锚点优先级，却不会被误写成未经核验的文献关系。分项理由只向读者说明核心方法、证据数量和原文引用等可理解信息，不展示模型名称、工具调用或内部开发状态。"
    },
    {
      id: "maximum-density-sentence-4",
      text: "当页面也需要同时呈现全部重要推荐时，最终布局按照锚点价值保留每个重要概念的文献覆盖，先为每个锚点选择仍未入图的最高价值论文，再按证据基础、置信度、相关度和稳定标识填满共享预算。受约束布局把锚点固定在原文位置，依次检查节点越界、卡片重叠、文字遮挡、同侧扇区和主边交叉，并且只有在全部硬条件为零时才采用候选结果。随后，在完整投影已经覆盖全部锚点且隐藏数量可被准确报告之后再进入，系统在页面范围内统一计算跨页关系，使同一锚点的连线尽量位于一侧，同时用边长、颜色与透明度呈现关系类型、距离和强弱。"
    }
  ];
  const anchorDefinitions = [
    { kind: "method", label: "证据链定位", sentenceIndex: 0 },
    { kind: "concept", label: "引用拓扑", sentenceIndex: 0 },
    { kind: "method", label: "语义检索", sentenceIndex: 1 },
    { kind: "concept", label: "书目耦合", sentenceIndex: 1 },
    { kind: "concept", label: "原文出处", sentenceIndex: 2 },
    { kind: "method", label: "模型思考量", sentenceIndex: 2 },
    { kind: "concept", label: "锚点价值", sentenceIndex: 3 },
    { kind: "concept", label: "跨页关系", sentenceIndex: 3 }
  ] as const;
  const sources = anchorDefinitions.flatMap((anchor, anchorIndex) =>
    Array.from({ length: 4 }, (_, sourceIndex) => maximumDensitySource(
      anchorIndex * 4 + sourceIndex + 1,
      anchor.label,
      sourceIndex
    ))
  );
  const anchors = anchorDefinitions.map((definition, anchorIndex): ThinReadingAnchor => {
    const sentence = sentences[definition.sentenceIndex]!;
    const start = sentence.text.indexOf(definition.label);
    const externalSourceIds = sources
      .slice(anchorIndex * 4, anchorIndex * 4 + 4)
      .map((candidate) => candidate.id);
    return {
      end: start + definition.label.length,
      evidenceIds: ["evidence-attention-self-attention"],
      externalSourceIds,
      id: `maximum-density-anchor-${anchorIndex + 1}`,
      importance: 0.98 - anchorIndex * 0.04,
      kind: definition.kind,
      label: definition.label,
      quality: {
        citationProvenance: anchorIndex % 3 === 0 ? 1 : 0.6,
        evidenceAttention: 0.96 - anchorIndex * 0.035,
        evidenceCoverage: 0.94 - anchorIndex * 0.03,
        reason: `${definition.label} · 1 条证据${anchorIndex % 3 === 0 ? " · 原文有引用" : ""}`,
        score: 0.97 - anchorIndex * 0.04
      },
      searchQuery: definition.label,
      start,
      summarySentenceId: sentence.id,
      text: definition.label
    };
  });
  return {
    ...input,
    artifactId: "artifact-thin-maximum-density-anchor-graph",
    rootSeed: {
      ...input.rootSeed,
      evidence: {
        ...input.rootSeed.evidence,
        anchors,
        externalKnowledge: sources.map(({ id }) => id),
        externalSources: sources,
        recommendationPaperEdges: [{
          directed: true,
          evidenceRecordUrls: ["https://openalex.org/W001", "https://openalex.org/W005"],
          kind: "direct_citation",
          provider: "openalex",
          sourcePaperId: "openalex:W001",
          strength: 0.94,
          targetPaperId: "openalex:W005"
        }, {
          directed: false,
          evidenceRecordUrls: ["https://openalex.org/W009", "https://openalex.org/W013"],
          kind: "bibliographic_coupling",
          provider: "openalex",
          sourcePaperId: "openalex:W009",
          strength: 0.79,
          targetPaperId: "openalex:W013"
        }, {
          directed: false,
          evidenceRecordUrls: ["https://openalex.org/W017", "https://openalex.org/W021"],
          kind: "co_cited",
          provider: "openalex",
          sourcePaperId: "openalex:W017",
          strength: 0.72,
          targetPaperId: "openalex:W021"
        }],
        summarySentences: sentences.map((sentence) => ({
          evidenceIds: ["evidence-attention-self-attention"],
          externalKnowledge: [],
          id: sentence.id,
          status: "grounded" as const,
          text: sentence.text
        }))
      },
      summary: sentences.map(({ text }) => text).join("\n\n")
    }
  };
}
