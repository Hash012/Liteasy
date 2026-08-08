import type {
  ThinReadingNodeSeed,
  ThinReadingPaperType,
  ThinReadingExternalSource
} from "./thinReading.types";

export type ThinReadingGoldConcept = string | readonly string[];

export type ThinReadingGoldEvidence = {
  evidenceId: string;
  page: number;
  quote: string;
};

export type ThinReadingGoldExternalSource = {
  id: string;
  relation: ThinReadingExternalSource["relation"];
};

export type ThinReadingGoldTerminology = {
  original: ThinReadingGoldConcept;
  translation: ThinReadingGoldConcept;
};

export type ThinReadingGoldStandard = {
  acceptablePaperTypes?: readonly ThinReadingPaperType[];
  expectedOmittedSectionKeys?: readonly string[];
  expectedExternalSources?: readonly ThinReadingGoldExternalSource[];
  expectedWithinPaperClosure: boolean;
  id: string;
  paperType: ThinReadingPaperType;
  requiredEvidence?: readonly ThinReadingGoldEvidence[];
  relevantEvidenceIds: readonly string[];
  requiredBranchConcepts?: readonly ThinReadingGoldConcept[];
  requiredParentContinuityConcepts?: readonly ThinReadingGoldConcept[];
  requiredRootOrientation?: {
    coreIdea: readonly ThinReadingGoldConcept[];
    fieldPosition: readonly ThinReadingGoldConcept[];
    paperPanorama: readonly ThinReadingGoldConcept[];
  };
  requiredSummaryConcepts: readonly ThinReadingGoldConcept[];
  requiredTerminology?: readonly ThinReadingGoldTerminology[];
  stage: "branch" | "root";
  targetLanguage: string;
};

export type ThinReadingEvaluationMetric = {
  earned: number;
  possible: number;
  score: number;
};

export type ThinReadingEvaluationIssueCode =
  | "branch_relevance_below_threshold"
  | "citation_precision_below_threshold"
  | "citation_recall_below_threshold"
  | "closure_boundary_mismatch"
  | "evidence_grounding_below_threshold"
  | "external_relation_misrepresented"
  | "external_source_mismatch"
  | "external_source_untraceable"
  | "language_inconsistent"
  | "omitted_section_recall_below_threshold"
  | "paper_type_mismatch"
  | "root_orientation_incomplete"
  | "sentence_boundary_incomplete"
  | "summary_core_recall_below_threshold"
  | "terminology_retention_below_threshold"
  | "unsupported_claim_ratio_above_threshold";

export type ThinReadingEvaluationReport = {
  goldId: string;
  issues: ReadonlyArray<{
    code: ThinReadingEvaluationIssueCode;
    message: string;
  }>;
  metrics: {
    branchRelevance: ThinReadingEvaluationMetric;
    citationPrecision: ThinReadingEvaluationMetric;
    citationRecall: ThinReadingEvaluationMetric;
    closureBoundaryAccuracy: ThinReadingEvaluationMetric;
    evidenceGrounding: ThinReadingEvaluationMetric;
    externalRelationFidelity: ThinReadingEvaluationMetric;
    externalSourceGoldMatch: ThinReadingEvaluationMetric;
    externalSourceTraceability: ThinReadingEvaluationMetric;
    languageConsistency: ThinReadingEvaluationMetric;
    omittedSectionRecall: ThinReadingEvaluationMetric;
    paperTypeAccuracy: ThinReadingEvaluationMetric;
    rootOrientationCoverage: ThinReadingEvaluationMetric;
    sentenceBoundaryCoverage: ThinReadingEvaluationMetric;
    summaryCoreRecall: ThinReadingEvaluationMetric;
    terminologyRetention: ThinReadingEvaluationMetric;
    unsupportedClaimRatio: ThinReadingEvaluationMetric;
  };
  overallScore: number;
  passed: boolean;
};

export type ThinReadingEvaluationSuiteReport = {
  averageScore: number;
  failedGoldIds: readonly string[];
  passed: boolean;
  reports: readonly ThinReadingEvaluationReport[];
};

const metricWeights = {
  branchRelevance: 0.1,
  citationPrecision: 0.06,
  citationRecall: 0.06,
  closureBoundaryAccuracy: 0.1,
  evidenceGrounding: 0.1,
  externalRelationFidelity: 0.05,
  externalSourceGoldMatch: 0.02,
  externalSourceTraceability: 0.03,
  languageConsistency: 0.05,
  omittedSectionRecall: 0.08,
  paperTypeAccuracy: 0.05,
  sentenceBoundaryCoverage: 0.15,
  summaryCoreRecall: 0.14,
  terminologyRetention: 0.05
} as const;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function metric(earned: number, possible: number): ThinReadingEvaluationMetric {
  return {
    earned,
    possible,
    score: possible === 0 ? 1 : clamp01(earned / possible)
  };
}

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

