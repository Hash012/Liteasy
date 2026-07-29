import type { ThinReadingGoldStandard } from "../../app/features/thin-reading/thinReadingEvaluation";
import type { ThinReadingNodeSeed, ThinReadingPaperType } from "../../app/features/thin-reading/thinReading.types";

export type ThinReadingRealPdfGoldCase = {
  candidate: ThinReadingNodeSeed;
  gold: ThinReadingGoldStandard;
  source: {
    relativePath: string;
    sha256: string;
  };
};

function rootedCandidate(input: {
  evidenceId: string;
  omittedSections: readonly string[];
  paperId: string;
  paperType: ThinReadingPaperType;
  page: number;
  quote: string;
  summary: string;
}): ThinReadingNodeSeed {
  return {
    evidence: {
      claims: [{
        evidenceIds: [input.evidenceId],
        id: `${input.evidenceId}-claim`,
        status: "grounded",
        text: input.summary
      }],
      externalKnowledge: [],
      paperEvidence: [input.evidenceId],
      paperEvidenceSpans: [{
        confidence: 1,
        id: input.evidenceId,
        page: input.page,
        paperId: input.paperId,
        quote: input.quote
      }],
      summarySentences: [{
        evidenceIds: [input.evidenceId],
        externalKnowledge: [],
        id: `${input.evidenceId}-sentence`,
        status: "grounded",
        text: input.summary
      }]
    },
    omittedSections: input.omittedSections.map((sectionKey) => ({
      id: `${input.paperId}-${sectionKey}`,
      label: sectionKey.replaceAll("_", " "),
      sectionKey
    })),
    paperType: input.paperType,
    recommendations: [],
    summary: input.summary,
    withinPaperClosure: true
  };
}

const colbertQuote = "Under late interaction, q and d are separately encoded into two sets of contextual embeddings, and relevance is evaluated using cheap and pruning-friendly computations between both sets";
const acornQuote = "To address this, we present ACORN, an approach for performant and predicate-agnostic hybrid search.";
const surveyQuote = "We start by identifying five main obstacles to vector data management, namely the vagueness of semantic similarity";
const transformerQuote = "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.";
const bertQuote = "BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers.";
const bertObjectivesQuote = "we also use a next sentence prediction task that jointly pre-trains text-pair representations.";
const bertMaskedLanguageModelingQuote = "the MLM objective enables the representation to fuse the left and the right context, which allows us to pretrain a deep bidirectional Transformer.";
const squadQuote = "posed by crowdworkers on a set of Wikipedia articles";
const ancientLanguagesQuote = "On the philologically central case of biblical reuse in patristic literature";
const glueQuote = "A suite of nine sentence or sentence-pair NLU tasks";
const glueDiagnosticQuote = "diagnostic test suite that enables detailed linguistic analysis of models.";

