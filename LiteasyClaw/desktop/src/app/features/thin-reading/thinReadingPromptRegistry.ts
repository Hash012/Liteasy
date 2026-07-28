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
  coverageAuditEn: string;
  coverageAuditZh: string;
  labelEn: string;
  labelZh: string;
  matchers: readonly WeightedPattern[];
  focusEn: string;
  focusZh: string;
  omittedHintEn: string;
  omittedHintZh: string;
  retentionTestEn: string;
  retentionTestZh: string;
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
    coverageAuditEn: "task definition, measurement axes, data composition, baselines, result/ranking shifts, and evaluation limits",
    coverageAuditZh: "任务定义、测量轴线、数据组成、baseline、结果/排名变化和评测局限",
    focusEn: "Prioritize benchmark task design, evaluation axes, headline ranking/result shifts, and what the benchmark makes newly comparable.",
    focusZh: "优先讲基准任务设计、评测轴线、关键排名/结果变化，以及它让哪些对象变得可比较。",
    labelEn: "benchmark/evaluation paper",
    labelZh: "基准评测型论文",
    matchers: [
      { pattern: /\bbenchmark(s|ing)?\b|leaderboard|evaluation suite|testbed/i, weight: 5 },
      { pattern: /基准|排行榜|评测套件|测试床|评测框架/, weight: 5 }
    ],
    omittedHintEn: "Good omitted buttons often include task design, metrics, dataset composition, baselines, leaderboard findings, and limitations.",
    omittedHintZh: "遗漏按钮通常可落在任务设计、指标、数据组成、baseline、榜单发现和局限。",
    retentionTestEn: "After reading only the overview, the reader should know what became measurable or newly comparable and which result changes matter.",
    retentionTestZh: "读者只看总述后，应知道什么对象因此变得可测/可比较，以及哪些结果变化真正重要。"
  },
  dataset: {
    coverageAuditEn: "resource scope, provenance, construction or annotation protocol, coverage, intended use, and bias or access limits",
    coverageAuditZh: "资源范围、来源、构建或标注协议、覆盖范围、预期用途和偏差/访问限制",
    focusEn: "Prioritize what resource is built, how it is collected/annotated, coverage, intended uses, evaluation hooks, and bias boundaries.",
    focusZh: "优先讲构建了什么资源、如何采集/标注、覆盖范围、用途、评测接口和偏差边界。",
    labelEn: "dataset/resource paper",
    labelZh: "数据集/资源型论文",
    matchers: [
      { pattern: /\bdataset\b|corpus|annotations?|resource|collection protocol/i, weight: 5 },
      { pattern: /数据集|语料|标注|资源|采集流程|构建流程/, weight: 5 }
    ],
    omittedHintEn: "Good omitted buttons often include construction pipeline, annotation protocol, coverage, evaluation usage, and known bias.",
    omittedHintZh: "遗漏按钮通常可落在构建流程、标注规范、覆盖范围、评测用途和偏差。",
    retentionTestEn: "After reading only the overview, the reader should know what resource now exists, why it is usable, and where its coverage or bias boundaries lie.",
    retentionTestZh: "读者只看总述后，应知道新增资源是什么、为什么可用，以及覆盖范围/偏差边界在哪里。"
  },
  experimental: {
    coverageAuditEn: "research question, central conclusion, mechanism or reasoning path, decisive evidence, failure regime, and field position",
    coverageAuditZh: "研究问题、核心结论、机制或推理路径、决定性证据、失效区间和领域位置",
    focusEn: "Prioritize the core conclusion, the reasoning path or mechanism, decisive experimental evidence, and the paper's position in the field map.",
    focusZh: "优先讲核心结论、关键思路/机制、决定性实验支撑，以及这个结论在领域知识图谱中的位置。",
    labelEn: "experimental/conclusion paper",
    labelZh: "实验/结论型论文",
    matchers: [
      { pattern: /experiment|ablation|empirical|evaluation|baseline|accuracy|f1|auc|result/i, weight: 3 },
      { pattern: /pre-?train(?:ing)?|fine-?tun(?:e|ing)|downstream task|transfer learning/i, weight: 4 },
      { pattern: /实验|消融|评估|基线|准确率|结果|性能提升|指标|预训练|微调|下游任务|迁移学习/, weight: 3 }
    ],
    omittedHintEn: "Good omitted buttons often include method details, experiments, ablations, assumptions, failure cases, and related-work position.",
    omittedHintZh: "遗漏按钮通常可落在方法细节、实验、消融、假设、失败案例和相关工作位置。",
    retentionTestEn: "After reading only the overview, the reader should know the central result, the mechanism or reasoning path, and the decisive evidence that makes it credible.",
    retentionTestZh: "读者只看总述后，应知道核心结论、关键机制/推理路径，以及让结论可信的决定性证据。"
  },
  humanities: {
    coverageAuditEn: "thesis, source material, historical or conceptual context, interpretive path, counter-reading, and explanatory limit",
    coverageAuditZh: "中心论题、材料、历史或概念语境、解释路径、反向解读和解释边界",
    focusEn: "Prioritize the central thesis, conceptual genealogy, interpretive path, textual or historical evidence, and explanatory limits.",
    focusZh: "优先讲中心论题、概念谱系、解释路径、文本/历史证据和解释边界。",
    labelEn: "humanities/interpretive paper",
    labelZh: "人文/解释型论文",
    matchers: [
      { pattern: /ethnograph|archival|qualitative|histori|philosoph|interpret|case study/i, weight: 4 },
      { pattern: /人文|历史|哲学|档案|质性|阐释|个案|田野/, weight: 4 }
    ],
    omittedHintEn: "Good omitted buttons often include concepts, historical context, argument path, source interpretation, and counter-readings.",
    omittedHintZh: "遗漏按钮通常可落在概念、历史语境、论证路径、材料解释和反向解读。",
    retentionTestEn: "After reading only the overview, the reader should know the thesis, the interpretive route, the key textual or historical evidence, and the limits of that reading.",
    retentionTestZh: "读者只看总述后，应知道中心论题、解释路径、关键文本/历史证据，以及这种解释的边界。"
  },
  position: {
    coverageAuditEn: "stance, problem reframing, supporting reasons, assumptions, practical implications, and strongest unresolved objection",
    coverageAuditZh: "立场、问题重构、支撑理由、前提假设、实践含义和最强未解反驳",
    focusEn: "Prioritize the stance, problem reframing, strongest reasons, strategic implications, and what remains contested.",
    focusZh: "优先讲作者立场、问题重构、最强理由、策略含义和仍有争议之处。",
    labelEn: "position/perspective paper",
    labelZh: "立场/观点型论文",
    matchers: [
      { pattern: /position|perspective|opinion|manifesto|agenda|call for/i, weight: 5 },
      { pattern: /观点|立场|议程|倡议|展望|呼吁/, weight: 5 }
    ],
    omittedHintEn: "Good omitted buttons often include assumptions, argument supports, objections, implications, and research agenda.",
    omittedHintZh: "遗漏按钮通常可落在前提、论据、反驳、含义和研究议程。",
    retentionTestEn: "After reading only the overview, the reader should know the stance, the reframing move, the strongest reasons, and what remains contested.",
    retentionTestZh: "读者只看总述后，应知道作者立场、问题重构方式、最强理由，以及仍有争议之处。"
  },
  survey: {
    coverageAuditEn: "scope boundary, taxonomy or organizing map, comparison axes, stable findings, disagreements, and open gaps",
    coverageAuditZh: "范围边界、分类或组织地图、比较轴线、稳定发现、分歧和开放缺口",
    focusEn: "Prioritize the taxonomy, main axes of disagreement, knowledge map, organizing framework, and unsolved problems.",
    focusZh: "优先讲分类框架、主要分歧轴线、知识地图、组织方式和未解决问题。",
    labelEn: "survey/review paper",
    labelZh: "综述型论文",
    matchers: [
      { pattern: /\bsurvey\b|review|taxonomy|systematic literature/i, weight: 6 },
      { pattern: /综述|文献综述|分类法|系统回顾|知识图谱/, weight: 6 }
    ],
    omittedHintEn: "Good omitted buttons often include taxonomy branches, comparison axes, historical trajectory, open problems, and practical guidance.",
    omittedHintZh: "遗漏按钮通常可落在分类分支、比较轴线、历史脉络、开放问题和实践建议。",
    retentionTestEn: "After reading only the overview, the reader should know the organizing map, the main comparison axes, and which unsolved problems structure the field.",
    retentionTestZh: "读者只看总述后，应知道组织领域的知识地图、主要比较轴线，以及哪些未解问题支撑这个领域。"
  },
  systems: {
    coverageAuditEn: "deployment setting, architecture, critical data/control path, component responsibilities, measured operation, and tradeoff or failure boundary",
    coverageAuditZh: "部署场景、架构、关键数据/控制路径、组件职责、实测运行结果和取舍或失效边界",
    focusEn: "Prioritize architecture, data/control flow, component responsibilities, operational tradeoffs, and measured performance/reliability.",
    focusZh: "优先讲架构、数据/控制流、组件职责、工程取舍，以及性能/可靠性的实测结果。",
    labelEn: "systems/architecture paper",
    labelZh: "系统/架构型论文",
    matchers: [
      { pattern: /system|architecture|pipeline|runtime|throughput|latency|scalab|distributed/i, weight: 4 },
      { pattern: /系统|架构|流水线|运行时|吞吐|延迟|扩展性|分布式/, weight: 4 }
    ],
    omittedHintEn: "Good omitted buttons often include architecture, data flow, scheduler/runtime, performance, reliability, and deployment constraints.",
    omittedHintZh: "遗漏按钮通常可落在架构、数据流、调度/运行时、性能、可靠性和部署约束。",
    retentionTestEn: "After reading only the overview, the reader should know the architecture, the central data/control flow, the key tradeoff, and the measured operational consequence.",
    retentionTestZh: "读者只看总述后，应知道系统架构、核心数据/控制流、关键工程取舍，以及实测的运行后果。"
  },
  theoretical: {
    coverageAuditEn: "formal claim, definitions, assumptions, proof hinge, relation to prior result, and the bound or consequence",
    coverageAuditZh: "形式化主张、定义、前提假设、证明支点、与既有结果的关系和界或推论",
    focusEn: "Prioritize the theorem or formal claim, assumptions, proof path, relationship to prior theory, and implications of the bound/result.",
    focusZh: "优先讲定理/形式化主张、前提假设、证明路径、与既有理论的关系，以及界/结论的含义。",
    labelEn: "theoretical/derivation paper",
    labelZh: "理论/推导型论文",
    matchers: [
      { pattern: /theorem|proof|lemma|derivation|bound|convergence|optimality/i, weight: 5 },
      { pattern: /定理|证明|引理|推导|收敛|上界|下界|最优性/, weight: 5 }
    ],
    omittedHintEn: "Good omitted buttons often include assumptions, proof sketch, definitions, corollaries, counterexamples, and relation to prior theory.",
    omittedHintZh: "遗漏按钮通常可落在假设、证明梗概、定义、推论、反例和既有理论关系。",
    retentionTestEn: "After reading only the overview, the reader should know the formal result, the assumptions, the proof route, and why the bound or theorem changes the theory map.",
    retentionTestZh: "读者只看总述后，应知道形式化结论、前提假设、证明路线，以及这个界/定理为什么改变理论地图。"
  },
  unknown: {
    coverageAuditEn: "strongest supported claims, evidence coverage, primary versus secondary contribution, uncertainty, and salient blind spots",
    coverageAuditZh: "最强支撑的主张、证据覆盖、主要与次要贡献、不确定性和显著盲点",
    focusEn: "Infer the paper type from evidence first, then prioritize the few claims a reader should retain instead of summarizing every section evenly.",
    focusZh: "先从证据中自行判断论文类型，再优先呈现读者最应留下的少数主轴，避免平均概括。",
    labelEn: "unclassified paper",
    labelZh: "未分类论文",
    matchers: [],
    omittedHintEn: "Good omitted buttons should be based on evidence sections not covered by the summary.",
    omittedHintZh: "遗漏按钮应来自证据中实际存在但总述未覆盖的板块。",
    retentionTestEn: "After reading only the overview, the reader should know the few claims the evidence most strongly supports, not a balanced table of contents.",
    retentionTestZh: "读者只看总述后，应知道证据最强支撑的少数主轴，而不是一份平均章节目录。"
  }
};