function matchesConcept(text: string, concept: ThinReadingGoldConcept) {
  const alternatives = typeof concept === "string" ? [concept] : concept;
  return alternatives.some((alternative) => {
    const normalized = normalizeText(alternative);
    return normalized.length > 0 && text.includes(normalized);
  });
}

function conceptRecall(text: string, concepts: readonly ThinReadingGoldConcept[] | undefined) {
  const expected = concepts ?? [];
  const normalizedText = normalizeText(text);
  return metric(
    expected.filter((concept) => matchesConcept(normalizedText, concept)).length,
    expected.length
  );
}

function rootOrientationCoverage(summary: string, gold: ThinReadingGoldStandard) {
  if (gold.stage !== "root" || !gold.requiredRootOrientation) {
    return metric(0, 0);
  }
  const dimensions = [
    gold.requiredRootOrientation.coreIdea,
    gold.requiredRootOrientation.paperPanorama,
    gold.requiredRootOrientation.fieldPosition
  ];
  const coveredDimensions = dimensions.filter((concepts) => (
    conceptRecall(summary, concepts).score >= 0.8
  )).length;
  return metric(coveredDimensions, dimensions.length);
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function referencedEvidenceIds(seed: ThinReadingNodeSeed) {
  return unique([
    ...seed.evidence.paperEvidence,
    ...(seed.evidence.claims ?? []).flatMap((claim) => claim.evidenceIds),
    ...(seed.evidence.summarySentences ?? []).flatMap((sentence) => sentence.evidenceIds)
  ]);
}

function citationPrecision(seed: ThinReadingNodeSeed, relevantEvidenceIds: readonly string[]) {
  const references = referencedEvidenceIds(seed);
  const relevant = new Set(relevantEvidenceIds);
  const possible = references.length > 0 ? references.length : relevantEvidenceIds.length > 0 ? 1 : 0;
  return metric(
    references.filter((evidenceId) => relevant.has(evidenceId)).length,
    possible
  );
}

function citationRecall(seed: ThinReadingNodeSeed, requiredEvidence: readonly ThinReadingGoldEvidence[] | undefined, relevantEvidenceIds: readonly string[]) {
  const required = unique(requiredEvidence?.map((evidence) => evidence.evidenceId) ?? relevantEvidenceIds);
  const references = new Set(referencedEvidenceIds(seed));
  return metric(
    required.filter((evidenceId) => references.has(evidenceId)).length,
    required.length
  );
}

function evidenceGrounding(
  seed: ThinReadingNodeSeed,
  requiredEvidence: readonly ThinReadingGoldEvidence[] | undefined
) {
  const required = requiredEvidence ?? [];
  const spans = seed.evidence.paperEvidenceSpans ?? [];
  return metric(
    required.filter((goldEvidence) => spans.some((span) => (
      span.id === goldEvidence.evidenceId &&
      span.page === goldEvidence.page &&
      quotesOverlap(span.quote, goldEvidence.quote)
    ))).length,
    required.length
  );
}

function quotesOverlap(left: string, right: string) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  return normalizedLeft.length > 0 && normalizedRight.length > 0 && (
    normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)
  );
}

function sentenceHasValidBoundary(
  sentence: NonNullable<ThinReadingNodeSeed["evidence"]["summarySentences"]>[number],
  availableEvidenceIds: ReadonlySet<string>
) {
  if (sentence.status === "grounded") {
    return sentence.evidenceIds.length > 0 &&
      sentence.evidenceIds.every((evidenceId) => availableEvidenceIds.has(evidenceId)) &&
      sentence.externalKnowledge.length === 0;
  }
  if (sentence.status === "weak") {
    return sentence.evidenceIds.some((evidenceId) => availableEvidenceIds.has(evidenceId)) ||
      sentence.externalKnowledge.length > 0;
  }
  return sentence.evidenceIds.length === 0 && sentence.externalKnowledge.length === 0;
}

