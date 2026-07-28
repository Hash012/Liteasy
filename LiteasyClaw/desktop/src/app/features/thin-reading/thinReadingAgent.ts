import type {
  AnalysisEvidence,
  PreparedMultiPaperAnalysis
} from "../paper-analysis/analysis.types";
import { z } from "zod";
import { buildThinReadingPromptGuidance } from "./thinReadingPromptRegistry";
import type {
  ThinReadingGenerationContext,
  ThinReadingClaim,
  ThinReadingEvidenceSpan,
  ThinReadingExternalSource,
  ThinReadingIntuechoRecommendation,
  ThinReadingNodeSeed,
  ThinReadingPaperType,
  ThinReadingSectionToken,
  ThinReadingSummarySentence
} from "./thinReading.types";

function stableHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stripMarkdownFence(value: string) {
  return value
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function extractJsonObject(value: string) {
  const stripped = stripMarkdownFence(value);
  if (stripped.startsWith("{") && stripped.endsWith("}")) {
    return stripped;
  }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  return start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
}

function normalizeString(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedStringSchema(input: {
  maximumLength: number;
  minimumLength?: number;
}) {
  const minimumLength = input.minimumLength ?? 1;
  return z.string()
    .transform(normalizeString)
    .refine(
      (value) => value.length >= minimumLength && value.length <= input.maximumLength,
      `must be ${minimumLength}-${input.maximumLength} characters after trimming`
    );
}

const thinReadingPaperTypeSchema = z.enum([
  "benchmark",
  "dataset",
  "experimental",
  "humanities",
  "position",
  "survey",
  "systems",
  "theoretical",
  "unknown"
] satisfies [ThinReadingPaperType, ...ThinReadingPaperType[]]);

const thinReadingModelOutputSchema = z.object({
  claims: z.array(z.object({
    evidenceIds: z.array(normalizedStringSchema({ maximumLength: 120 })).default([]),
    status: z.enum(["grounded", "unsupported", "weak"]).default("weak"),
    text: normalizedStringSchema({ maximumLength: 320, minimumLength: 8 })
  }).strict()).default([]),
  externalKnowledge: z.array(normalizedStringSchema({ maximumLength: 180 })).max(8).default([]),
  omittedSections: z.array(z.object({
    label: normalizedStringSchema({ maximumLength: 96 }),
    sectionKey: normalizedStringSchema({ maximumLength: 96 })
  }).strict()).default([]),
  paperEvidence: z.array(normalizedStringSchema({ maximumLength: 160 })).default([]),
  paperType: thinReadingPaperTypeSchema.default("unknown"),
  recommendations: z.array(z.object({
    compatibility: z.number().min(0).max(1).default(0.5),
    note: normalizedStringSchema({ maximumLength: 180 }),
    relationship: normalizedStringSchema({ maximumLength: 42 })
  }).strict()).max(6).default([]),
  summary: normalizedStringSchema({ maximumLength: 1200, minimumLength: 24 }),
  summarySentences: z.array(z.object({
    evidenceIds: z.array(normalizedStringSchema({ maximumLength: 120 })).default([]),
    externalKnowledge: z.array(normalizedStringSchema({ maximumLength: 180 })).default([]),
    status: z.enum(["grounded", "unsupported", "weak"]).default("weak"),
    text: normalizedStringSchema({ maximumLength: 420, minimumLength: 2 })
  }).strict()).default([]),
  withinPaperClosure: z.boolean()
}).strict();

type ParsedThinReadingModelOutput = z.infer<typeof thinReadingModelOutputSchema>;

type ParseThinReadingModelSeedOptions = {
  allowedEvidenceIds?: readonly string[];
  analysisEvidence?: readonly AnalysisEvidence[];
  analysis?: PreparedMultiPaperAnalysis;
  externalSources?: readonly ThinReadingExternalSource[];
};

function normalizeSectionToken(value: ParsedThinReadingModelOutput["omittedSections"][number]): ThinReadingSectionToken | null {
  const label = normalizeSectionLabel(value.label);
  const keySource = value.sectionKey || label;
  const sectionKey = keySource
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u3400-\u9fff]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!label || !sectionKey) {
    return null;
  }
  return {
    id: `section-${stableHash(`${sectionKey}\u0000${label}`)}`,
    label,
    sectionKey
  };
}

