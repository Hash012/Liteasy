import type {
  ThinReadingGenerationContext,
  ThinReadingNodeSource,
  ThinReadingPaperType
} from "./thinReading.types";

type ThinReadingPromptLanguage = "en-US" | "zh-CN";
type ThinReadingPromptStage = "omitted_section" | "root" | "selected_text";

type WeightedPattern = {
  pattern: RegExp;
  weight: number;
};

type ThinReadingPaperTypeProfile = {
  labelEn: string;
  labelZh: string;
  matchers: readonly WeightedPattern[];
  focusEn: string;
  focusZh: string;
  omittedHintEn: string;
  omittedHintZh: string;
};

export const thinReadingPaperTypes: readonly ThinReadingPaperType[] = Object.freeze([
  "experimental",
  "theoretical",
  "systems",
  "dataset",
  "survey",
  "benchmark",
  "position",
  "humanities",
  "unknown"
]);

const paperTypeProfiles: Record<ThinReadingPaperType, ThinReadingPaperTypeProfile> = {
  benchmark: {
    focusEn: "Prioritize benchmark task design, evaluation axes, headline ranking/result shifts, and what the benchmark makes newly comparable.",
    focusZh: "优先讲基准任务设计、评测轴线、关键排名/结果变化，以及它让哪些对象变得可比较。",
    labelEn: "benchmark/evaluation paper",
    labelZh: "基准评测型论文",
    matchers: [
      { pattern: /\bbenchmark(s|ing)?\b|leaderboard|evaluation suite|testbed/i, weight: 5 },
      { pattern: /基准|排行榜|评测套件|测试床|评测框架/, weight: 5 }
    ],
    omittedHintEn: "Good omitted buttons often include task design, metrics, dataset composition, baselines, leaderboard findings, and limitations.",
    omittedHintZh: "遗漏按钮通常可落在任务设计、指标、数据组成、baseline、榜单发现和局限。"
  },
  dataset: {
    focusEn: "Prioritize what resource is built, how it is collected/annotated, coverage, intended uses, evaluation hooks, and bias boundaries.",
    focusZh: "优先讲构建了什么资源、如何采集/标注、覆盖范围、用途、评测接口和偏差边界。",
    labelEn: "dataset/resource paper",
    labelZh: "数据集/资源型论文",
    matchers: [
      { pattern: /\bdataset\b|corpus|annotations?|resource|collection protocol/i, weight: 5 },
      { pattern: /数据集|语料|标注|资源|采集流程|构建流程/, weight: 5 }
    ],
    omittedHintEn: "Good omitted buttons often include construction pipeline, annotation protocol, coverage, evaluation usage, and known bias.",
    omittedHintZh: "遗漏按钮通常可落在构建流程、标注规范、覆盖范围、评测用途和偏差。"
  },
  experimental: {
    focusEn: "Prioritize the core conclusion, the reasoning path or mechanism, decisive experimental evidence, and the paper's position in the field map.",
    focusZh: "优先讲核心结论、关键思路/机制、决定性实验支撑，以及这个结论在领域知识图谱中的位置。",
    labelEn: "experimental/conclusion paper",
    labelZh: "实验/结论型论文",
    matchers: [
      { pattern: /experiment|ablation|empirical|evaluation|baseline|accuracy|f1|auc|result/i, weight: 3 },
      { pattern: /实验|消融|评估|基线|准确率|结果|性能提升|指标/, weight: 3 }
    ],
    omittedHintEn: "Good omitted buttons often include method details, experiments, ablations, assumptions, failure cases, and related-work position.",
    omittedHintZh: "遗漏按钮通常可落在方法细节、实验、消融、假设、失败案例和相关工作位置。"
  },
  humanities: {
    focusEn: "Prioritize the central thesis, conceptual genealogy, interpretive path, textual or historical evidence, and explanatory limits.",
    focusZh: "优先讲中心论题、概念谱系、解释路径、文本/历史证据和解释边界。",
    labelEn: "humanities/interpretive paper",
    labelZh: "人文/解释型论文",
    matchers: [
      { pattern: /ethnograph|archival|qualitative|histori|philosoph|interpret|case study/i, weight: 4 },
      { pattern: /人文|历史|哲学|档案|质性|阐释|个案|田野/, weight: 4 }
    ],
    omittedHintEn: "Good omitted buttons often include concepts, historical context, argument path, source interpretation, and counter-readings.",
    omittedHintZh: "遗漏按钮通常可落在概念、历史语境、论证路径、材料解释和反向解读。"
  },
  position: {
    focusEn: "Prioritize the stance, problem reframing, strongest reasons, strategic implications, and what remains contested.",
    focusZh: "优先讲作者立场、问题重构、最强理由、策略含义和仍有争议之处。",
    labelEn: "position/perspective paper",
    labelZh: "立场/观点型论文",
    matchers: [
      { pattern: /position|perspective|opinion|manifesto|agenda|call for/i, weight: 5 },
      { pattern: /观点|立场|议程|倡议|展望|呼吁/, weight: 5 }
    ],
    omittedHintEn: "Good omitted buttons often include assumptions, argument supports, objections, implications, and research agenda.",
    omittedHintZh: "遗漏按钮通常可落在前提、论据、反驳、含义和研究议程。"
  },
  survey: {
    focusEn: "Prioritize the taxonomy, main axes of disagreement, knowledge map, organizing framework, and unsolved problems.",
    focusZh: "优先讲分类框架、主要分歧轴线、知识地图、组织方式和未解决问题。",
    labelEn: "survey/review paper",
    labelZh: "综述型论文",
    matchers: [
      { pattern: /\bsurvey\b|review|taxonomy|systematic literature/i, weight: 6 },
      { pattern: /综述|文献综述|分类法|系统回顾|知识图谱/, weight: 6 }
    ],
    omittedHintEn: "Good omitted buttons often include taxonomy branches, comparison axes, historical trajectory, open problems, and practical guidance.",
    omittedHintZh: "遗漏按钮通常可落在分类分支、比较轴线、历史脉络、开放问题和实践建议。"
  },
  systems: {
    focusEn: "Prioritize architecture, data/control flow, component responsibilities, operational tradeoffs, and measured performance/reliability.",
    focusZh: "优先讲架构、数据/控制流、组件职责、工程取舍，以及性能/可靠性的实测结果。",
    labelEn: "systems/architecture paper",
    labelZh: "系统/架构型论文",
    matchers: [
      { pattern: /system|architecture|pipeline|runtime|throughput|latency|scalab|distributed/i, weight: 4 },
      { pattern: /系统|架构|流水线|运行时|吞吐|延迟|扩展性|分布式/, weight: 4 }
    ],
    omittedHintEn: "Good omitted buttons often include architecture, data flow, scheduler/runtime, performance, reliability, and deployment constraints.",
    omittedHintZh: "遗漏按钮通常可落在架构、数据流、调度/运行时、性能、可靠性和部署约束。"
  },
  theoretical: {
    focusEn: "Prioritize the theorem or formal claim, assumptions, proof path, relationship to prior theory, and implications of the bound/result.",
    focusZh: "优先讲定理/形式化主张、前提假设、证明路径、与既有理论的关系，以及界/结论的含义。",
    labelEn: "theoretical/derivation paper",
    labelZh: "理论/推导型论文",
    matchers: [
      { pattern: /theorem|proof|lemma|derivation|bound|convergence|optimality/i, weight: 5 },
      { pattern: /定理|证明|引理|推导|收敛|上界|下界|最优性/, weight: 5 }
    ],
    omittedHintEn: "Good omitted buttons often include assumptions, proof sketch, definitions, corollaries, counterexamples, and relation to prior theory.",
    omittedHintZh: "遗漏按钮通常可落在假设、证明梗概、定义、推论、反例和既有理论关系。"
  },
  unknown: {
    focusEn: "Infer the paper type from evidence first, then prioritize the few claims a reader should retain instead of summarizing every section evenly.",
    focusZh: "先从证据中自行判断论文类型，再优先呈现读者最应留下的少数主轴，避免平均概括。",
    labelEn: "unclassified paper",
    labelZh: "未分类论文",
    matchers: [],
    omittedHintEn: "Good omitted buttons should be based on evidence sections not covered by the summary.",
    omittedHintZh: "遗漏按钮应来自证据中实际存在但总述未覆盖的板块。"
  }
};