function sentenceBoundaryCoverage(seed: ThinReadingNodeSeed) {
  const sentences = seed.evidence.summarySentences ?? [];
  const availableEvidenceIds = new Set(
    (seed.evidence.paperEvidenceSpans ?? []).map((span) => span.id)
  );
  const validBoundaryCoverage = metric(
    sentences.filter((sentence) => sentenceHasValidBoundary(sentence, availableEvidenceIds)).length,
    Math.max(1, sentences.length)
  );
  const normalizedSummary = normalizeSentenceTraceText(seed.summary);
  let cursor = 0;
  let tracedSummaryLength = 0;
  for (const sentence of sentences) {
    const normalizedSentence = normalizeSentenceTraceText(sentence.text);
    if (!normalizedSentence) {
      continue;
    }
    const index = normalizedSummary.indexOf(normalizedSentence, cursor);
    if (index < 0) {
      continue;
    }
    cursor = index + normalizedSentence.length;
    tracedSummaryLength += normalizedSentence.length;
  }
  const textCoverage = metric(
    Math.min(tracedSummaryLength, normalizedSummary.length),
    Math.max(1, normalizedSummary.length)
  );
  return metric(
    validBoundaryCoverage.score * textCoverage.score,
    1
  );
}

function normalizeSentenceTraceText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}

function omittedSectionRecall(seed: ThinReadingNodeSeed, expectedKeys: readonly string[] | undefined) {
  const expected = unique(expectedKeys ?? []);
  const actual = new Set(seed.omittedSections.map((section) => normalizeText(section.sectionKey)));
  return metric(
    expected.filter((sectionKey) => actual.has(normalizeText(sectionKey))).length,
    expected.length
  );
}

function languageConsistency(summary: string, targetLanguage: string) {
  const content = summary.replace(/[\s\p{P}\p{S}\d]/gu, "");
  if (!content) {
    return metric(0, 1);
  }
  const hanCount = (content.match(/\p{Script=Han}/gu) ?? []).length;
  const hanRatio = hanCount / content.length;
  const expectsEnglish = targetLanguage.trim().toLowerCase().startsWith("en");
  const consistent = expectsEnglish ? hanRatio <= 0.02 : hanRatio >= 0.12;
  return metric(consistent ? 1 : 0, 1);
}

function terminologyRetention(
  summary: string,
  terminology: readonly ThinReadingGoldTerminology[] | undefined,
  targetLanguage: string
) {
  const expected = terminology ?? [];
  const normalizedSummary = normalizeText(summary);
  const requiresInlineGloss = targetLanguage.trim().toLowerCase().startsWith("zh");
  return metric(
    expected.filter((term) => {
      const originals = typeof term.original === "string" ? [term.original] : term.original;
      const translations = typeof term.translation === "string" ? [term.translation] : term.translation;
      if (!requiresInlineGloss) {
        return originals.some((original) => normalizeText(original).length > 0 && matchesConcept(normalizedSummary, original)) &&
          translations.some((translation) => normalizeText(translation).length > 0 && matchesConcept(normalizedSummary, translation));
      }
      return originals.some((original) => translations.some((translation) => (
        hasInlineTerminologyGloss(summary, original, translation)
      )));
    }).length,
    expected.length
  );
}

function hasInlineTerminologyGloss(summary: string, original: string, translation: string) {
  const originalPattern = terminologyPattern(original);
  const translationPattern = terminologyPattern(translation);
  if (!originalPattern || !translationPattern) {
    return false;
  }
  return new RegExp(
    `${originalPattern}\\s*[（(]\\s*${translationPattern}\\s*[）)]`,
    "iu"
  ).test(summary.normalize("NFKC"));
}

function terminologyPattern(value: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) {
    return "";
  }
  return normalized
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
}

function unsupportedClaimRatio(seed: ThinReadingNodeSeed) {
  const claims = seed.evidence.claims ?? [];
  const sentences = seed.evidence.summarySentences ?? [];
  const total = claims.length + sentences.length;
  const unsupported = claims.filter((claim) => claim.status === "unsupported").length +
    sentences.filter((sentence) => sentence.status === "unsupported").length;
  return total === 0
    ? { earned: 0, possible: 0, score: 0 }
    : metric(unsupported, total);
}

function closureBoundaryAccuracy(seed: ThinReadingNodeSeed, expectedWithinPaperClosure: boolean) {
  const hasExternalKnowledge = seed.evidence.externalKnowledge.length > 0 ||
    (seed.evidence.summarySentences ?? []).some((sentence) => sentence.externalKnowledge.length > 0);
  const stateMatches = seed.withinPaperClosure === expectedWithinPaperClosure;
  const sourceBoundaryMatches = seed.withinPaperClosure ? !hasExternalKnowledge : true;
  return metric(stateMatches && sourceBoundaryMatches ? 1 : 0, 1);
}

