import type {
  ThinReadingAnchor,
  ThinReadingGenerationAudit,
  ThinReadingSummarySentence
} from "./thinReading.types";
import type { ThinReadingAnchorReference } from "./thinReadingAnchorReferences";

export type RankThinReadingAnchorsInput = {
  anchors: readonly ThinReadingAnchor[];
  audit?: ThinReadingGenerationAudit;
  referencesByAnchorId: ReadonlyMap<string, readonly ThinReadingAnchorReference[]>;
  summarySentences: readonly ThinReadingSummarySentence[];
};

const maximumAnchors = 8;
const maximumAnchorsPerSentence = 2;
const maximumEvidencePerAnchor = 4;
const maximumAttentionPerEvidence = 4;
const diversityScoreTolerance = 0.05;

const anchorKindReason: Record<ThinReadingAnchor["kind"], string> = {
  claim: "核心判断",
  concept: "核心概念",
  contribution: "核心贡献",
  limitation: "关键局限",
  mechanism: "核心机制",
  method: "核心方法",
  result: "关键结果"
};

function clampUnit(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function uniquePaperEvidenceIds(anchor: ThinReadingAnchor, sentence?: ThinReadingSummarySentence) {
  return [...new Set([
    ...anchor.evidenceIds,
    ...(sentence?.evidenceIds ?? [])
  ])];
}

function uniqueCoverageEvidenceIds(anchor: ThinReadingAnchor, sentence?: ThinReadingSummarySentence) {
  return [...new Set([
    ...anchor.evidenceIds,
    ...anchor.externalSourceIds,
    ...(sentence?.evidenceIds ?? []),
    ...(sentence?.externalKnowledge ?? [])
  ])];
}

function evidenceCoverage(sentence: ThinReadingSummarySentence | undefined, evidenceCount: number) {
  const statusFactor = sentence?.status === "grounded"
    ? 1
    : sentence?.status === "weak"
      ? 0.6
      : 0;
  return Math.min(evidenceCount, maximumEvidencePerAnchor) / maximumEvidencePerAnchor * statusFactor;
}

function auditedToolCalls(audit: ThinReadingGenerationAudit | undefined) {
  if (audit?.evidenceToolCalls) {
    return audit.evidenceToolCalls;
  }
  return audit?.evidenceLoop?.rounds.flatMap((round) => round.toolCalls) ?? [];
}

function attentionByEvidenceId(audit: ThinReadingGenerationAudit | undefined) {
  const attention = new Map<string, number>();
  for (const call of auditedToolCalls(audit)) {
    for (const evidenceId of new Set(call.evidenceIds)) {
      attention.set(
        evidenceId,
        Math.min(maximumAttentionPerEvidence, (attention.get(evidenceId) ?? 0) + 1)
      );
    }
  }
  return attention;
}

function reviewedSentenceIds(audit: ThinReadingGenerationAudit | undefined) {
  return new Set(audit?.evidenceReview?.propositionVerdicts?.map((item) => item.sentenceId) ?? []);
}

function compareDocumentPosition(
  left: ThinReadingAnchor,
  right: ThinReadingAnchor,
  sentencePosition: ReadonlyMap<string, number>
) {
  return (sentencePosition.get(left.summarySentenceId) ?? Number.MAX_SAFE_INTEGER) -
    (sentencePosition.get(right.summarySentenceId) ?? Number.MAX_SAFE_INTEGER) ||
    left.start - right.start ||
    left.end - right.end ||
    left.id.localeCompare(right.id);
}

function qualityReason(anchor: ThinReadingAnchor, evidenceCount: number, hasCitation: boolean) {
  const evidenceReason = evidenceCount > 0 ? `${evidenceCount} 条证据` : "无直接证据";
  return [
    anchorKindReason[anchor.kind],
    evidenceReason,
    ...(hasCitation ? ["原文有引用"] : [])
  ].join(" · ");
}

export function rankThinReadingAnchors(input: RankThinReadingAnchorsInput): ThinReadingAnchor[] {
  const sentenceById = new Map<string, ThinReadingSummarySentence>();
  const sentencePosition = new Map<string, number>();
  input.summarySentences.forEach((sentence, index) => {
    if (sentenceById.has(sentence.id)) return;
    sentenceById.set(sentence.id, sentence);
    sentencePosition.set(sentence.id, index);
  });
  const evidenceAttention = attentionByEvidenceId(input.audit);
  const reviewed = reviewedSentenceIds(input.audit);
  const candidates = input.anchors.map((anchor) => {
    const sentence = sentenceById.get(anchor.summarySentenceId);
    const paperEvidenceIds = uniquePaperEvidenceIds(anchor, sentence);
    const coverageEvidenceIds = uniqueCoverageEvidenceIds(anchor, sentence);
    const reviewAttention = reviewed.has(anchor.summarySentenceId) ? 1 : 0;
    const rawAttention = paperEvidenceIds.length === 0
      ? 0
      : paperEvidenceIds.reduce((total, evidenceId) => (
        total + Math.min(
          maximumAttentionPerEvidence,
          (evidenceAttention.get(evidenceId) ?? 0) + reviewAttention
        )
      ), 0) / paperEvidenceIds.length;
    return {
      anchor,
      citationProvenance: input.referencesByAnchorId.get(anchor.id)?.length ? 1 : 0,
      coverage: evidenceCoverage(sentence, coverageEvidenceIds.length),
      evidenceCount: coverageEvidenceIds.length,
      rawAttention
    };
  });
  const maximumPageAttention = Math.max(0, ...candidates.map((candidate) => candidate.rawAttention));
  const scored = candidates.map((candidate) => {
    const normalizedAttention = maximumPageAttention > 0
      ? candidate.rawAttention / maximumPageAttention
      : 0;
    const score =
      0.35 * clampUnit(candidate.anchor.importance) +
      0.25 * candidate.coverage +
      0.20 * normalizedAttention +
      0.20 * candidate.citationProvenance;
    return {
      ...candidate.anchor,
      quality: {
        citationProvenance: candidate.citationProvenance,
        evidenceAttention: normalizedAttention,
        evidenceCoverage: candidate.coverage,
        reason: qualityReason(
          candidate.anchor,
          candidate.evidenceCount,
          candidate.citationProvenance > 0
        ),
        score
      }
    };
  });
  const qualityOrder = [...scored].sort((left, right) =>
    right.quality.score - left.quality.score ||
    compareDocumentPosition(left, right, sentencePosition)
  );
  const uniqueQualityOrder = qualityOrder.filter((anchor, index) => (
    qualityOrder.findIndex((candidate) => candidate.id === anchor.id) === index
  ));
  const selected: ThinReadingAnchor[] = [];
  const selectedKinds = new Set<ThinReadingAnchor["kind"]>();
  const countBySentence = new Map<string, number>();
  const remaining = [...uniqueQualityOrder];
  while (selected.length < maximumAnchors) {
    const eligible = remaining.filter((anchor) => (
      (countBySentence.get(anchor.summarySentenceId) ?? 0) < maximumAnchorsPerSentence
    ));
    if (eligible.length === 0) break;
    const highestQuality = eligible[0];
    const qualityBand = eligible.filter((anchor) => (
      anchor.quality!.score >= highestQuality.quality!.score - diversityScoreTolerance
    ));
    const candidate = qualityBand.find((anchor) => !selectedKinds.has(anchor.kind)) ?? highestQuality;
    selected.push(candidate);
    selectedKinds.add(candidate.kind);
    countBySentence.set(
      candidate.summarySentenceId,
      (countBySentence.get(candidate.summarySentenceId) ?? 0) + 1
    );
    remaining.splice(remaining.findIndex((anchor) => anchor.id === candidate.id), 1);
  }
  return selected.sort((left, right) => compareDocumentPosition(left, right, sentencePosition));
}