function normalizeSectionLabel(value: string, maximumLength = 48) {
  const normalized = normalizeString(value);
  const withoutBracketDetail = normalizeString(
    normalized
      .replace(/（[^）]*）/g, "")
      .replace(/\([^)]*\)/g, "")
  );
  const compacted = withoutBracketDetail.length > 0
    ? withoutBracketDetail
    : normalized;
  if (Array.from(compacted).length <= maximumLength) {
    return compacted;
  }
  const primarySegment = compacted.split(/[,:;，：；]/)[0]?.trim() ?? compacted;
  if (primarySegment.length > 0 && Array.from(primarySegment).length <= maximumLength) {
    return primarySegment;
  }
  const suffix = "...";
  return `${Array.from(compacted).slice(0, maximumLength - suffix.length).join("")}${suffix}`;
}

function normalizeRecommendation(value: ParsedThinReadingModelOutput["recommendations"][number]): ThinReadingIntuechoRecommendation {
  return {
    compatibility: Number(value.compatibility.toFixed(2)),
    id: `intuecho-${stableHash(`${value.relationship}\u0000${value.note}`)}`,
    note: value.note,
    relationship: value.relationship
  };
}

function formatZodIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 4)
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "root";
      return `${path}: ${issue.message}`;
    })
    .join("；");
}

function referencesAllowedEvidenceId(value: string, allowedEvidenceIds: readonly string[]) {
  if (allowedEvidenceIds.length === 0) {
    return true;
  }
  return allowedEvidenceIds.some((evidenceId) => value === evidenceId || value.includes(evidenceId));
}

function evidenceIdForReference(value: string, allowedEvidenceIds: readonly string[]) {
  return allowedEvidenceIds.find((evidenceId) => value === evidenceId || value.includes(evidenceId));
}

function evidenceIdsForReference(value: string, allowedEvidenceIds: readonly string[]) {
  return allowedEvidenceIds.filter((evidenceId) => value === evidenceId || value.includes(evidenceId));
}

function normalizeEvidenceReferences(
  values: readonly string[],
  allowedEvidenceIds: readonly string[]
) {
  if (allowedEvidenceIds.length === 0) {
    return [...new Set(values.map(normalizeString).filter(Boolean))];
  }
  return [...new Set(values.flatMap((value) => evidenceIdsForReference(value, allowedEvidenceIds)))];
}

function assertEvidenceReferences(input: {
  allowedEvidenceIds: readonly string[];
  fieldName?: string;
  paperEvidence: readonly string[];
}) {
  const invalid = input.paperEvidence.filter(
    (evidence) => !referencesAllowedEvidenceId(evidence, input.allowedEvidenceIds)
  );
  if (invalid.length > 0) {
    throw new Error(
      `薄读 Agent 返回格式无效：${input.fieldName ?? "paperEvidence"} 引用了不可用的 evidence ID：${invalid.join("；")}。`
    );
  }
}

function assertExternalSourceReferences(input: {
  allowedSourceIds: readonly string[];
  references: readonly string[];
}) {
  const invalid = input.references.filter((reference) => !input.allowedSourceIds.includes(reference));
  if (invalid.length > 0) {
    throw new Error(
      `薄读 Agent 返回格式无效：引用了本轮检索中不存在的 external source ID：${invalid.join("；")}。`
    );
  }
}

function normalizeQuote(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildEvidenceSpans(input: {
  analysisEvidence: readonly AnalysisEvidence[];
  paperEvidence: readonly string[];
}): ThinReadingEvidenceSpan[] {
  const allowedIds = input.analysisEvidence.map((item) => item.id);
  const evidenceById = new Map(input.analysisEvidence.map((item) => [item.id, item]));
  const referencedIds = normalizeEvidenceReferences(input.paperEvidence, allowedIds);
  return referencedIds.flatMap((evidenceId) => {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) {
      return [];
    }
    return [{
      chunkId: evidence.chunkId,
      confidence: evidence.relevance,
      id: evidence.id,
      normalizedQuote: normalizeQuote(evidence.quote),
      page: evidence.page,
      paperId: evidence.paperId,
      quote: evidence.quote
    }];
  });
}

function normalizeClaimEvidenceIds(
  values: readonly string[],
  availableEvidenceIds: readonly string[]
) {
  return normalizeEvidenceReferences(values, availableEvidenceIds);
}

