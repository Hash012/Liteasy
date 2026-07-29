import { expect, test } from "vitest";
import { generateAssistantAnswer } from "../app/features/assistant/generateAssistantAnswer";
import { createSettingsStore } from "../app/features/settings/settings.store";
import {
  evaluateThinReadingGoldCase,
  type ThinReadingGoldConcept
} from "../app/features/thin-reading/thinReadingEvaluation";
import type { RetrievalChunk } from "../app/features/retrieval/retrieval.types";
import type { ThinReadingPaperType } from "../app/features/thin-reading/thinReading.types";

const liveEndpoint = process.env.LITEASY_THIN_READING_LIVE_EVAL_ENDPOINT;
const liveProvider = process.env.LITEASY_THIN_READING_LIVE_EVAL_PROVIDER ?? "openai";
const liveCaseId = process.env.LITEASY_THIN_READING_LIVE_EVAL_CASE ?? "colbert";
const externalLiveTest = liveEndpoint && liveCaseId === "bert-external" ? test : test.skip;
const chineseBranchLiveTest = liveEndpoint && liveCaseId === "bert-zh-branch" ? test : test.skip;

type LiveThinReadingGoldCase = {
  acceptablePaperTypes?: readonly ThinReadingPaperType[];
  chunks: readonly RetrievalChunk[];
  expectedEvidenceSubstring: string;
  expectedSummaryConcepts: readonly (string | readonly string[])[];
  paperId: string;
  paperType: ThinReadingPaperType;
  page: number;
  question: string;
  requiredTerminology?: readonly { original: ThinReadingGoldConcept; translation: ThinReadingGoldConcept }[];
  targetLanguage?: string;
  title: string;
};