type ThinReadingFewShotSet = {
  en: readonly [string, string, string];
  zh: readonly [string, string, string];
};

const paperTypeFewShots: Record<ThinReadingPaperType, ThinReadingFewShotSet> = {
  benchmark: {
    en: [
      "Signal: a new evaluation suite. Retain: what capability becomes measurable, the task axes, and the ranking shift that changes conclusions.",
      "Signal: a leaderboard paper. Retain: which comparison is now fair, which baseline ordering changes, and the caveat behind the headline score.",
      "Signal: a domain testbed. Retain: coverage of stress conditions, the decisive metric, and what remains untested."
    ],
    zh: [
      "信号：提出新评测套件。留存：什么能力首次可测、任务轴线，以及改变既有结论的排名变化。",
      "信号：排行榜论文。留存：哪些比较因此公平、baseline 顺序如何变化，以及头部指标背后的限制。",
      "信号：领域测试床。留存：压力条件覆盖、决定性指标，以及仍未测到的边界。"
    ]
  },
  dataset: {
    en: [
      "Signal: a newly released corpus. Retain: what resource exists, collection provenance, coverage, and the bias that constrains reuse.",
      "Signal: an annotation dataset. Retain: annotation protocol, agreement/quality control, intended task, and ambiguous cases.",
      "Signal: a multimodal resource. Retain: modality alignment, scale, access terms, and which population or domain is missing."
    ],
    zh: [
      "信号：发布新语料库。留存：新增资源、采集来源、覆盖范围，以及限制复用的偏差。",
      "信号：标注数据集。留存：标注协议、一致性/质控、目标任务，以及难以裁决的样本。",
      "信号：多模态资源。留存：模态对齐方式、规模、使用条件，以及缺失的人群或领域。"
    ]
  },
  experimental: {
    en: [
      "Signal: a method beats strong baselines. Retain: the mechanism, decisive result, and ablation that shows where the gain comes from.",
      "Signal: a causal experiment. Retain: intervention, measured effect, identification assumptions, and the strongest alternative explanation.",
      "Signal: an empirical finding. Retain: central regularity, evidence scale, failure regime, and how it changes the field map."
    ],
    zh: [
      "信号：方法超过强 baseline。留存：作用机制、决定性结果，以及说明增益来源的消融。",
      "信号：因果实验。留存：干预、测得效应、识别假设，以及最强替代解释。",
      "信号：经验发现。留存：核心规律、证据规模、失效区间，以及它如何改变领域知识图谱。"
    ]
  },
  humanities: {
    en: [
      "Signal: an archival reinterpretation. Retain: thesis, interpretive route, decisive source, and what archival absence prevents claiming.",
      "Signal: a conceptual genealogy. Retain: how the concept changes across contexts, the argumentative pivot, and a plausible counter-reading.",
      "Signal: an ethnographic case. Retain: situated claim, observation-to-interpretation path, researcher position, and transfer limits."
    ],
    zh: [
      "信号：档案材料的新解释。留存：中心论题、解释路径、决定性材料，以及档案缺口禁止推出什么。",
      "信号：概念谱系。留存：概念如何随语境变化、论证转折，以及可信的反向解读。",
      "信号：民族志个案。留存：情境化主张、观察到解释的路径、研究者位置，以及外推边界。"
    ]
  },
  position: {
    en: [
      "Signal: a research agenda. Retain: problem reframing, strongest reason for urgency, proposed direction, and unresolved objection.",
      "Signal: a perspective paper. Retain: stance, assumption it challenges, strategic consequence, and what evidence would falsify it.",
      "Signal: a manifesto. Retain: value commitment, concrete institutional or technical change, strongest tradeoff, and contested point."
    ],
    zh: [
      "信号：研究议程。留存：问题如何被重构、紧迫性的最强理由、建议方向，以及未解决的反驳。",
      "信号：观点论文。留存：作者立场、被挑战的假设、策略后果，以及什么证据能证伪它。",
      "信号：宣言式论文。留存：价值承诺、具体制度/技术改变、最强取舍，以及争议点。"
    ]
  },
  survey: {
    en: [
      "Signal: a taxonomy survey. Retain: organizing map, comparison axes, where approaches disagree, and the open problem structuring the field.",
      "Signal: a systematic review. Retain: inclusion boundary, robust cross-study pattern, major source of disagreement, and evidence gap.",
      "Signal: a historical review. Retain: paradigm transitions, why each transition happened, the current bottleneck, and practical orientation."
    ],
    zh: [
      "信号：分类综述。留存：组织知识的地图、比较轴线、路线分歧，以及支撑领域结构的开放问题。",
      "信号：系统回顾。留存：纳入边界、跨研究稳定结论、主要分歧来源，以及证据缺口。",
      "信号：历史综述。留存：范式转折、转折原因、当前瓶颈，以及实践定位。"
    ]
  },
  systems: {
    en: [
      "Signal: a new storage engine. Retain: architecture, critical data path, engineering tradeoff, and measured latency/throughput consequence.",
      "Signal: a distributed runtime. Retain: component responsibilities, control flow, failure handling, and the scaling boundary.",
      "Signal: a production pipeline. Retain: bottleneck removed, mechanism that removes it, reliability cost, and deployment constraint."
    ],
    zh: [
      "信号：新存储引擎。留存：系统架构、关键数据路径、工程取舍，以及实测延迟/吞吐后果。",
      "信号：分布式运行时。留存：组件职责、控制流、故障处理，以及扩展边界。",
      "信号：生产流水线。留存：被消除的瓶颈、消除机制、可靠性代价，以及部署约束。"
    ]
  },
  theoretical: {
    en: [
      "Signal: a tighter bound. Retain: formal result, assumptions, proof hinge, comparison with the old bound, and when the improvement matters.",
      "Signal: a convergence theorem. Retain: convergence object/rate, required conditions, proof route, and counterexample outside the conditions.",
      "Signal: an impossibility result. Retain: what is impossible, model assumptions, reduction idea, and which escape hatch remains."
    ],
    zh: [
      "信号：更紧的界。留存：形式化结论、前提、证明支点、与旧界的比较，以及改进何时有意义。",
      "信号：收敛定理。留存：收敛对象/速率、所需条件、证明路线，以及条件外的反例。",
      "信号：不可能性结果。留存：什么不可能、模型假设、归约思路，以及仍可绕开的出口。"
    ]
  },
  unknown: {
    en: [
      "Signal: mixed evidence without a stable genre. Retain: the two or three strongest supported claims and mark type uncertainty.",
      "Signal: a hybrid method/resource paper. Retain: the primary contribution first; move the secondary contribution to an omitted branch.",
      "Signal: sparse evidence. Retain: only what evidence supports, expose coverage limits, and avoid filling a conventional section template."
    ],
    zh: [
      "信号：证据混合且体裁不稳定。留存：证据最强支撑的两三个判断，并明确类型不确定。",
      "信号：方法/资源混合论文。留存：先讲主要贡献，把次要贡献放入遗漏分支。",
      "信号：证据稀疏。留存：只讲证据支持的内容，暴露覆盖限制，不补齐惯常章节模板。"
    ]
  }
};