function buildClaims(input: {
  availableEvidenceIds: readonly string[];
  parsed: ParsedThinReadingModelOutput;
}): ThinReadingClaim[] {
  const claims = input.parsed.claims.flatMap((claim) => {
    const evidenceIds = normalizeClaimEvidenceIds(claim.evidenceIds, input.availableEvidenceIds);
    if (claim.status === "grounded" && evidenceIds.length === 0) {
      return [];
    }
    const status = evidenceIds.length > 0
      ? claim.status === "unsupported" ? "weak" : claim.status
      : claim.status;
    return [{
      evidenceIds,
      id: `thin-reading-claim-${stableHash(`${claim.text}\u0000${evidenceIds.join("\u0000")}`)}`,
      status,
      text: claim.text
    }];
  });
  if (claims.length > 0) {
    return claims;
  }
  const paperEvidenceIds = normalizeClaimEvidenceIds(
    input.parsed.paperEvidence,
    input.availableEvidenceIds
  );
  return [{
    evidenceIds: paperEvidenceIds,
    id: `thin-reading-claim-${stableHash(`${input.parsed.summary}\u0000${paperEvidenceIds.join("\u0000")}`)}`,
    status: paperEvidenceIds.length > 0
      ? "grounded"
      : input.parsed.externalKnowledge.length > 0
        ? "weak"
        : "unsupported",
    text: input.parsed.summary
  }];
}

function splitSummarySentences(summary: string) {
  const matches = normalizeString(summary).match(/[^。！？!?]+[。！？!?]?/g) ?? [];
  const sentences = matches.map(normalizeString).filter(Boolean);
  return sentences.length > 0 ? sentences : [normalizeString(summary)].filter(Boolean);
}

function normalizeSentenceForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[。！？!?.,;:，；：]+$/g, "")
    .trim();
}

function modelSentencesTrackSummary(input: {
  summary: string;
  sentences: readonly ThinReadingSummarySentence[];
}) {
  const summary = normalizeSentenceForMatch(input.summary);
  if (!summary || input.sentences.length === 0) {
    return false;
  }
  let cursor = 0;
  let matchedLength = 0;
  for (const sentence of input.sentences) {
    const needle = normalizeSentenceForMatch(sentence.text);
    if (!needle) {
      return false;
    }
    const index = summary.indexOf(needle, cursor);
    if (index < 0) {
      return false;
    }
    cursor = index + needle.length;
    matchedLength += needle.length;
  }
  return matchedLength / summary.length >= 0.72;
}

function tokenizeForOverlap(value: string) {
  const normalized = value.toLowerCase();
  const words = normalized.match(/[a-z0-9][a-z0-9\-_/]*|[\u3400-\u9fff]/g) ?? [];
  return new Set(words.filter((word) => word.length > 0));
}

function lexicalOverlapScore(left: string, right: string) {
  const leftTokens = tokenizeForOverlap(left);
  const rightTokens = tokenizeForOverlap(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  });
  return shared / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function bestClaimForSentence(
  sentence: string,
  claims: readonly ThinReadingClaim[]
) {
  let best: { claim: ThinReadingClaim; score: number } | null = null;
  for (const claim of claims) {
    const score = lexicalOverlapScore(sentence, claim.text);
    if (!best || score > best.score) {
      best = { claim, score };
    }
  }
  return best && best.score >= 0.18 ? best.claim : null;
}

function normalizeSummarySentenceStatus(input: {
  evidenceIds: readonly string[];
  externalKnowledge: readonly string[];
  status: "grounded" | "unsupported" | "weak";
}) {
  if (input.evidenceIds.length > 0) {
    return input.status === "unsupported" ? "weak" : input.status;
  }
  if (input.externalKnowledge.length > 0) {
    return input.status === "grounded" ? "weak" : input.status;
  }
  return "unsupported";
}