function promptLanguage(targetLanguage: string): ThinReadingPromptLanguage {
  return targetLanguage.toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

function stageForSource(source: ThinReadingNodeSource): ThinReadingPromptStage {
  if (source.kind === "omitted_section") {
    return "omitted_section";
  }
  return source.kind === "selected_text" ? "selected_text" : "root";
}

function scoreProfile(text: string, profile: ThinReadingPaperTypeProfile) {
  return profile.matchers.reduce(
    (score, matcher) => score + (matcher.pattern.test(text) ? matcher.weight : 0),
    0
  );
}

export function getThinReadingPaperTypeLabel(
  paperType: ThinReadingPaperType,
  targetLanguage: string
) {
  const profile = paperTypeProfiles[paperType] ?? paperTypeProfiles.unknown;
  return promptLanguage(targetLanguage) === "en-US" ? profile.labelEn : profile.labelZh;
}

export function classifyThinReadingPaper(input: {
  evidencePrompt: string;
  title: string;
}): ThinReadingPaperType {
  const titleText = input.title.toLowerCase();
  const evidenceText = input.evidencePrompt.toLowerCase();
  const scored = thinReadingPaperTypes
    .filter((paperType) => paperType !== "unknown")
    .map((paperType) => {
      const profile = paperTypeProfiles[paperType];
      return {
        paperType,
        score: scoreProfile(titleText, profile) * 2 + scoreProfile(evidenceText, profile)
      };
    })
    .sort((left, right) => right.score - left.score);
  return scored[0] && scored[0].score >= 3 ? scored[0].paperType : "unknown";
}

export function buildThinReadingPromptGuidance(input: {
  context: ThinReadingGenerationContext;
  evidencePrompt: string;
  selectedPaperTitle: string;
}) {
  const inferredPaperType = classifyThinReadingPaper({
    evidencePrompt: input.evidencePrompt,
    title: input.selectedPaperTitle
  });
  const language = promptLanguage(input.context.targetLanguage);
  const profile = paperTypeProfiles[inferredPaperType];
  const stage = stageForSource(input.context.source);
  const typeList = thinReadingPaperTypes.join(", ");

  if (language === "en-US") {
    const stageInstruction = stage === "root"
      ? "Stage: root overview. Produce one focused paragraph for the whole paper."
      : stage === "omitted_section"
        ? "Stage: omitted section. Explain why this omitted section matters to the paper's retained core."
        : "Stage: selected text. Explain the selected words in continuity with the parent node and user prompt.";
    return [
      `Initial paper type: ${profile.labelEn} (${inferredPaperType}). You may correct paperType in JSON if the evidence proves another type.`,
      `Allowed paperType values: ${typeList}.`,
      `Type-specific focus: ${profile.focusEn}`,
      `Omitted-section rule: ${profile.omittedHintEn}`,
      stageInstruction
    ].join("\n");
  }

  const stageInstruction = stage === "root"
    ? "阶段：初始总述。输出全篇的一段有取舍的核心总述。"
    : stage === "omitted_section"
      ? "阶段：遗漏板块。解释这个未覆盖板块为什么会改变或补强上一层留下的核心印象。"
      : "阶段：正文选区。围绕选中的词句继续讲清楚，并保持和上一层术语、证据、用户提示的连贯性。";
  return [
    `初步论文类型：${profile.labelZh}（${inferredPaperType}）。如果证据证明另有类型，可在 JSON 的 paperType 中修正。`,
    `paperType 只能取：${typeList}。`,
    `类型取舍：${profile.focusZh}`,
    `遗漏板块规则：${profile.omittedHintZh}`,
    stageInstruction
  ].join("\n");
}