const liveGoldCases: Record<string, LiveThinReadingGoldCase> = {
  bert: {
    chunks: [
      {
        page: 1,
        paperId: "live-bert",
        paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        snippet: "BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers.",
        summary: "BERT learns bidirectional representations from unlabeled text through both left and right context.",
        tags: ["BERT", "bidirectional", "pre-training"]
      },
      {
        page: 2,
        paperId: "live-bert",
        paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        snippet: "We also use a next sentence prediction task that jointly pre-trains text-pair representations.",
        summary: "Next sentence prediction extends pre-training to text-pair representations.",
        tags: ["next sentence prediction", "text pairs", "pre-training"]
      },
      {
        page: 3,
        paperId: "live-bert",
        paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
        snippet: "For each task, we simply feed the task-specific inputs into BERT and fine-tune all the parameters end-to-end.",
        summary: "Downstream tasks fine-tune BERT end-to-end with task-specific inputs.",
        tags: ["fine-tuning", "downstream tasks", "end-to-end"]
      }
    ],
    expectedEvidenceSubstring: "BERT is designed to pre-train deep bidirectional representations",
    expectedSummaryConcepts: [
      "BERT",
      "bidirectional",
      ["left", "right"],
      ["pre-train", "pretraining"]
    ],
    paperId: "live-bert",
    paperType: "experimental",
    page: 1,
    question: "Generate a thin-reading overview in English. Retain BERT's bidirectional pre-training mechanism, paired-text objective, and downstream fine-tuning consequence.",
    title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"
  },
  colbert: {
    acceptablePaperTypes: ["experimental", "systems"],
    chunks: [
      {
        page: 2,
        paperId: "live-colbert",
        paperTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
        snippet: "Under late interaction, q and d are separately encoded into two sets of contextual embeddings, and relevance is evaluated using cheap and pruning-friendly computations between both sets.",
        summary: "ColBERT separately encodes query and document embeddings before late interaction makes relevance evaluation efficient.",
        tags: ["ColBERT", "late interaction", "BERT"]
      },
      {
        page: 2,
        paperId: "live-colbert",
        paperTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
        snippet: "For each query token, MaxSim finds the maximum similarity with document token embeddings, then sums the maxima across query tokens.",
        summary: "MaxSim preserves the most relevant document-token signal for each query token.",
        tags: ["MaxSim", "token embeddings", "retrieval"]
      },
      {
        page: 5,
        paperId: "live-colbert",
        paperTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
        snippet: "The evaluation compares effectiveness and latency on MS MARCO passage ranking and TREC deep learning tracks.",
        summary: "The evaluation compares ranking effectiveness and retrieval latency.",
        tags: ["MS MARCO", "TREC", "latency"]
      }
    ],
    expectedEvidenceSubstring: "Under late interaction, q and d are separately encoded",
    expectedSummaryConcepts: [
      "ColBERT",
      "late interaction",
      "MaxSim",
      ["efficient", "efficiency", "ranking"]
    ],
    paperId: "live-colbert",
    paperType: "experimental",
    page: 2,
    question: "Generate a thin-reading overview in English. Retain ColBERT's late-interaction mechanism, MaxSim's role, efficiency tradeoff, and evaluation boundary.",
    title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
  },
  "glue-benchmark": {
    chunks: [
      {
        page: 2,
        paperId: "live-glue-benchmark",
        paperTitle: "GLUE: A Multi-Task Benchmark and Analysis Platform for Natural Language Understanding",
        snippet: "A suite of nine sentence or sentence-pair NLU tasks, built on established existing datasets and selected to cover a diverse range of dataset sizes, text genres, and degrees of difficulty.",
        summary: "GLUE combines nine sentence or sentence-pair NLU tasks from established datasets with varied sizes, genres, and difficulty.",
        tags: ["GLUE", "benchmark", "nine tasks", "sentence-pair", "NLU"]
      },
      {
        page: 1,
        paperId: "live-glue-benchmark",
        paperTitle: "GLUE: A Multi-Task Benchmark and Analysis Platform for Natural Language Understanding",
        snippet: "GLUE is a collection of resources for training, evaluating, and comparing natural language understanding systems.",
        summary: "GLUE supports training, evaluating, and comparing NLU systems.",
        tags: ["evaluation", "comparison", "natural language understanding"]
      },
      {
        page: 1,
        paperId: "live-glue-benchmark",
        paperTitle: "GLUE: A Multi-Task Benchmark and Analysis Platform for Natural Language Understanding",
        snippet: "We introduce a diagnostic test suite that enables detailed linguistic analysis of models.",
        summary: "A diagnostic suite complements aggregate benchmark scores with linguistic analysis.",
        tags: ["diagnostic suite", "linguistic analysis", "models"]
      }
    ],
    expectedEvidenceSubstring: "A suite of nine sentence or sentence-pair NLU tasks",
    expectedSummaryConcepts: [
      "GLUE",
      "nine",
      ["sentence", "sentence-pair"],
      "NLU",
      ["evaluate", "compare", "benchmark"]
    ],
    paperId: "live-glue-benchmark",
    paperType: "benchmark",
    page: 2,
    question: "Generate a thin-reading overview in English. Treat GLUE primarily as a benchmark: retain its nine sentence or sentence-pair NLU tasks, why the task mix makes systems comparable across settings, and the diagnostic-suite boundary. Do not turn it into a generic dataset catalog.",
    title: "GLUE: A Multi-Task Benchmark and Analysis Platform for Natural Language Understanding"
  },
  "squad-dataset": {
    chunks: [
      {
        page: 1,
        paperId: "live-squad-dataset",
        paperTitle: "SQuAD: 100,000+ Questions for Machine Comprehension of Text",
        snippet: "The Stanford Question Answering Dataset (SQuAD) is a new reading comprehension dataset, consisting of questions posed by crowdworkers on a set of Wikipedia articles, where the answer to every question is a segment of text from the corresponding reading passage.",
        summary: "SQuAD is a crowdworker-authored reading-comprehension dataset over Wikipedia passages with answer spans in the source text.",
        tags: ["SQuAD", "dataset", "crowdworkers", "Wikipedia", "reading comprehension"]
      },
      {
        page: 1,
        paperId: "live-squad-dataset",
        paperTitle: "SQuAD: 100,000+ Questions for Machine Comprehension of Text",
        snippet: "SQuAD contains 100,000+ questions posed by crowdworkers on a set of Wikipedia articles, where the answer to every question is a segment of text from the corresponding reading passage.",
        summary: "The resource contains over 100,000 crowdworker questions with extractive answers from Wikipedia passages.",
        tags: ["100,000 questions", "crowdworkers", "extractive answers", "Wikipedia"]
      },
      {
        page: 1,
        paperId: "live-squad-dataset",
        paperTitle: "SQuAD: 100,000+ Questions for Machine Comprehension of Text",
        snippet: "We evaluate the performance of several baseline models and compare their performance to humans.",
        summary: "The paper also uses baselines and human comparison to establish the resource's evaluation role.",
        tags: ["baseline models", "human performance", "evaluation"]
      }
    ],
    expectedEvidenceSubstring: "questions posed by crowdworkers on a set of Wikipedia articles",
    expectedSummaryConcepts: [
      "SQuAD",
      "crowdworker",
      "Wikipedia",
      ["reading comprehension", "machine comprehension"],
      ["answer", "passage", "segment"]
    ],
    paperId: "live-squad-dataset",
    paperType: "dataset",
    page: 1,
    question: "Generate a thin-reading overview in English. Treat SQuAD primarily as a dataset/resource paper: retain what resource is built, how crowdworkers and Wikipedia passages define its construction, the extractive answer boundary, and its intended evaluation use. Do not turn it into a generic model-results summary.",
    title: "SQuAD: 100,000+ Questions for Machine Comprehension of Text"
  },
  "colbert-zh": {
    acceptablePaperTypes: ["experimental", "systems"],
    chunks: [
      {
        page: 2,
        paperId: "live-colbert-zh",
        paperTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
        snippet: "Under late interaction, q and d are separately encoded into two sets of contextual embeddings, and relevance is evaluated using cheap and pruning-friendly computations between both sets.",
        summary: "ColBERT separately encodes query and document embeddings before late interaction makes relevance evaluation efficient.",
        tags: ["ColBERT", "late interaction", "BERT"]
      },
      {
        page: 2,
        paperId: "live-colbert-zh",
        paperTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
        snippet: "For each query token, MaxSim finds the maximum similarity with document token embeddings, then sums the maxima across query tokens.",
        summary: "MaxSim preserves the most relevant document-token signal for each query token.",
        tags: ["MaxSim", "token embeddings", "retrieval"]
      },
      {
        page: 5,
        paperId: "live-colbert-zh",
        paperTitle: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT",
        snippet: "The evaluation compares effectiveness and latency on MS MARCO passage ranking and TREC deep learning tracks.",
        summary: "The evaluation compares ranking effectiveness and retrieval latency.",
        tags: ["MS MARCO", "TREC", "latency"]
      }
    ],
    expectedEvidenceSubstring: "Under late interaction, q and d are separately encoded",
    expectedSummaryConcepts: ["ColBERT", "late interaction", "MaxSim", ["效率", "高效", "efficient", "efficiency"]],
    paperId: "live-colbert-zh",
    paperType: "experimental",
    page: 2,
    question: "用中文生成 ColBERT 的薄读总述。必须保留 late interaction（后期交互）这个关键术语，说明 MaxSim 的作用、效率取舍和评测边界。",
    requiredTerminology: [{
      original: "late interaction",
      translation: ["后期交互", "后交互", "晚期交互", "后段交互", "延迟交互"]
    }],
    targetLanguage: "zh-CN",
    title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
  }
};