function buildSummarySentences(input: {
  allowedEvidenceIds: readonly string[];
  allowedExternalSourceIds: readonly string[];
  claims: readonly ThinReadingClaim[];
  parsed: ParsedThinReadingModelOutput;
  paperEvidence: readonly string[];
}): ThinReadingSummarySentence[] {
  const modelSentences = input.parsed.summarySentences.flatMap((sentence) => {
    const evidenceIds = normalizeEvidenceReferences(sentence.evidenceIds, input.allowedEvidenceIds);
    const externalKnowledge = [...new Set(
      sentence.externalKnowledge
        .map(normalizeString)
        .filter((sourceId) => input.allowedExternalSourceIds.includes(sourceId))
    )];
    if (!sentence.text) {
      return [];
    }
    return [{
      evidenceIds,
      externalKnowledge,
      id: `thin-reading-sentence-${stableHash(`${sentence.text}\u0000${evidenceIds.join("\u0000")}\u0000${externalKnowledge.join("\u0000")}`)}`,
      status: normalizeSummarySentenceStatus({
        evidenceIds,
        externalKnowledge,
        status: sentence.status
      }),
      text: sentence.text
    }];
  });
  if (modelSentences.length > 0 && modelSentencesTrackSummary({
    sentences: modelSentences,
    summary: input.parsed.summary
  })) {
    return modelSentences;
  }

  return splitSummarySentences(input.parsed.summary).map((sentence) => {
    const bestClaim = bestClaimForSentence(sentence, input.claims);
    const evidenceIds = bestClaim?.evidenceIds.length
      ? bestClaim.evidenceIds
      : input.paperEvidence.slice(0, 2);
    const externalKnowledge = evidenceIds.length > 0
      ? []
      : input.parsed.externalKnowledge
          .filter((sourceId) => input.allowedExternalSourceIds.includes(sourceId))
          .slice(0, 2);
    return {
      evidenceIds,
      externalKnowledge,
      id: `thin-reading-sentence-${stableHash(`${sentence}\u0000${evidenceIds.join("\u0000")}\u0000${externalKnowledge.join("\u0000")}`)}`,
      status: normalizeSummarySentenceStatus({
        evidenceIds,
        externalKnowledge,
        status: bestClaim?.status ?? "weak"
      }),
      text: sentence
    };
  });
}

export function parseThinReadingModelSeed(
  output: string,
  options: ParseThinReadingModelSeedOptions = {}
): ThinReadingNodeSeed {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJsonObject(output));
  } catch {
    throw new Error("薄读 Agent 返回格式无效：没有返回可解析的 JSON。");
  }

  const parsedResult = thinReadingModelOutputSchema.safeParse(raw);
  if (!parsedResult.success) {
    throw new Error(`薄读 Agent 返回格式无效：${formatZodIssues(parsedResult.error)}。`);
  }

  const parsed = parsedResult.data;
  const externalSources = options.externalSources ?? [];
  const allowedExternalSourceIds = externalSources.map((source) => source.id);
  const analysisEvidence = options.analysis?.evidence ?? options.analysisEvidence ?? [];
  const allowedEvidenceIds = options.allowedEvidenceIds ??
    analysisEvidence.map((item) => item.id) ??
    [];
  if (parsed.paperEvidence.length === 0 && parsed.externalKnowledge.length === 0) {
    throw new Error("薄读 Agent 返回格式无效：缺少论文内证据或外部知识来源标记。");
  }
  assertEvidenceReferences({
    allowedEvidenceIds,
    fieldName: "paperEvidence",
    paperEvidence: parsed.paperEvidence
  });
  assertExternalSourceReferences({
    allowedSourceIds: allowedExternalSourceIds,
    references: [
      ...parsed.externalKnowledge,
      ...parsed.summarySentences.flatMap((sentence) => sentence.externalKnowledge)
    ]
  });
  assertEvidenceReferences({
    allowedEvidenceIds,
    fieldName: "claims.evidenceIds",
    paperEvidence: parsed.claims.flatMap((claim) => claim.evidenceIds)
  });
  assertEvidenceReferences({
    allowedEvidenceIds,
    fieldName: "summarySentences.evidenceIds",
    paperEvidence: parsed.summarySentences.flatMap((sentence) => sentence.evidenceIds)
  });
  const paperEvidence = normalizeEvidenceReferences(parsed.paperEvidence, allowedEvidenceIds);
  const paperEvidenceSpans = buildEvidenceSpans({
    analysisEvidence,
    paperEvidence
  });
  const claims = buildClaims({
    availableEvidenceIds: allowedEvidenceIds,
    parsed
  });
  const summarySentences = buildSummarySentences({
    allowedEvidenceIds,
    allowedExternalSourceIds,
    claims,
    parsed,
    paperEvidence
  });
  const coverageGap = options.analysis?.run.coverage.missingPaperIds.length ?? 0;
  const retrievalConfidence = options.analysis?.retrievalConfidence;
  const hasInsufficientRetrieval = coverageGap > 0 ||
    (typeof retrievalConfidence === "number" && retrievalConfidence < 0.75);

  return {
    evidence: {
      claims,
      externalKnowledge: parsed.externalKnowledge,
      externalSources,
      paperEvidence,
      paperEvidenceSpans,
      summarySentences
    },
    omittedSections: parsed.omittedSections
      .map(normalizeSectionToken)
      .filter((item): item is ThinReadingSectionToken => Boolean(item)),
    paperType: parsed.paperType,
    recommendations: parsed.recommendations.map(normalizeRecommendation),
    summary: parsed.summary,
    withinPaperClosure: parsed.withinPaperClosure === false
      ? false
      : parsed.externalKnowledge.length === 0 && !hasInsufficientRetrieval
  };
}