function hasTraceableExternalSource(source: NonNullable<ThinReadingNodeSeed["evidence"]["externalSources"]>[number]) {
  const validRelations = new Set([
    "cited_by_target",
    "cites_target",
    "related",
    "topic_search"
  ]);
  try {
    const paperUrl = new URL(source.url);
    const recordUrl = new URL(source.sourceRecordUrl);
    const hasSharedFields = source.title.trim().length > 0 &&
      source.retrievalQuery.trim().length > 0 &&
      validRelations.has(source.relation) &&
      paperUrl.protocol === "https:" &&
      recordUrl.protocol === "https:";
    const isOpenAlex = source.provider === "openalex" &&
      source.id === `openalex:${source.sourceId}` &&
      /^W\d+$/i.test(source.sourceId) &&
      recordUrl.hostname === "openalex.org" &&
      recordUrl.pathname === `/${source.sourceId}`;
    const crossrefDoi = source.sourceId.trim().toLowerCase();
    const isCrossref = source.provider === "crossref" &&
      /^[^\s/]+\/[^\s]+$/.test(crossrefDoi) &&
      source.id === `crossref:${crossrefDoi}` &&
      source.doi === `https://doi.org/${crossrefDoi}` &&
      source.url === `https://doi.org/${crossrefDoi}` &&
      source.relation === "topic_search" &&
      recordUrl.hostname === "api.crossref.org" &&
      recordUrl.pathname === `/works/${encodeURIComponent(crossrefDoi)}`;
    return hasSharedFields && (isOpenAlex || isCrossref);
  } catch {
    return false;
  }
}

function externalSourceTraceability(seed: ThinReadingNodeSeed) {
  const references = unique([
    ...seed.evidence.externalKnowledge,
    ...(seed.evidence.summarySentences ?? []).flatMap((sentence) => sentence.externalKnowledge)
  ]);
  if (seed.withinPaperClosure) {
    return metric(references.length === 0 ? 1 : 0, 1);
  }
  const sources = new Map((seed.evidence.externalSources ?? []).map((source) => [source.id, source]));
  return metric(
    references.filter((sourceId) => {
      const source = sources.get(sourceId);
      return source !== undefined && hasTraceableExternalSource(source);
    }).length,
    Math.max(1, references.length)
  );
}

function externalSourceGoldMatch(
  seed: ThinReadingNodeSeed,
  expectedSources: readonly ThinReadingGoldExternalSource[] | undefined
) {
  const expected = expectedSources ?? [];
  if (expected.length === 0) {
    return metric(1, 1);
  }
  const referencedIds = new Set(unique([
    ...seed.evidence.externalKnowledge,
    ...(seed.evidence.summarySentences ?? []).flatMap((sentence) => sentence.externalKnowledge)
  ]));
  const sourcesById = new Map((seed.evidence.externalSources ?? []).map((source) => [source.id, source]));
  return metric(
    expected.filter((expectedSource) => {
      const source = sourcesById.get(expectedSource.id);
      return referencedIds.has(expectedSource.id) && source?.relation === expectedSource.relation;
    }).length,
    expected.length
  );
}

function hasUnqualifiedCitationClaim(text: string) {
  const citationPattern = /引用关系|引文图|引用了|被引用|citation(?:\s+graph|\s+relationship)?|cites?|cited\s+by/giu;
  for (const match of text.matchAll(citationPattern)) {
    const prefix = text.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
    if (!/(?:不能|不可|不是|并非|不得|not)\s*[^。！？!?]{0,20}$/iu.test(prefix)) {
      return true;
    }
  }
  return false;
}

function externalRelationFidelity(seed: ThinReadingNodeSeed) {
  const sources = seed.evidence.externalSources ?? [];
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const sentences = seed.evidence.summarySentences ?? [];
  const sentenceMisrepresentsRelation = sentences.some((sentence) => {
    const citedSources = sentence.externalKnowledge
      .map((sourceId) => sourcesById.get(sourceId))
      .filter((source): source is NonNullable<typeof source> => Boolean(source));
    return citedSources.length > 0 &&
      citedSources.every((source) => source.relation !== "cited_by_target" && source.relation !== "cites_target") &&
      hasUnqualifiedCitationClaim(sentence.text);
  });
  const hasVerifiedCitationRelation = sources.some((source) =>
    source.relation === "cited_by_target" || source.relation === "cites_target"
  );
  const claimMisrepresentsRelation = !hasVerifiedCitationRelation &&
    hasUnqualifiedCitationClaim((seed.evidence.claims ?? []).map((claim) => claim.text).join(" "));
  return metric(sentenceMisrepresentsRelation || claimMisrepresentsRelation ? 0 : 1, 1);
}

