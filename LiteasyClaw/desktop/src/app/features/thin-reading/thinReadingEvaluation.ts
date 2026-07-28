import type {
  ThinReadingNodeSeed,
  ThinReadingPaperType
} from "./thinReading.types";

export type ThinReadingGoldConcept = string | readonly string[];

export type ThinReadingGoldStandard = {
  expectedOmittedSectionKeys?: readonly string[];
  expectedWithinPaperClosure: boolean;
  id: string;
  paperType: ThinReadingPaperType;
  relevantEvidenceIds: readonly string[];
  requiredBranchConcepts?: readonly ThinReadingGoldConcept[];
  requiredParentContinuityConcepts?: readonly ThinReadingGoldConcept[];
  requiredSummaryConcepts: readonly ThinReadingGoldConcept[];
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
  | "closure_boundary_mismatch"
  | "language_inconsistent"
  | "omitted_section_recall_below_threshold"
  | "paper_type_mismatch"
  | "sentence_boundary_incomplete"
  | "summary_core_recall_below_threshold"
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
    closureBoundaryAccuracy: ThinReadingEvaluationMetric;
    languageConsistency: ThinReadingEvaluationMetric;
    omittedSectionRecall: ThinReadingEvaluationMetric;
    paperTypeAccuracy: ThinReadingEvaluationMetric;
    sentenceBoundaryCoverage: ThinReadingEvaluationMetric;
    summaryCoreRecall: ThinReadingEvaluationMetric;
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
  branchRelevance: 0.15,
  citationPrecision: 0.15,
  closureBoundaryAccuracy: 0.1,
  languageConsistency: 0.1,
  omittedSectionRecall: 0.1,
  paperTypeAccuracy: 0.1,
  sentenceBoundaryCoverage: 0.15,
  summaryCoreRecall: 0.15
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
  return metric(
    sentences.filter((sentence) => sentenceHasValidBoundary(sentence, availableEvidenceIds)).length,
    Math.max(1, sentences.length)
  );
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
  const citationPrecisionMetric = citationPrecision(candidate, gold.relevantEvidenceIds);
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
  const languageConsistencyMetric = languageConsistency(candidate.summary, gold.targetLanguage);
  const paperTypeAccuracy = metric(candidate.paperType === gold.paperType ? 1 : 0, 1);
  const unsupportedClaimRatioMetric = unsupportedClaimRatio(candidate);
  const issues: Array<{ code: ThinReadingEvaluationIssueCode; message: string }> = [];

  if (summaryCoreRecall.score < 0.8) {
    issues.push(issue("summary_core_recall_below_threshold", "总述核心概念命中率低于 0.80。"));
  }
  if (citationPrecisionMetric.score < 0.9) {
    issues.push(issue("citation_precision_below_threshold", "引用精度低于 0.90。"));
  }
  if (sentenceBoundaryCoverageMetric.score < 1) {
    issues.push(issue("sentence_boundary_incomplete", "存在没有合法来源边界的总述句。"));
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
  if (languageConsistencyMetric.score < 1) {
    issues.push(issue("language_inconsistent", "总述语言与目标语言不一致。"));
  }
  if (paperTypeAccuracy.score < 1) {
    issues.push(issue("paper_type_mismatch", "模型判断的论文类型与 gold 不一致。"));
  }
  if (unsupportedClaimRatioMetric.score > 0.2) {
    issues.push(issue("unsupported_claim_ratio_above_threshold", "unsupported claim/句子占比高于 0.20。"));
  }

  const metrics = {
    branchRelevance,
    citationPrecision: citationPrecisionMetric,
    closureBoundaryAccuracy: closureBoundaryAccuracyMetric,
    languageConsistency: languageConsistencyMetric,
    omittedSectionRecall: omittedSectionRecallMetric,
    paperTypeAccuracy,
    sentenceBoundaryCoverage: sentenceBoundaryCoverageMetric,
    summaryCoreRecall,
    unsupportedClaimRatio: unsupportedClaimRatioMetric
  };
  const overallScore = clamp01(
    summaryCoreRecall.score * metricWeights.summaryCoreRecall +
    citationPrecisionMetric.score * metricWeights.citationPrecision +
    sentenceBoundaryCoverageMetric.score * metricWeights.sentenceBoundaryCoverage +
    omittedSectionRecallMetric.score * metricWeights.omittedSectionRecall +
    branchRelevance.score * metricWeights.branchRelevance +
    closureBoundaryAccuracyMetric.score * metricWeights.closureBoundaryAccuracy +
    languageConsistencyMetric.score * metricWeights.languageConsistency +
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