export function resolveThinReadingTargetLanguage(value: string | undefined, systemLanguage?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "system" || normalized === "follow-system") {
    const system = (systemLanguage ?? globalThis.navigator?.language ?? "zh-CN").toLowerCase();
    return system.startsWith("en") ? "en-US" : "zh-CN";
  }
  if (normalized.startsWith("en")) {
    return "en-US";
  }
  return "zh-CN";
}

function languageInstruction(targetLanguage: string) {
  const normalized = targetLanguage.toLowerCase();
  if (normalized.startsWith("en")) {
    return "Write in English. Keep key paper terms in their original form.";
  }
  return "使用中文输出；关键术语保留原文，并用中文括注。";
}

function sourceInstruction(context: ThinReadingGenerationContext) {
  if (context.source.kind === "root_overview") {
    return [
      "任务：生成薄读初始总述。",
      "总述不是平均摘要，要先判断论文类型，再只呈现读者读完后脑中最应留下的主轴。"
    ].join("\n");
  }
  if (context.source.kind === "omitted_section") {
    return [
      `任务：针对上一层遗漏板块继续深入：${context.source.label}。`,
      `板块键：${context.source.sectionKey}。`
    ].join("\n");
  }
  return [
    `任务：针对用户选中的薄读文本继续深入：${context.source.excerpt}。`,
    context.source.prompt ? `用户补充提示：${context.source.prompt}。` : ""
  ].filter(Boolean).join("\n");
}

function truncatePromptText(value: string, maximumLength: number) {
  const normalized = normalizeString(value);
  return normalized.length > maximumLength
    ? `${normalized.slice(0, maximumLength)}...`
    : normalized;
}

function formatParentClaims(claims: readonly ThinReadingClaim[] | undefined) {
  const visibleClaims = claims?.slice(0, 6) ?? [];
  if (visibleClaims.length === 0) {
    return "";
  }
  return [
    "上一层关键判断（用于保持深入连续性；不能替代本轮 evidence 引用）：",
    ...visibleClaims.map((claim) => {
      const evidenceIds = claim.evidenceIds.length > 0 ? claim.evidenceIds.join(", ") : "无";
      return `- ${claim.id} [${claim.status}] evidence=${evidenceIds}：${truncatePromptText(claim.text, 180)}`;
    })
  ].join("\n");
}

function formatParentEvidenceSpans(spans: readonly ThinReadingEvidenceSpan[] | undefined) {
  const visibleSpans = spans?.slice(0, 8) ?? [];
  if (visibleSpans.length === 0) {
    return "";
  }
  return [
    "上一层论文内证据 span（用于判断本次深入应继承或细化的证据边界；本轮输出仍只能引用下方可用 evidence ID）：",
    ...visibleSpans.map((span) => {
      const page = typeof span.page === "number" ? ` p.${span.page}` : "";
      const chunk = span.chunkId ? ` chunk=${span.chunkId}` : "";
      return `- ${span.id}${page}${chunk} confidence=${span.confidence} quote="${truncatePromptText(span.quote, 220)}"`;
    })
  ].join("\n");
}

function formatExternalSources(sources: readonly ThinReadingExternalSource[] | undefined) {
  if (!sources || sources.length === 0) {
    return "本轮没有检索外部来源；externalKnowledge 必须为空数组，不得依赖模型常识补写论文外事实。";
  }
  return [
    "本轮允许引用的外部来源（externalKnowledge 只能填写下列 source ID）：",
    ...sources.map((source) => {
      const authors = source.authors.slice(0, 4).join(", ") || "unknown authors";
      const year = source.year ? ` (${source.year})` : "";
      const abstract = source.abstract ? ` abstract=\"${truncatePromptText(source.abstract, 420)}\"` : " abstract unavailable";
      return `- ${source.id}: ${source.title}${year}; authors=${authors}; url=${source.url}; relevance=${source.relevance}.${abstract}`;
    })
  ].join("\n");
}

