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
  ThinReadingIntuechoRecommendation,
  ThinReadingNodeSeed,
  ThinReadingPaperType,
  ThinReadingSectionToken
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
  withinPaperClosure: z.boolean()
}).strict();

type ParsedThinReadingModelOutput = z.infer<typeof thinReadingModelOutputSchema>;

type ParseThinReadingModelSeedOptions = {
  allowedEvidenceIds?: readonly string[];
  analysisEvidence?: readonly AnalysisEvidence[];
  analysis?: PreparedMultiPaperAnalysis;
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
  assertEvidenceReferences({
    allowedEvidenceIds,
    fieldName: "claims.evidenceIds",
    paperEvidence: parsed.claims.flatMap((claim) => claim.evidenceIds)
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
  const coverageGap = options.analysis?.run.coverage.missingPaperIds.length ?? 0;
  const retrievalConfidence = options.analysis?.retrievalConfidence;
  const hasInsufficientRetrieval = coverageGap > 0 ||
    (typeof retrievalConfidence === "number" && retrievalConfidence < 0.75);

  return {
    evidence: {
      claims,
      externalKnowledge: parsed.externalKnowledge,
      paperEvidence,
      paperEvidenceSpans
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
    "核心要求：",
    "- summary 写成一段自然文本，直指论文类型决定的重点，避免按章节平均概括。",
    "- paperType 必须填写最能解释当前取舍的论文类型；如果初步类型不准，可以修正，但只能使用允许值。",
    "- paperEvidence 只能填写下方 evidence ID 或含 evidence ID 的短说明；只列对 summary/claims 真正关键的证据，不要复制整张 evidence 矩阵。",
    "- claims 列出 summary 的关键判断；grounded claim 必须引用下方 evidence ID。",
    "- 继续深入时必须承接上一层关键判断与证据 span，说明本次深入如何细化、修正或补足上一层，而不是另起一个无关摘要。",
    "- externalKnowledge 只填写确实越出目标论文闭包的外部知识；没有则为空数组。",
    "- omittedSections 列出当前 summary 没覆盖、但值得继续深入的论文板块，数量随证据实际情况决定；label 必须是短按钮文案，中文不超过 12 字或英文不超过 6 个词。",
    "- recommendations 只是 Intuecho 本地待同步占位推荐线索，不要伪装成真实社区数据。",
    "- withinPaperClosure 为 false 时表示主要依赖外部知识。",
    "只返回 JSON，不要 Markdown，不要解释。JSON schema:",
    "{",
    '  "paperType": "experimental",',
    '  "summary": "string",',
    '  "withinPaperClosure": true,',
    '  "paperEvidence": ["evidence-id"],',
    '  "claims": [{"text": "claim text", "evidenceIds": ["evidence-id"], "status": "grounded"}],',
    '  "externalKnowledge": ["external source or concept"],',
    '  "omittedSections": [{"sectionKey": "method", "label": "方法"}],',
    '  "recommendations": [{"relationship": "方法与问题设定", "note": "本地待同步的理解线索", "compatibility": 0.78}]',
    "}",
    `可用 evidence ID：${evidenceIds || "无"}`,
    `证据矩阵：\n${input.prepared.evidencePrompt}`
  ].filter(Boolean).join("\n");
}