const liveCase = liveGoldCases[liveCaseId];
const rootLiveTest = liveEndpoint && liveCase ? test : test.skip;
const liveOpenAlexApiKey = process.env.LITEASY_OPENALEX_API_KEY?.trim() ?? "";

rootLiveTest("meets a live thin-reading quality gate through the desktop model path", async () => {
  if (!liveCase) {
    throw new Error(`Unknown live thin-reading gold case: ${liveCaseId}`);
  }
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: liveEndpoint as string
  });
  store.apply({
    intent: "update_setting",
    target: "models.default_provider",
    value: liveProvider
  });

  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      [liveCase.paperId]: liveCase.chunks
    },
    mode: "qa",
    question: liveCase.question,
    selectedPapers: [{
      id: liveCase.paperId,
      title: liveCase.title
    }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: `live-thin-reading-eval-${liveCase.paperId}`,
      depth: 0,
      paperIds: [liveCase.paperId],
      primaryPaperId: liveCase.paperId,
      primaryPaperTitle: liveCase.title,
      source: { kind: "root_overview" },
      targetLanguage: liveCase.targetLanguage ?? "en-US"
    }
  });

  expect(result.executionTrace).toMatchObject({
    backend: "dev_cloud",
    endpoint: liveEndpoint,
    mode: "live",
    provider: liveProvider,
    source: "cloud_proxy"
  });
  expect(result.thinReading).toBeDefined();
  expect(result.thinReading?.qualityGate.attempts).toBeGreaterThanOrEqual(1);
  expect(result.thinReading?.qualityGate.attempts).toBeLessThanOrEqual(2);
  expect(result.thinReading?.rootSeed.summary.length).toBeGreaterThanOrEqual(24);
  expect(result.thinReading?.rootSeed.evidence.paperEvidence).not.toHaveLength(0);
  expect(result.thinReading?.rootSeed.evidence.paperEvidenceSpans).not.toHaveLength(0);
  expect(result.thinReading?.rootSeed.evidence.summarySentences).not.toHaveLength(0);
  expect(result.thinReading?.rootSeed.evidence.summarySentences?.every((sentence) => (
    sentence.status === "unsupported" || sentence.evidenceIds.length > 0
  ))).toBe(true);

  const requiredEvidence = result.analysis?.evidence.find((evidence) => (
    evidence.quote.includes(liveCase.expectedEvidenceSubstring)
  ));
  expect(requiredEvidence).toBeDefined();
  if (!requiredEvidence || !result.thinReading) {
    throw new Error(`Live ${liveCaseId} eval did not retain its known source evidence.`);
  }

  const quality = evaluateThinReadingGoldCase({
    candidate: result.thinReading.rootSeed,
    gold: {
      expectedWithinPaperClosure: true,
      id: `live-${liveCaseId}-root`,
      acceptablePaperTypes: liveCase.acceptablePaperTypes,
      paperType: liveCase.paperType,
      relevantEvidenceIds: result.analysis?.evidence.map((evidence) => evidence.id) ?? [requiredEvidence.id],
      requiredEvidence: [{
        evidenceId: requiredEvidence.id,
        page: liveCase.page,
        quote: requiredEvidence.quote
      }],
      requiredSummaryConcepts: liveCase.expectedSummaryConcepts,
      requiredTerminology: liveCase.requiredTerminology,
      stage: "root",
      targetLanguage: liveCase.targetLanguage ?? "en-US"
    }
  });

  expect(quality.metrics.summaryCoreRecall.score).toBeGreaterThanOrEqual(0.75);
  expect(quality.metrics.evidenceGrounding.score).toBe(1);
  expect(quality.metrics.sentenceBoundaryCoverage.score).toBe(1);
  expect(quality.metrics.languageConsistency.score).toBe(1);
  expect(
    quality.metrics.terminologyRetention.score,
    `live summary=${result.thinReading.rootSeed.summary}`
  ).toBe(1);
  expect(
    quality.metrics.paperTypeAccuracy.score,
    `live paperType=${result.thinReading.rootSeed.paperType}; score=${quality.overallScore.toFixed(2)}; issues=${quality.issues.map((issue) => issue.code).join(",")}`
  ).toBe(1);
  expect(quality.passed, `live quality issues=${quality.issues.map((issue) => issue.code).join(",")}`).toBe(true);
}, 120_000);

