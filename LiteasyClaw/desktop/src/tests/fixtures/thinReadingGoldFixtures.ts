import type {
  ThinReadingGoldStandard
} from "../../app/features/thin-reading/thinReadingEvaluation";
import type {
  ThinReadingNodeSeed,
  ThinReadingPaperType
} from "../../app/features/thin-reading/thinReading.types";

type GoldFixture = {
  candidate: ThinReadingNodeSeed;
  gold: ThinReadingGoldStandard;
};

function groundedCandidate(input: {
  evidenceId: string;
  omittedSectionKeys: readonly string[];
  paperId: string;
  paperType: ThinReadingPaperType;
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
        chunkId: `${input.paperId}:p2:chunk-1`,
        confidence: 0.94,
        id: input.evidenceId,
        page: 2,
        paperId: input.paperId,
        quote: `${input.summary} Supporting quotation.`
      }],
      summarySentences: [{
        evidenceIds: [input.evidenceId],
        externalKnowledge: [],
        id: `${input.evidenceId}-sentence`,
        status: "grounded",
        text: input.summary
      }]
    },
    omittedSections: input.omittedSectionKeys.map((sectionKey) => ({
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

function rootFixture(input: {
  evidenceId: string;
  id: string;
  omittedSectionKeys: readonly string[];
  paperType: ThinReadingPaperType;
  requiredSummaryConcepts: ThinReadingGoldStandard["requiredSummaryConcepts"];
  summary: string;
  targetLanguage: string;
}): GoldFixture {
  return {
    candidate: groundedCandidate({
      evidenceId: input.evidenceId,
      omittedSectionKeys: input.omittedSectionKeys,
      paperId: input.id,
      paperType: input.paperType,
      summary: input.summary
    }),
    gold: {
      expectedOmittedSectionKeys: input.omittedSectionKeys,
      expectedWithinPaperClosure: true,
      id: input.id,
      paperType: input.paperType,
      relevantEvidenceIds: [input.evidenceId],
      requiredSummaryConcepts: input.requiredSummaryConcepts,
      stage: "root",
      targetLanguage: input.targetLanguage
    }
  };
}

export const thinReadingGoldFixtures: readonly GoldFixture[] = Object.freeze([
  rootFixture({
    evidenceId: "evidence-survey-taxonomy",
    id: "gold-survey-vector-databases",
    omittedSectionKeys: ["taxonomy_branches", "historical_trajectory"],
    paperType: "survey",
    requiredSummaryConcepts: [
      ["taxonomy", "分类框架"],
      ["比较轴线", "comparison axes"],
      ["开放问题", "未解问题", "open problems"]
    ],
    summary: "这篇综述用 taxonomy（分类框架）组织向量数据库的知识地图，给出索引与查询处理的主要比较轴线，并指出过滤检索和系统优化仍是开放问题。",
    targetLanguage: "zh-CN"
  }),
  rootFixture({
    evidenceId: "evidence-experimental-maxsim",
    id: "gold-experimental-colbert",
    omittedSectionKeys: ["ablation", "limitations"],
    paperType: "experimental",
    requiredSummaryConcepts: [
      "MaxSim",
      ["token-level matching", "词元级匹配"],
      ["检索效果", "retrieval effectiveness"]
    ],
    summary: "ColBERT 的核心结论是 MaxSim late interaction 保留 token-level matching（词元级匹配），在可离线编码文档的同时提高检索效果；关键实验表明这种交互方式优于单向量基线。",
    targetLanguage: "zh-CN"
  }),
  rootFixture({
    evidenceId: "evidence-systems-acorn",
    id: "gold-systems-acorn",
    omittedSectionKeys: ["reliability", "deployment_constraints"],
    paperType: "systems",
    requiredSummaryConcepts: [
      "graph architecture",
      "predicate filtering",
      ["latency", "throughput"]
    ],
    summary: "ACORN changes the graph architecture and search data flow so predicate filtering is handled during traversal; the central tradeoff is extra graph connectivity for lower latency and higher throughput under selective filters.",
    targetLanguage: "en-US"
  }),
  rootFixture({
    evidenceId: "evidence-dataset-annotation",
    id: "gold-dataset-resource",
    omittedSectionKeys: ["evaluation_usage", "bias"],
    paperType: "dataset",
    requiredSummaryConcepts: [
      ["资源", "数据集"],
      "标注协议",
      ["覆盖范围", "偏差边界"]
    ],
    summary: "论文构建了可复用的多领域数据集资源，通过双人复核的标注协议保证一致性；它扩大了任务覆盖范围，但语言与地域分布构成明确的偏差边界。",
    targetLanguage: "zh-CN"
  }),
  rootFixture({
    evidenceId: "evidence-theory-bound",
    id: "gold-theoretical-convergence",
    omittedSectionKeys: ["counterexample", "prior_theory"],
    paperType: "theoretical",
    requiredSummaryConcepts: [
      "convergence bound",
      "smoothness assumption",
      "proof route"
    ],
    summary: "The paper proves a tighter convergence bound under a smoothness assumption; its proof route couples a stability lemma with a telescoping argument, showing when the improved rate changes the existing theory map.",
    targetLanguage: "en-US"
  }),
  rootFixture({
    evidenceId: "evidence-humanities-archive",
    id: "gold-humanities-archive",
    omittedSectionKeys: ["counter_reading", "historical_context"],
    paperType: "humanities",
    requiredSummaryConcepts: [
      ["中心论题", "核心论题"],
      ["解释路径", "阐释路径"],
      ["档案证据", "历史材料"],
      ["解释边界", "局限"]
    ],
    summary: "文章的中心论题是制度语言如何重塑公共记忆；它沿概念谱系展开解释路径，以档案证据校正既有叙事，同时承认材料缺口限定了这种解释边界。",
    targetLanguage: "zh-CN"
  }),
  {
    candidate: groundedCandidate({
      evidenceId: "evidence-branch-maxsim",
      omittedSectionKeys: [],
      paperId: "gold-branch-maxsim",
      paperType: "experimental",
      summary: "承接上一层对 ColBERT 的判断，MaxSim 值得继续读，因为它逐个保留 query token 的最佳文档匹配信号，从而细化了 token-level matching 如何兼顾离线编码与相关性。"
    }),
    gold: {
      expectedWithinPaperClosure: true,
      id: "gold-branch-maxsim",
      paperType: "experimental",
      relevantEvidenceIds: ["evidence-branch-maxsim"],
      requiredBranchConcepts: ["MaxSim", ["query token", "查询 token"], "最佳文档匹配"],
      requiredParentContinuityConcepts: ["ColBERT", ["token-level matching", "词元级匹配"]],
      requiredSummaryConcepts: ["MaxSim", ["离线编码", "offline encoding"]],
      stage: "branch",
      targetLanguage: "zh-CN"
    }
  },
  {
    candidate: {
      evidence: {
        claims: [{
          evidenceIds: [],
          id: "claim-external-citation-graph",
          status: "weak",
          text: "越过本文证据后，citation graph 将其与后续相关工作连接起来。"
        }],
        externalKnowledge: ["OpenAlex citation graph"],
        paperEvidence: [],
        paperEvidenceSpans: [],
        summarySentences: [{
          evidenceIds: [],
          externalKnowledge: ["OpenAlex citation graph"],
          id: "sentence-external-citation-graph",
          status: "weak",
          text: "这一层已越过论文闭包，需要借助 OpenAlex citation graph 追踪后续相关工作与引用关系。"
        }]
      },
      omittedSections: [],
      paperType: "survey",
      recommendations: [],
      summary: "这一层已越过论文闭包，需要借助 OpenAlex citation graph 追踪后续相关工作与引用关系。",
      withinPaperClosure: false
    },
    gold: {
      expectedWithinPaperClosure: false,
      id: "gold-branch-external-boundary",
      paperType: "survey",
      relevantEvidenceIds: [],
      requiredBranchConcepts: [["citation graph", "引文图"], ["相关工作", "related work"]],
      requiredParentContinuityConcepts: [["论文闭包", "paper closure"]],
      requiredSummaryConcepts: [["OpenAlex", "外部知识"], ["引用关系", "citation relationship"]],
      stage: "branch",
      targetLanguage: "zh-CN"
    }
  }
]);