export const thinReadingRealPdfGoldFixtures: readonly ThinReadingRealPdfGoldCase[] = Object.freeze([
  {
    candidate: rootedCandidate({
      evidenceId: "colbert-late-interaction-p2",
      omittedSections: ["ablation", "indexing"],
      paperId: "gold-pdf-colbert",
      paperType: "experimental",
      page: 2,
      quote: colbertQuote,
      summary: "ColBERT separates query and document contextual embeddings, then uses late interaction to retain fine-grained relevance signals while keeping ranking computations efficient."
    }),
    gold: {
      expectedOmittedSectionKeys: ["ablation", "indexing"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-colbert",
      paperType: "experimental",
      relevantEvidenceIds: ["colbert-late-interaction-p2"],
      requiredEvidence: [{ evidenceId: "colbert-late-interaction-p2", page: 2, quote: colbertQuote }],
      requiredSummaryConcepts: ["late interaction", ["query", "document"], ["efficient", "cheap"]],
      stage: "root",
      targetLanguage: "en-US"
    },
    source: {
      relativePath: "public/papers/colbert-late-interaction.pdf",
      sha256: "2e487d9b96e3c2e5e286d843e98a066adc0442faa3a6e8ddbd1771221bf9ae14"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "colbert-late-interaction-zh-p2",
      omittedSections: ["ablation", "indexing"],
      paperId: "gold-pdf-colbert-zh",
      paperType: "experimental",
      page: 2,
      quote: colbertQuote,
      summary: "ColBERT 先分别编码查询与文档的上下文化向量，再用 late interaction（后期交互）保留细粒度相关性信号，并以廉价、便于剪枝的计算兼顾排序效果与检索效率。"
    }),
    gold: {
      expectedOmittedSectionKeys: ["ablation", "indexing"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-colbert-zh",
      paperType: "experimental",
      relevantEvidenceIds: ["colbert-late-interaction-zh-p2"],
      requiredEvidence: [{ evidenceId: "colbert-late-interaction-zh-p2", page: 2, quote: colbertQuote }],
      requiredSummaryConcepts: ["ColBERT", "late interaction", "后期交互", ["查询", "文档"], ["效率", "廉价", "剪枝"]],
      requiredTerminology: [{ original: "late interaction", translation: "后期交互" }],
      stage: "root",
      targetLanguage: "zh-CN"
    },
    source: {
      relativePath: "public/papers/colbert-late-interaction.pdf",
      sha256: "2e487d9b96e3c2e5e286d843e98a066adc0442faa3a6e8ddbd1771221bf9ae14"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "acorn-hybrid-search-p1",
      omittedSections: ["construction", "benchmarks"],
      paperId: "gold-pdf-acorn",
      paperType: "systems",
      page: 1,
      quote: acornQuote,
      summary: "ACORN targets performant predicate-agnostic hybrid search, using an HNSW-based construction to support structured predicates without assuming their selectivity."
    }),
    gold: {
      expectedOmittedSectionKeys: ["construction", "benchmarks"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-acorn",
      paperType: "systems",
      relevantEvidenceIds: ["acorn-hybrid-search-p1"],
      requiredEvidence: [{ evidenceId: "acorn-hybrid-search-p1", page: 1, quote: acornQuote }],
      requiredSummaryConcepts: ["ACORN", "predicate-agnostic", "hybrid search"],
      stage: "root",
      targetLanguage: "en-US"
    },
    source: {
      relativePath: "public/papers/acorn-vector-search.pdf",
      sha256: "bb438a891f1e4e522215c0d40d079ad72eb97eaa162b925db542cd5538a40f1d"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "vdbms-obstacles-p1",
      omittedSections: ["indexing", "research_challenges"],
      paperId: "gold-pdf-vdbms-survey",
      paperType: "survey",
      page: 1,
      quote: surveyQuote,
      summary: "This survey frames vector database management around five obstacles, then organizes the field through query processing, storage and indexing, and the remaining research challenges."
    }),
    gold: {
      expectedOmittedSectionKeys: ["indexing", "research_challenges"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-vdbms-survey",
      paperType: "survey",
      relevantEvidenceIds: ["vdbms-obstacles-p1"],
      requiredEvidence: [{ evidenceId: "vdbms-obstacles-p1", page: 1, quote: surveyQuote }],
      requiredSummaryConcepts: ["five obstacles", "query processing", ["indexing", "storage"], "research challenges"],
      stage: "root",
      targetLanguage: "en-US"
    },
    source: {
      relativePath: "public/papers/survey-vector-database-management-systems.pdf",
      sha256: "4c768b9b3be95ab9433cc4c19801d5c75150e2a2b5c031f40031d10bd55760cf"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "transformer-attention-p1",
      omittedSections: ["multi_head_attention", "translation_results"],
      paperId: "gold-pdf-transformer",
      paperType: "theoretical",
      page: 1,
      quote: transformerQuote,
      summary: "The Transformer replaces recurrence and convolution with attention alone, making global sequence dependencies more parallelizable while preserving a focused encoder-decoder architecture."
    }),
    gold: {
      expectedOmittedSectionKeys: ["multi_head_attention", "translation_results"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-transformer",
      paperType: "theoretical",
      relevantEvidenceIds: ["transformer-attention-p1"],
      requiredEvidence: [{ evidenceId: "transformer-attention-p1", page: 1, quote: transformerQuote }],
      requiredSummaryConcepts: ["Transformer", "attention", ["recurrence", "convolution"], "parallel"],
      stage: "root",
      targetLanguage: "en-US"
    },
    source: {
      relativePath: "public/papers/attention-is-all-you-need-arxiv.pdf",
      sha256: "bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "bert-bidirectional-p1",
      omittedSections: ["pretraining_objectives", "benchmark_results"],
      paperId: "gold-pdf-bert",
      paperType: "experimental",
      page: 1,
      quote: bertQuote,
      summary: "BERT pre-trains deep bidirectional Transformer representations from unlabeled text using both left and right context, then adapts them to downstream tasks with minimal task-specific architecture."
    }),
    gold: {
      expectedOmittedSectionKeys: ["pretraining_objectives", "benchmark_results"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-bert",
      paperType: "experimental",
      relevantEvidenceIds: ["bert-bidirectional-p1"],
      requiredEvidence: [{ evidenceId: "bert-bidirectional-p1", page: 1, quote: bertQuote }],
      requiredSummaryConcepts: ["BERT", "bidirectional", ["left", "right"], ["pre-train", "pretrain"]],
      stage: "root",
      targetLanguage: "en-US"
    },
    source: {
      relativePath: "public/papers/bert-pretraining-arxiv.pdf",
      sha256: "5692a5514787a8c6727b4ff3b726a3385798bc68e12138d1d4af83947e2acf6e"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "ancient-languages-patristic-reuse-p1",
      omittedSections: ["representation_methods", "benchmark_results"],
      paperId: "gold-pdf-ancient-languages",
      paperType: "humanities",
      page: 1,
      quote: ancientLanguagesQuote,
      summary: "This digital-humanities study centers the philological problem of biblical reuse in patristic literature, treating Latin and Ancient Greek textual correspondences as an interpretive corpus-analysis task rather than a generic benchmark."
    }),
    gold: {
      expectedOmittedSectionKeys: ["representation_methods", "benchmark_results"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-ancient-languages",
      paperType: "humanities",
      relevantEvidenceIds: ["ancient-languages-patristic-reuse-p1"],
      requiredEvidence: [{ evidenceId: "ancient-languages-patristic-reuse-p1", page: 1, quote: ancientLanguagesQuote }],
      requiredSummaryConcepts: ["philological", "biblical reuse", "patristic literature", ["Latin", "Ancient Greek"]],
      stage: "root",
      targetLanguage: "en-US"
    },
    source: {
      relativePath: "public/papers/ancient-languages-semantic-corpus-analysis-arxiv.pdf",
      sha256: "382c20f690b74a9d19745fff6487edf74aef992e17de98099aeff35b15392cc2"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "glue-nine-tasks-p2",
      omittedSections: ["diagnostic_suite", "baseline_comparison"],
      paperId: "gold-pdf-glue",
      paperType: "benchmark",
      page: 2,
      quote: glueQuote,
      summary: "GLUE defines a benchmark around nine sentence or sentence-pair NLU tasks, using diverse established datasets to evaluate whether a model transfers linguistic knowledge beyond one task or genre."
    }),
    gold: {
      expectedOmittedSectionKeys: ["diagnostic_suite", "baseline_comparison"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-glue",
      paperType: "benchmark",
      relevantEvidenceIds: ["glue-nine-tasks-p2"],
      requiredEvidence: [{ evidenceId: "glue-nine-tasks-p2", page: 2, quote: glueQuote }],
      requiredSummaryConcepts: ["GLUE", "nine", ["sentence", "sentence-pair"], "NLU", ["transfer", "across tasks"]],
      stage: "root",
      targetLanguage: "en-US"
    },
    source: {
      relativePath: "public/papers/glue-benchmark-arxiv.pdf",
      sha256: "4c1aaf622c6ee3166bb4af2999b866e05019e5a35ac5f832018a887e7b44508a"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "glue-diagnostic-suite-p1",
      omittedSections: ["baseline_comparison"],
      paperId: "gold-pdf-glue-branch",
      paperType: "benchmark",
      page: 1,
      quote: glueDiagnosticQuote,
      summary: "GLUE's diagnostic suite deepens the benchmark beyond one aggregate score: it is designed to expose which linguistic phenomena models handle and where their generalization remains limited."
    }),
    gold: {
      expectedOmittedSectionKeys: ["baseline_comparison"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-glue-branch-diagnostic-suite",
      paperType: "benchmark",
      relevantEvidenceIds: ["glue-diagnostic-suite-p1"],
      requiredBranchConcepts: ["diagnostic suite", ["linguistic analysis", "linguistic phenomena"]],
      requiredEvidence: [{ evidenceId: "glue-diagnostic-suite-p1", page: 1, quote: glueDiagnosticQuote }],
      requiredParentContinuityConcepts: ["GLUE", ["benchmark", "tasks"]],
      requiredSummaryConcepts: ["GLUE", "diagnostic", ["linguistic", "models"]],
      stage: "branch",
      targetLanguage: "en-US"
    },
    source: {
      relativePath: "public/papers/glue-benchmark-arxiv.pdf",
      sha256: "4c1aaf622c6ee3166bb4af2999b866e05019e5a35ac5f832018a887e7b44508a"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "squad-dataset-collection-p1",
      omittedSections: ["dataset_analysis", "model_evaluation"],
      paperId: "gold-pdf-squad",
      paperType: "dataset",
      page: 1,
      quote: squadQuote,
      summary: "SQuAD is a reading-comprehension resource built from crowdworker-authored questions over Wikipedia articles, establishing a human-authored corpus for machine comprehension."
    }),
    gold: {
      expectedOmittedSectionKeys: ["dataset_analysis", "model_evaluation"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-squad",
      paperType: "dataset",
      relevantEvidenceIds: ["squad-dataset-collection-p1"],
      requiredEvidence: [{ evidenceId: "squad-dataset-collection-p1", page: 1, quote: squadQuote }],
      requiredSummaryConcepts: ["SQuAD", "crowdworker", "Wikipedia", ["machine comprehension", "reading-comprehension"]],
      stage: "root",
      targetLanguage: "en-US"
    },
    source: {
      relativePath: "public/papers/squad-100k-questions-arxiv.pdf",
      sha256: "5169f9424ad6078815b99f5aa83724f42fa6826cedfb8ae303a8091d15c8450c"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "bert-objectives-p2",
      omittedSections: ["fine_tuning", "benchmark_results"],
      paperId: "gold-pdf-bert-branch",
      paperType: "experimental",
      page: 2,
      quote: bertObjectivesQuote,
      summary: "BERT deepens its bidirectional pre-training claim through two coupled objectives: masked language modeling reconstructs context from both directions, while next sentence prediction jointly trains text-pair representations."
    }),
    gold: {
      expectedOmittedSectionKeys: ["fine_tuning", "benchmark_results"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-bert-branch-objectives",
      paperType: "experimental",
      relevantEvidenceIds: ["bert-objectives-p2"],
      requiredBranchConcepts: ["masked language", "next sentence prediction"],
      requiredEvidence: [{ evidenceId: "bert-objectives-p2", page: 2, quote: bertObjectivesQuote }],
      requiredParentContinuityConcepts: ["bidirectional", ["pre-training", "pretraining"]],
      requiredSummaryConcepts: ["BERT", "masked language", "next sentence prediction"],
      stage: "branch",
      targetLanguage: "en-US"
    },
    source: {
      relativePath: "public/papers/bert-pretraining-arxiv.pdf",
      sha256: "5692a5514787a8c6727b4ff3b726a3385798bc68e12138d1d4af83947e2acf6e"
    }
  },
  {
    candidate: rootedCandidate({
      evidenceId: "bert-mlm-zh-p2",
      omittedSections: ["next_sentence_prediction", "fine_tuning"],
      paperId: "gold-pdf-bert-zh-branch",
      paperType: "experimental",
      page: 2,
      quote: bertMaskedLanguageModelingQuote,
      summary: "承接上一层的双向预训练主轴，BERT 的 masked language modeling（掩码语言建模）让表示融合左右上下文，从而形成深层双向 Transformer 表示；这一机制说明其双向性不是把两个单向模型简单拼接。"
    }),
    gold: {
      expectedOmittedSectionKeys: ["next_sentence_prediction", "fine_tuning"],
      expectedWithinPaperClosure: true,
      id: "gold-pdf-bert-zh-branch-mlm",
      paperType: "experimental",
      relevantEvidenceIds: ["bert-mlm-zh-p2"],
      requiredBranchConcepts: ["masked language modeling", ["融合", "左右上下文"]],
      requiredEvidence: [{ evidenceId: "bert-mlm-zh-p2", page: 2, quote: bertMaskedLanguageModelingQuote }],
      requiredParentContinuityConcepts: [["双向", "bidirectional"], ["预训练", "pre-train", "pretraining"]],
      requiredSummaryConcepts: ["BERT", "masked language modeling", "掩码语言建模", ["双向", "bidirectional"]],
      requiredTerminology: [{ original: "masked language modeling", translation: "掩码语言建模" }],
      stage: "branch",
      targetLanguage: "zh-CN"
    },
    source: {
      relativePath: "public/papers/bert-pretraining-arxiv.pdf",
      sha256: "5692a5514787a8c6727b4ff3b726a3385798bc68e12138d1d4af83947e2acf6e"
    }
  }
]);