function issue(
  code: ThinReadingEvaluationIssueCode,
  message: string
) {
  return { code, message };
}

export function evaluateThinReadingGoldCase(input: {
  candidate: ThinReadingNodeSeed;
  gold: ThinReadingGoldStandard;
}): ThinReadingEvaluationReport {
  const { candidate, gold } = input;
  const summaryCoreRecall = conceptRecall(candidate.summary, gold.requiredSummaryConcepts);
  const rootOrientationCoverageMetric = rootOrientationCoverage(candidate.summary, gold);
  const citationPrecisionMetric = citationPrecision(candidate, gold.relevantEvidenceIds);
  const citationRecallMetric = citationRecall(candidate, gold.requiredEvidence, gold.relevantEvidenceIds);
  const evidenceGroundingMetric = evidenceGrounding(candidate, gold.requiredEvidence);
  const sentenceBoundaryCoverageMetric = sentenceBoundaryCoverage(candidate);
  const omittedSectionRecallMetric = omittedSectionRecall(candidate, gold.expectedOmittedSectionKeys);
  const branchText = [
    candidate.summary,
    ...(candidate.evidence.claims ?? []).map((claim) => claim.text)
  ].join(" ");
  const branchRelevance = gold.stage === "branch"
    ? conceptRecall(branchText, [
        ...(gold.requiredBranchConcepts ?? []),
        ...(gold.requiredParentContinuityConcepts ?? [])
      ])
    : metric(0, 0);
  const closureBoundaryAccuracyMetric = closureBoundaryAccuracy(
    candidate,
    gold.expectedWithinPaperClosure
  );
  const externalSourceTraceabilityMetric = externalSourceTraceability(candidate);
  const externalSourceGoldMatchMetric = externalSourceGoldMatch(candidate, gold.expectedExternalSources);
  const externalRelationFidelityMetric = externalRelationFidelity(candidate);
  const languageConsistencyMetric = languageConsistency(candidate.summary, gold.targetLanguage);
  const terminologyRetentionMetric = terminologyRetention(
    candidate.summary,
    gold.requiredTerminology,
    gold.targetLanguage
  );
  const acceptedPaperTypes = gold.acceptablePaperTypes?.length
    ? gold.acceptablePaperTypes
    : [gold.paperType];
  const paperTypeAccuracy = metric(
    candidate.paperType !== undefined && acceptedPaperTypes.includes(candidate.paperType) ? 1 : 0,
    1
  );
  const unsupportedClaimRatioMetric = unsupportedClaimRatio(candidate);
  const issues: Array<{ code: ThinReadingEvaluationIssueCode; message: string }> = [];

  if (summaryCoreRecall.score < 0.8) {
    issues.push(issue("summary_core_recall_below_threshold", "总述核心概念命中率低于 0.80。"));
  }
  if (rootOrientationCoverageMetric.score < 1) {
    issues.push(issue("root_orientation_incomplete", "根级总述没有同时建立核心思想、论文全景和有证据的领域位置。"));
  }
  if (citationPrecisionMetric.score < 0.9) {
    issues.push(issue("citation_precision_below_threshold", "引用精度低于 0.90。"));
  }
  if (citationRecallMetric.score < 0.9) {
    issues.push(issue("citation_recall_below_threshold", "必要论文证据的引用召回率低于 0.90。"));
  }
  if (evidenceGroundingMetric.score < 1) {
    issues.push(issue("evidence_grounding_below_threshold", "证据 span 未能回溯到 gold PDF 的页码和原文片段。"));
  }
  if (sentenceBoundaryCoverageMetric.score < 1) {
    issues.push(issue("sentence_boundary_incomplete", "总述句缺少合法来源边界，或句级映射未完整覆盖显示正文。"));
  }
  if (omittedSectionRecallMetric.score < 0.5) {
    issues.push(issue("omitted_section_recall_below_threshold", "关键遗漏板块召回率低于 0.50。"));
  }
  if (gold.stage === "branch" && branchRelevance.score < 0.8) {
    issues.push(issue("branch_relevance_below_threshold", "下钻没有充分承接选区目标和上一层主轴。"));
  }
  if (closureBoundaryAccuracyMetric.score < 1) {
    issues.push(issue("closure_boundary_mismatch", "论文闭包状态或外部知识边界与 gold 不一致。"));
  }
  if (externalSourceTraceabilityMetric.score < 1) {
    issues.push(issue("external_source_untraceable", "外部知识未逐一映射到可追溯的 OpenAlex 来源。"));
  }
  if (externalSourceGoldMatchMetric.score < 1) {
    issues.push(issue("external_source_mismatch", "外部来源未匹配 gold 中已核验的来源身份或关系。"));
  }
  if (externalRelationFidelityMetric.score < 1) {
    issues.push(issue("external_relation_misrepresented", "仅主题检索命中被错误表述为已验证的引用关系。"));
  }
  if (languageConsistencyMetric.score < 1) {
    issues.push(issue("language_inconsistent", "总述语言与目标语言不一致。"));
  }
  if (terminologyRetentionMetric.score < 1) {
    issues.push(issue("terminology_retention_below_threshold", "关键术语未以原文（目标语言释义）的紧邻形式保留。"));
  }
  if (paperTypeAccuracy.score < 1) {
    issues.push(issue("paper_type_mismatch", "模型判断的论文类型不在 gold 允许的类型集合中。"));
  }
  if (unsupportedClaimRatioMetric.score > 0.2) {
    issues.push(issue("unsupported_claim_ratio_above_threshold", "unsupported claim/句子占比高于 0.20。"));
  }

  const metrics = {
    branchRelevance,
    citationPrecision: citationPrecisionMetric,
    citationRecall: citationRecallMetric,
    closureBoundaryAccuracy: closureBoundaryAccuracyMetric,
    evidenceGrounding: evidenceGroundingMetric,
    externalRelationFidelity: externalRelationFidelityMetric,
    externalSourceGoldMatch: externalSourceGoldMatchMetric,
    externalSourceTraceability: externalSourceTraceabilityMetric,
    languageConsistency: languageConsistencyMetric,
    omittedSectionRecall: omittedSectionRecallMetric,
    paperTypeAccuracy,
    rootOrientationCoverage: rootOrientationCoverageMetric,
    sentenceBoundaryCoverage: sentenceBoundaryCoverageMetric,
    summaryCoreRecall,
    terminologyRetention: terminologyRetentionMetric,
    unsupportedClaimRatio: unsupportedClaimRatioMetric
  };
  const overallScore = clamp01(
    summaryCoreRecall.score * metricWeights.summaryCoreRecall +
    citationPrecisionMetric.score * metricWeights.citationPrecision +
    citationRecallMetric.score * metricWeights.citationRecall +
    evidenceGroundingMetric.score * metricWeights.evidenceGrounding +
    sentenceBoundaryCoverageMetric.score * metricWeights.sentenceBoundaryCoverage +
    omittedSectionRecallMetric.score * metricWeights.omittedSectionRecall +
    branchRelevance.score * metricWeights.branchRelevance +
    closureBoundaryAccuracyMetric.score * metricWeights.closureBoundaryAccuracy +
    externalRelationFidelityMetric.score * metricWeights.externalRelationFidelity +
    externalSourceGoldMatchMetric.score * metricWeights.externalSourceGoldMatch +
    externalSourceTraceabilityMetric.score * metricWeights.externalSourceTraceability +
    languageConsistencyMetric.score * metricWeights.languageConsistency +
    terminologyRetentionMetric.score * metricWeights.terminologyRetention +
    paperTypeAccuracy.score * metricWeights.paperTypeAccuracy
  );

  return {
    goldId: gold.id,
    issues,
    metrics,
    overallScore,
    passed: issues.length === 0 && overallScore >= 0.85
  };
}

export function evaluateThinReadingSuite(
  cases: ReadonlyArray<{ candidate: ThinReadingNodeSeed; gold: ThinReadingGoldStandard }>
): ThinReadingEvaluationSuiteReport {
  const reports = cases.map(evaluateThinReadingGoldCase);
  const averageScore = reports.length === 0
    ? 0
    : reports.reduce((sum, report) => sum + report.overallScore, 0) / reports.length;
  const failedGoldIds = reports.filter((report) => !report.passed).map((report) => report.goldId);
  return {
    averageScore,
    failedGoldIds,
    passed: reports.length > 0 && failedGoldIds.length === 0 && averageScore >= 0.9,
    reports
  };
}