externalLiveTest("keeps a live beyond-paper branch traceable through OpenAlex", async () => {
  if (!liveOpenAlexApiKey) {
    throw new Error("bert-external live eval requires an OpenAlex API key from its dedicated local configuration.");
  }
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: liveEndpoint as string
  });
  store.apply({
    intent: "update_setting",
    target: "models.default_provider",
    value: liveProvider
  });
  store.apply({
    intent: "update_setting",
    target: "thin_reading.openalex_api_key",
    value: liveOpenAlexApiKey
  });

  const paperId = "live-bert-external";
  const title = "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding";
  console.info("[thin-reading-live-eval] external branch: requesting OpenAlex retrieval and model generation.");
  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      [paperId]: [{
        page: 1,
        paperId,
        paperTitle: title,
        snippet: "BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers.",
        summary: "BERT learns bidirectional representations from left and right context.",
        tags: ["BERT", "bidirectional", "pre-training"]
      }]
    },
    mode: "qa",
    question: "Explore the beyond-paper evidence boundary: use the retrieved OpenAlex record to explain how AlphaFold relates to BERT, without treating the relationship as BERT paper evidence.",
    selectedPapers: [{
      doi: "10.18653/v1/N19-1423",
      id: paperId,
      title
    }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "live-thin-reading-eval-bert-external",
      depth: 1,
      paperIds: [paperId],
      parentClaims: [{
        evidenceIds: ["parent-bert-evidence"],
        id: "parent-bert-claim",
        status: "grounded",
        text: "BERT establishes bidirectional pre-training as the parent paper's core mechanism."
      }],
      parentWithinPaperClosure: false,
      primaryPaperId: paperId,
      primaryPaperIdentity: {
        kind: "doi",
        source: "metadata",
        value: "10.18653/v1/N19-1423"
      },
      primaryPaperTitle: title,
      source: {
        kind: "selected_text",
        excerpt: "AlphaFold citation relationship to BERT",
        prompt: "Use only the retrieved OpenAlex source and clearly preserve the external-evidence boundary."
      },
      targetLanguage: "en-US"
    }
  });

  console.info("[thin-reading-live-eval] external branch: generation returned; evaluating provenance and quality gates.");

  expect(result.executionTrace).toMatchObject({
    backend: "dev_cloud",
    mode: "live",
    provider: liveProvider,
    source: "cloud_proxy"
  });
  expect(result.thinReading).toBeDefined();
  expect(result.thinReading?.context.externalSources).not.toHaveLength(0);
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(false);
  expect(result.thinReading?.rootSeed.evidence.externalKnowledge).not.toHaveLength(0);
  expect(result.thinReading?.rootSeed.evidence.externalSources?.every((source) => (
    source.relation === "cited_by_target" ||
    source.relation === "cites_target" ||
    source.relation === "related" ||
    source.relation === "topic_search"
  ))).toBe(true);

  if (!result.thinReading) {
    throw new Error("Live external thin-reading eval returned no document seed.");
  }
  const quality = evaluateThinReadingGoldCase({
    candidate: result.thinReading.rootSeed,
    gold: {
      expectedWithinPaperClosure: false,
      id: "live-bert-external",
      paperType: "experimental",
      relevantEvidenceIds: result.analysis?.evidence.map((evidence) => evidence.id) ?? [],
      requiredSummaryConcepts: [],
      stage: "branch",
      targetLanguage: "en-US"
    }
  });
  expect(quality.metrics.closureBoundaryAccuracy.score).toBe(1);
  expect(quality.metrics.externalSourceTraceability.score).toBe(1);
  expect(quality.metrics.externalRelationFidelity.score).toBe(1);
  expect(quality.metrics.sentenceBoundaryCoverage.score).toBe(1);
  expect(quality.metrics.paperTypeAccuracy.score).toBe(1);
  console.info("[thin-reading-live-eval] external branch: all quality gates passed.");
}, 120_000);