export function buildThinReadingAgentPrompt(input: {
  context: ThinReadingGenerationContext;
  prepared: PreparedMultiPaperAnalysis;
}) {
  const selectedPaper = input.context.primaryPaperTitle ?? input.prepared.evidence[0]?.paperTitle ?? "当前论文";
  const evidenceIds = input.prepared.evidence.map((item) => item.id).join(", ");
  const promptGuidance = buildThinReadingPromptGuidance({
    context: input.context,
    evidencePrompt: input.prepared.evidencePrompt,
    selectedPaperTitle: selectedPaper
  });
  return [
    "你是 Liteasy 薄读 Agent。必须基于给定论文 evidence 工作，不得伪造来源。",
    languageInstruction(input.context.targetLanguage),
    promptGuidance,
    sourceInstruction(input.context),
    `目标论文：${selectedPaper}`,
    input.context.parentTitle ? `上一层标题：${input.context.parentTitle}` : "",
    input.context.parentSummary ? `上一层文本：${input.context.parentSummary}` : "",
    formatParentClaims(input.context.parentClaims),
    formatParentEvidenceSpans(input.context.parentEvidenceSpans),
    formatExternalSources(input.context.externalSources),
    "内部工作流（只在脑中执行，不要输出这些步骤）：",
    "1. Context assembly：先识别当前层级、目标论文、选区/遗漏板块、父节点 claim/evidence。",
    "2. Evidence sieve：从证据矩阵中选出最能改变读者理解的 evidence ID，区分主张、机制、结果、局限和背景。",
    "3. Retention compression：用论文类型决定读者读后最该留下的 1-3 个核心印象，丢弃平均章节摘要。",
    "4. Skeptical audit：逐句检查是否有本轮 evidence ID、本轮允许的 external source ID 或 unsupported；不合格则改写。",
    "5. Drilldown planning：omittedSections 只放真正值得继续读且本段没有覆盖的入口，不设置固定按钮。",
    "核心要求：",
    "- summary 写成一段自然文本，直指论文类型决定的重点，避免按章节平均概括。",
    "- summary 必须通过“读后留存测试”：读者只记住这一段，也能复述论文最关键的贡献/论证/边界。",
    "- summary 不要堆术语；每个关键术语都要说明它在论文机制、证据链或知识地图中的作用。",
    "- summary 中每个内容性句子都必须能追溯到论文内 evidence ID 或本轮允许的 external source ID；不要写没有来源边界的句子。",
    "- summarySentences 必须按 summary 句子顺序逐句列出 text、evidenceIds、externalKnowledge 和 status；text 必须原样对应 summary 中的句子，不能写解释性改写。",
    "- paperType 必须填写最能解释当前取舍的论文类型；如果初步类型不准，可以修正，但只能使用允许值。",
    "- paperEvidence 只能填写下方 evidence ID 或含 evidence ID 的短说明；只列对 summary/claims 真正关键的证据，不要复制整张 evidence 矩阵。",
    "- claims 列出 summary 的关键判断；grounded claim 必须引用下方 evidence ID。",
    "- 继续深入时必须承接上一层关键判断与证据 span，说明本次深入如何细化、修正或补足上一层，而不是另起一个无关摘要。",
    "- externalKnowledge 不是自由文本，只能填写上方本轮允许引用的 external source ID；没有可用外部来源则必须为空数组。",
    "- omittedSections 列出当前 summary 没覆盖、但值得继续深入的论文板块，数量随证据实际情况决定；label 必须是短按钮文案，中文不超过 12 字或英文不超过 6 个词。",
    "- recommendations 只是 Intuecho 本地待同步占位推荐线索，不要伪装成真实社区数据。",
    "- withinPaperClosure 为 false 时表示主要依赖外部知识。",
    "只返回 JSON，不要 Markdown，不要解释。JSON schema:",
    "{",
    '  "paperType": "experimental",',
    '  "summary": "string",',
    '  "summarySentences": [{"text": "summary sentence", "evidenceIds": ["evidence-id"], "externalKnowledge": [], "status": "grounded"}],',
    '  "withinPaperClosure": true,',
    '  "paperEvidence": ["evidence-id"],',
    '  "claims": [{"text": "claim text", "evidenceIds": ["evidence-id"], "status": "grounded"}],',
    '  "externalKnowledge": ["openalex:W123456789"],',
    '  "omittedSections": [{"sectionKey": "method", "label": "方法"}],',
    '  "recommendations": [{"relationship": "方法与问题设定", "note": "本地待同步的理解线索", "compatibility": 0.78}]',
    "}",
    `可用 evidence ID：${evidenceIds || "无"}`,
    `证据矩阵：\n${input.prepared.evidencePrompt}`
  ].filter(Boolean).join("\n");
}