export type ThinReadingPaperClassificationScore = {
  evidenceScore: number;
  paperType: Exclude<ThinReadingPaperType, "unknown">;
  titleScore: number;
  totalScore: number;
};

export type ThinReadingPaperClassification = {
  confidence: "high" | "low" | "medium";
  conflict: boolean;
  paperType: ThinReadingPaperType;
  runnerUp?: ThinReadingPaperClassificationScore;
  scores: readonly ThinReadingPaperClassificationScore[];
  winner?: ThinReadingPaperClassificationScore;
};

const conflictTiePriority: Record<Exclude<ThinReadingPaperType, "unknown">, number> = {
  benchmark: 1,
  dataset: 2,
  survey: 3,
  theoretical: 4,
  systems: 5,
  position: 6,
  humanities: 7,
  experimental: 8
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

function stageQualityGate(language: ThinReadingPromptLanguage, stage: ThinReadingPromptStage) {
  if (language === "en-US") {
    if (stage === "root") {
      return "Quality gate: before writing, internally discard details that would not change the reader's retained mental model of the paper.";
    }
    if (stage === "omitted_section") {
      return "Quality gate: explain how this omitted section changes, strengthens, limits, or repositions the parent node; do not restate the overview.";
    }
    return "Quality gate: answer why the selected words are worth drilling into, preserving parent terminology, evidence boundaries, and the user hint.";
  }

  if (stage === "root") {
    return "质量门控：写作前在内部丢弃不会改变读者脑中论文模型的细节，不要按章节平均压缩。";
  }
  if (stage === "omitted_section") {
    return "质量门控：说明该遗漏板块如何改变、补强、限制或重新定位上一层结论，不要复述总述。";
  }
  return "质量门控：回答“为什么这些被选词句值得继续读”，并保持上一层术语、证据边界和用户提示的连续性。";
}

function commonEvidenceGate(language: ThinReadingPromptLanguage) {
  if (language === "en-US") {
    return [
      "Evidence gate: use the highest-leverage evidence IDs first: claims, methods, decisive results, limitations, then context.",
      "Anti-summary gate: if the paragraph can be rearranged as a section-by-section table of contents, rewrite it around the retained core.",
      "Trace gate: every content sentence must have current evidence IDs, an allowed external source ID from this retrieval turn, or unsupported status."
    ].join("\n");
  }
  return [
    "证据门控：优先使用信息量最高的 evidence ID：主张、方法机制、决定性结果、局限，再到背景。",
    "反摘要门控：如果这段话能被改写成按章节排列的目录，就必须围绕“读后留下的核心印象”重写。",
    "溯源门控：每个内容句必须对应本轮 evidence ID、本轮检索白名单中的 external source ID，或标记 unsupported。"
  ].join("\n");
}

function coverageAuditGate(
  language: ThinReadingPromptLanguage,
  profile: ThinReadingPaperTypeProfile
) {
  if (language === "en-US") {
    return [
      `Private coverage audit: check ${profile.coverageAuditEn}.`,
      "Do not output this audit or force every facet into the overview. Retain only evidence-supported facets that materially change the reader's mental model; turn a salient uncovered facet into an omitted-section token instead of a fixed chapter list."
    ].join("\n");
  }
  return [
    `私有覆盖审计：检查 ${profile.coverageAuditZh}。`,
    "不要输出这份审计，也不要把每个维度硬塞进总述。只保留有证据且会改变读者认知模型的维度；重要但未覆盖的维度应生成遗漏板块入口，而不是固定章节清单。"
  ].join("\n");
}

export function getThinReadingPaperTypeLabel(
  paperType: ThinReadingPaperType,
  targetLanguage: string
) {
  const profile = paperTypeProfiles[paperType] ?? paperTypeProfiles.unknown;
  return promptLanguage(targetLanguage) === "en-US" ? profile.labelEn : profile.labelZh;
}

export function getThinReadingFewShotExamples(
  paperType: ThinReadingPaperType,
  targetLanguage: string
): readonly [string, string, string] {
  const examples = paperTypeFewShots[paperType] ?? paperTypeFewShots.unknown;
  return promptLanguage(targetLanguage) === "en-US" ? examples.en : examples.zh;
}

export function classifyThinReadingPaperWithDiagnostics(input: {
  evidencePrompt: string;
  title: string;
}): ThinReadingPaperClassification {
  const titleText = input.title.toLowerCase();
  const evidenceText = input.evidencePrompt.toLowerCase();
  const scores = thinReadingPaperTypes
    .filter((paperType): paperType is Exclude<ThinReadingPaperType, "unknown"> =>
      paperType !== "unknown"
    )
    .map((paperType) => {
      const profile = paperTypeProfiles[paperType];
      const titleScore = scoreProfile(titleText, profile);
      const evidenceScore = scoreProfile(evidenceText, profile);
      return {
        evidenceScore,
        paperType,
        titleScore,
        totalScore: titleScore * 2 + evidenceScore
      };
    })
    .sort((left, right) =>
      right.totalScore - left.totalScore ||
      right.titleScore - left.titleScore ||
      conflictTiePriority[left.paperType] - conflictTiePriority[right.paperType]
    );
  const top = scores[0];
  if (!top || top.totalScore < 3) {
    return {
      confidence: "low",
      conflict: false,
      paperType: "unknown",
      scores
    };
  }
  const runnerUp = scores.find((score) => score.paperType !== top.paperType);
  const lead = top.totalScore - (runnerUp?.totalScore ?? 0);
  const conflict = Boolean(runnerUp && runnerUp.totalScore >= 3 && lead <= 2);
  const confidence = !conflict && top.totalScore >= 10 && lead >= 4
    ? "high"
    : conflict || top.totalScore < 6
      ? "low"
      : "medium";
  return {
    confidence,
    conflict,
    paperType: top.paperType,
    runnerUp,
    scores,
    winner: top
  };
}

export function classifyThinReadingPaper(input: {
  evidencePrompt: string;
  title: string;
}): ThinReadingPaperType {
  return classifyThinReadingPaperWithDiagnostics(input).paperType;
}

export function buildThinReadingPromptGuidance(input: {
  context: ThinReadingGenerationContext;
  evidencePrompt: string;
  selectedPaperTitle: string;
}) {
  const classification = classifyThinReadingPaperWithDiagnostics({
    evidencePrompt: input.evidencePrompt,
    title: input.selectedPaperTitle
  });
  const inferredPaperType = classification.paperType;
  const language = promptLanguage(input.context.targetLanguage);
  const profile = paperTypeProfiles[inferredPaperType];
  const fewShotExamples = getThinReadingFewShotExamples(inferredPaperType, input.context.targetLanguage);
  const stage = stageForSource(input.context.source);
  const typeList = thinReadingPaperTypes.join(", ");

  if (language === "en-US") {
    const stageInstruction = stage === "root"
      ? "Stage: root overview. Produce one focused paragraph for the whole paper."
      : stage === "omitted_section"
        ? "Stage: omitted section. Explain why this omitted section matters to the paper's retained core."
        : "Stage: selected text. Explain the selected words in continuity with the parent node and user prompt.";
    return [
      `Initial paper type: ${profile.labelEn} (${inferredPaperType}). Keep this paperType in JSON unless current evidence directly establishes that another type is the paper's primary contribution; title taxonomy or a single familiar term is not enough to override it.`,
      `Allowed paperType values: ${typeList}.`,
      `Type-specific focus: ${profile.focusEn}`,
      `Retention test: ${profile.retentionTestEn}`,
      "Human retention examples (abstract patterns, not text to copy):",
      ...fewShotExamples.map((example) => `- ${example}`),
      classification.conflict && classification.runnerUp
        ? `Type conflict: ${inferredPaperType} and ${classification.runnerUp.paperType} are close. Decide by the paper's primary contribution and the reader's retained mental model, not by section names or venue conventions.`
        : `Type confidence: ${classification.confidence}.`,
      `Omitted-section rule: ${profile.omittedHintEn}`,
      coverageAuditGate(language, profile),
      stageQualityGate(language, stage),
      commonEvidenceGate(language),
      stageInstruction
    ].join("\n");
  }

  const stageInstruction = stage === "root"
    ? "阶段：初始总述。输出全篇的一段有取舍的核心总述。"
    : stage === "omitted_section"
      ? "阶段：遗漏板块。解释这个未覆盖板块为什么会改变或补强上一层留下的核心印象。"
      : "阶段：正文选区。围绕选中的词句继续讲清楚，并保持和上一层术语、证据、用户提示的连贯性。";
  return [
    `初步论文类型：${profile.labelZh}（${inferredPaperType}）。JSON 中默认保持这一 paperType；只有本轮证据直接证明另一类型才是论文的主要贡献时才能修正，不能仅凭标题分类或一个熟悉术语改写类型。`,
    `paperType 只能取：${typeList}。`,
    `类型取舍：${profile.focusZh}`,
    `留存测试：${profile.retentionTestZh}`,
    "人工留存案例（只借鉴取舍模式，不复制文案）：",
    ...fewShotExamples.map((example) => `- ${example}`),
    classification.conflict && classification.runnerUp
      ? `类型冲突：${inferredPaperType} 与 ${classification.runnerUp.paperType} 分数接近。必须按论文的主要贡献和读者应留下的认知模型裁决，不能按章节名或发表场景机械选择。`
      : `类型判断置信度：${classification.confidence}。`,
    `遗漏板块规则：${profile.omittedHintZh}`,
    coverageAuditGate(language, profile),
    stageQualityGate(language, stage),
    commonEvidenceGate(language),
    stageInstruction
  ].join("\n");
}
