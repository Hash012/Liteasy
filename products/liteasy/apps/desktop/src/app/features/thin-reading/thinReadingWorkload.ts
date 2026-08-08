import type {
  ThinReadingContextAudit,
  ThinReadingGenerationContext,
  ThinReadingRequestedOutput,
  ThinReadingWorkloadAudit
} from "./thinReading.types";

function normalizedText(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function estimateThinReadingTokens(value: string) {
  const normalized = normalizedText(value);
  const han = normalized.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const other = Math.max(0, normalized.length - han);
  return Math.ceil(han / 1.6 + other / 4);
}

function sourceFocus(context: ThinReadingGenerationContext) {
  if (context.source.kind === "selected_text") {
    return `${context.source.excerpt} ${context.source.prompt ?? ""}`;
  }
  if (context.source.kind === "omitted_section") {
    return `${context.source.label} ${context.source.sectionKey}`;
  }
  return context.prompt ?? context.primaryPaperTitle ?? "";
}

function terms(value: string) {
  return new Set(
    value.toLocaleLowerCase().match(/[a-z][a-z0-9-]{2,}|[\u3400-\u9fff]{2,}/g) ?? []
  );
}

function overlapScore(value: string, focusTerms: ReadonlySet<string>) {
  const valueTerms = terms(value);
  let score = 0;
  focusTerms.forEach((term) => {
    if (valueTerms.has(term) || [...valueTerms].some((candidate) => (
      candidate.includes(term) || term.includes(candidate)
    ))) {
      score += 1;
    }
  });
  return score;
}

function truncate(value: string | undefined, limit: number) {
  const normalized = normalizedText(value);
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

export function compactThinReadingContext(
  context: ThinReadingGenerationContext,
  tokenBudget: number
): { audit: ThinReadingContextAudit; context: ThinReadingGenerationContext } {
  const focusTerms = terms(sourceFocus(context));
  const ancestors = context.ancestorSummaries ?? [];
  const ancestorLimit = tokenBudget >= 8_000 ? 8 : tokenBudget >= 6_000 ? 6 : 4;
  const selectedAncestorIds = new Set(
    ancestors
      .map((ancestor, index) => ({
        ancestor,
        index,
        score: overlapScore(`${ancestor.title} ${ancestor.summary}`, focusTerms) +
          (index >= ancestors.length - 2 ? 2 : 0)
      }))
      .sort((left, right) => right.score - left.score || right.index - left.index)
      .slice(0, ancestorLimit)
      .map(({ ancestor }) => ancestor.nodeId)
  );
  const compactAncestors = ancestors
    .filter((ancestor) => selectedAncestorIds.has(ancestor.nodeId))
    .map((ancestor) => ({
      ...ancestor,
      summary: truncate(ancestor.summary, 520),
      title: truncate(ancestor.title, 120)
    }));
  const claimLimit = tokenBudget >= 8_000 ? 6 : 4;
  const evidenceLimit = tokenBudget >= 8_000 ? 8 : 6;
  const parentClaims = context.parentClaims?.slice(0, claimLimit);
  const parentEvidenceSpans = context.parentEvidenceSpans?.slice(0, evidenceLimit).map((span) => ({
    ...span,
    quote: truncate(span.quote, 700)
  }));
  const externalSources = context.externalSources?.slice(0, 8).map((source) => ({
    ...source,
    abstract: truncate(source.abstract, 520),
    authors: source.authors.slice(0, 4),
    fullTextEvidence: source.fullTextEvidence?.slice(0, 2).map((evidence) => ({
      ...evidence,
      quote: truncate(evidence.quote, 650)
    })),
    retrievalQueries: source.retrievalQueries?.slice(0, 3)
  }));
  const compactContext: ThinReadingGenerationContext = {
    ...context,
    ancestorSummaries: compactAncestors,
    availableFigures: context.availableFigures?.slice(0, 12).map((figure) => ({
      ...figure,
      description: figure.description ? truncate(figure.description, 220) : undefined,
      title: truncate(figure.title, 120)
    })),
    externalSources,
    parentClaims,
    parentEvidenceSpans,
    parentSummary: context.parentSummary ? truncate(context.parentSummary, 1_200) : undefined,
    selectedExternalSources: context.selectedExternalSources?.slice(0, 4).map((source) => ({
      ...source,
      abstract: truncate(source.abstract, 520),
      authors: source.authors.slice(0, 4),
      fullTextEvidence: source.fullTextEvidence?.slice(0, 2).map((evidence) => ({
        ...evidence,
        quote: truncate(evidence.quote, 650)
      }))
    }))
  };
  const estimatedTokens = estimateThinReadingTokens(JSON.stringify(compactContext));
  return {
    audit: {
      droppedAncestors: Math.max(0, ancestors.length - compactAncestors.length),
      droppedClaims: Math.max(0, (context.parentClaims?.length ?? 0) - (parentClaims?.length ?? 0)),
      droppedEvidenceSpans: Math.max(
        0,
        (context.parentEvidenceSpans?.length ?? 0) - (parentEvidenceSpans?.length ?? 0)
      ),
      estimatedTokens,
      tokenBudget
    },
    context: compactContext
  };
}

export function planThinReadingWorkload(input: {
  depth: number;
  evidenceCharacters: number;
  evidenceCount: number;
  externalSourceCount?: number;
  figureCount?: number;
  requestedOutput?: ThinReadingRequestedOutput;
}): ThinReadingWorkloadAudit {
  const externalSourceCount = input.externalSourceCount ?? 0;
  const figureCount = input.figureCount ?? 0;
  const isLarge = input.evidenceCount > 28 || input.evidenceCharacters > 60_000 ||
    (input.depth >= 3 && input.evidenceCount > 20);
  if (isLarge) {
    return {
      contextBudgetTokens: 9_000,
      evidenceCharacters: input.evidenceCharacters,
      evidenceCount: input.evidenceCount,
      maxConcurrency: 2,
      plannedSubagents: [
        "evidence_planner",
        "evidence_observer",
        "relationship_mapper",
        "visual_editor",
        "evidence_reviewer"
      ],
      reason: "证据矩阵较大，先并行提取关系与视觉方案，再由主 Agent 在证据白名单内综合。",
      strategy: "parallel"
    };
  }
  const needsGuidance = input.evidenceCount >= 13 || input.evidenceCharacters > 28_000 ||
    externalSourceCount > 0 || figureCount > 4 || input.requestedOutput === "html_demo";
  if (needsGuidance) {
    const plannedSubagents = input.evidenceCount >= 13
      ? ["evidence_planner", "evidence_observer", "evidence_reviewer"]
      : ["evidence_reviewer"];
    return {
      contextBudgetTokens: 7_000,
      evidenceCharacters: input.evidenceCharacters,
      evidenceCount: input.evidenceCount,
      maxConcurrency: 1,
      plannedSubagents,
      reason: "任务需要证据筛选或视觉产物，使用有界规划与复核 Subagent。",
      strategy: "guided"
    };
  }
  return {
    contextBudgetTokens: 5_200,
    evidenceCharacters: input.evidenceCharacters,
    evidenceCount: input.evidenceCount,
    maxConcurrency: 0,
    plannedSubagents: [],
    reason: "上下文较小且目标单一，由薄读主 Agent 直接完成。",
    strategy: "direct"
  };
}