chineseBranchLiveTest("keeps Chinese terminology and parent continuity in a live in-paper branch", async () => {
  const store = createSettingsStore();
  store.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: liveEndpoint as string
  });
  store.apply({
    intent: "update_setting",
    target: "models.default_provider",
    value: liveProvider
  });

  const paperId = "live-bert-zh-branch";
  const title = "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding";
  const maskedLanguageModelingQuote = "The MLM objective enables the representation to fuse the left and the right context, which allows us to pretrain a deep bidirectional Transformer.";
  const result = await generateAssistantAnswer({
    artifactType: "thin_reading",
    importedChunksByPaperId: {
      [paperId]: [{
        page: 2,
        paperId,
        paperTitle: title,
        snippet: maskedLanguageModelingQuote,
        summary: "Masked language modeling fuses left and right context for BERT's deep bidirectional representations.",
        tags: ["BERT", "masked language modeling", "bidirectional pre-training"]
      }]
    },
    mode: "qa",
    question: "承接上一层的双向预训练判断，深入解释 masked language modeling（掩码语言建模）如何让 BERT 融合左右上下文。只使用论文内证据，不要扩展到外部工作。",
    selectedPapers: [{ id: paperId, title }],
    settings: store.getState(),
    thinReadingContext: {
      artifactId: "live-thin-reading-eval-bert-zh-branch",
      depth: 1,
      paperIds: [paperId],
      parentClaims: [{
        evidenceIds: ["parent-bert-bidirectional"],
        id: "parent-bert-bidirectional-claim",
        status: "grounded",
        text: "BERT 通过双向预训练同时利用左右上下文。"
      }],
      parentEvidenceSpans: [{
        confidence: 1,
        id: "parent-bert-bidirectional",
        page: 1,
        paperId,
        quote: "BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers."
      }],
      parentNodeId: "live-bert-parent",
      parentSummary: "BERT 的核心是通过双向预训练建立同时利用左右上下文的表示。",
      parentTitle: "双向预训练",
      parentWithinPaperClosure: true,
      primaryPaperId: paperId,
      primaryPaperTitle: title,
      source: {
        evidenceIds: ["parent-bert-bidirectional"],
        excerpt: "双向预训练如何实现",
        kind: "selected_text",
        prompt: "重点解释 masked language modeling（掩码语言建模）的机制。"
      },
      targetLanguage: "zh-CN"
    }
  });

  expect(result.executionTrace).toMatchObject({
    backend: "dev_cloud",
    mode: "live",
    provider: liveProvider,
    source: "cloud_proxy"
  });
  expect(result.thinReading?.rootSeed.withinPaperClosure).toBe(true);
  const evidence = result.analysis?.evidence.find((item) => item.quote.includes("MLM objective enables"));
  expect(evidence).toBeDefined();
  if (!evidence || !result.thinReading) {
    throw new Error("Live BERT Chinese branch did not retain its masked-language-modeling evidence.");
  }

  const quality = evaluateThinReadingGoldCase({
    candidate: result.thinReading.rootSeed,
    gold: {
      expectedWithinPaperClosure: true,
      id: "live-bert-zh-branch",
      paperType: "experimental",
      relevantEvidenceIds: result.analysis?.evidence.map((item) => item.id) ?? [evidence.id],
      requiredBranchConcepts: ["masked language modeling", ["融合", "左右上下文"]],
      requiredEvidence: [{ evidenceId: evidence.id, page: 2, quote: evidence.quote }],
      requiredParentContinuityConcepts: [["双向", "bidirectional"], ["预训练", "pre-train", "pretraining"]],
      requiredSummaryConcepts: ["BERT", "masked language modeling", "掩码语言建模", ["双向", "bidirectional"]],
      requiredTerminology: [{ original: "masked language modeling", translation: "掩码语言建模" }],
      stage: "branch",
      targetLanguage: "zh-CN"
    }
  });

  expect(quality.metrics.branchRelevance.score).toBeGreaterThanOrEqual(0.8);
  expect(quality.metrics.evidenceGrounding.score).toBe(1);
  expect(quality.metrics.languageConsistency.score).toBe(1);
  expect(quality.metrics.sentenceBoundaryCoverage.score).toBe(1);
  expect(quality.metrics.terminologyRetention.score).toBe(1);
  expect(quality.passed, `live quality issues=${quality.issues.map((issue) => issue.code).join(",")}`).toBe(true);
}, 120_000);
