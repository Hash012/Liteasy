import { parseVisualizationArtifact } from "../visualization/visualizationArtifact.schema";
import type {
  ThinReadingDocument,
  ThinReadingDocumentV1,
  ThinReadingDocumentV2,
  ThinReadingNodeV2
} from "./thinReading.types";
import type { DeepDiveTargetV1 } from "../visualization/visualizationArtifact.types";
import { isDeepDiveTargetBoundToNode } from "./thinReadingDeepDiveTarget";

const v1DocumentVersion = "liteasy.thin-reading/v1";
const v2DocumentVersion = "liteasy.thin-reading/v2";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBoundedStringArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number
): value is string[] {
  return isStringArray(value) && value.length <= maximumItems &&
    value.every((item) => item.trim().length > 0 && item.length <= maximumLength);
}

function isPersistedIntentWeights(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  const weights = [value.how, value.what, value.why];
  return weights.every((weight) => typeof weight === "number" && Number.isFinite(weight) && weight >= 0 && weight <= 1) &&
    Math.abs((value.how as number) + (value.what as number) + (value.why as number) - 1) <= 0.011;
}

const persistedPaperTypes = new Set([
  "benchmark",
  "dataset",
  "experimental",
  "humanities",
  "position",
  "survey",
  "systems",
  "theoretical",
  "unknown"
]);

const persistedLearningGoals = new Set([
  "conclusion_support",
  "core_conclusion",
  "core_idea",
  "field_position",
  "paper_panorama",
  "parent_continuity",
  "selected_focus"
]);

const persistedConclusionSupportKinds = new Set([
  "boundary",
  "comparison",
  "derivation",
  "experiment",
  "material",
  "mechanism"
]);

function isPersistedContentQualityReview(value: unknown, sentenceIds: ReadonlySet<string>) {
  if (value === null || value === undefined) {
    return true;
  }
  if (!isRecord(value) ||
    (value.verdict !== "pass" && value.verdict !== "revise") ||
    (value.severity !== "none" && value.severity !== "advisory" && value.severity !== "blocking") ||
    (value.intentAlignment !== "aligned" && value.intentAlignment !== "diluted" && value.intentAlignment !== "misaligned") ||
    (value.logicChain !== "complete" && value.logicChain !== "partial" && value.logicChain !== "broken") ||
    (value.depthFit !== "appropriate" && value.depthFit !== "shallow" && value.depthFit !== "overextended") ||
    (value.focus !== "focused" && value.focus !== "diffuse") ||
    typeof value.reason !== "string" || value.reason.trim().length === 0 || value.reason.length > 420 ||
    !isBoundedStringArray(value.revisionSentenceIds, 16, 160) ||
    !value.revisionSentenceIds.every((id) => sentenceIds.has(id))) {
    return false;
  }
  const allDimensionsPass = value.intentAlignment === "aligned" &&
    value.logicChain === "complete" && value.depthFit === "appropriate" && value.focus === "focused";
  return value.verdict === "pass"
    ? allDimensionsPass && value.severity === "none" && value.revisionSentenceIds.length === 0
    : !allDimensionsPass && value.severity !== "none" && value.revisionSentenceIds.length > 0;
}

function isPersistedAnswerObligations(value: unknown, status: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8 || !value.every((item) => {
    if (!isRecord(item) || typeof item.obligation !== "string" || item.obligation.trim().length < 2 ||
      item.obligation.length > 180 ||
      (item.paperCoverage !== "complete" && item.paperCoverage !== "partial" && item.paperCoverage !== "none") ||
      typeof item.reason !== "string" || item.reason.trim().length < 8 || item.reason.length > 300) {
      return false;
    }
    if (item.paperEvidenceIds === undefined) return true;
    if (!isBoundedStringArray(item.paperEvidenceIds, 12, 160) ||
      new Set(item.paperEvidenceIds).size !== item.paperEvidenceIds.length) {
      return false;
    }
    return item.paperCoverage === "none"
      ? item.paperEvidenceIds.length === 0
      : item.paperEvidenceIds.length > 0;
  })) {
    return false;
  }
  const derivedStatus = value.every((item) => isRecord(item) && item.paperCoverage === "complete")
    ? "complete"
    : value.every((item) => isRecord(item) && item.paperCoverage === "none")
      ? "none"
      : "partial";
  return status === derivedStatus;
}

function isPersistedRootOrientationReview(value: unknown, sentenceIds: ReadonlySet<string>) {
  if (value === null || value === undefined) return true;
  if (!isRecord(value) || value.verdict !== "pass" ||
    (value.coreIdea !== "covered" && value.coreIdea !== "missing") ||
    (value.fieldPosition !== "covered" && value.fieldPosition !== "evidence_unavailable" &&
      value.fieldPosition !== "missing") ||
    (value.paperPanorama !== "covered" && value.paperPanorama !== "missing") ||
    (typeof value.paperType !== "string" || !persistedPaperTypes.has(value.paperType)) ||
    (value.paperTypeVerdict !== "ambiguous" && value.paperTypeVerdict !== "mismatch" &&
      value.paperTypeVerdict !== "supported") ||
    (value.retentionVerdict !== "focused" && value.retentionVerdict !== "unfocused") ||
    typeof value.reason !== "string" || value.reason.trim().length === 0 || value.reason.length > 420 ||
    !isRecord(value.conclusionSupport)) {
    return false;
  }
  const conclusionSupport = value.conclusionSupport;
  if ((conclusionSupport.status !== "complete" && conclusionSupport.status !== "missing" &&
      conclusionSupport.status !== "partial") ||
    typeof conclusionSupport.reason !== "string" || conclusionSupport.reason.trim().length < 8 ||
    conclusionSupport.reason.length > 420 || !Array.isArray(conclusionSupport.chains) ||
    conclusionSupport.chains.length > 4) {
    return false;
  }
  const chainsAreValid = conclusionSupport.chains.every((chain) => {
    if (!isRecord(chain) || typeof chain.conclusionSentenceId !== "string" ||
      !sentenceIds.has(chain.conclusionSentenceId) || typeof chain.reason !== "string" ||
      chain.reason.trim().length < 8 || chain.reason.length > 300 ||
      (chain.verdict !== "complete" && chain.verdict !== "partial") ||
      !isBoundedStringArray(chain.supportKinds, 6, 40) || chain.supportKinds.length < 1 ||
      new Set(chain.supportKinds).size !== chain.supportKinds.length ||
      !chain.supportKinds.every((kind) => persistedConclusionSupportKinds.has(kind)) ||
      !isBoundedStringArray(chain.supportSentenceIds, 16, 160) ||
      chain.supportSentenceIds.length < 1 ||
      new Set(chain.supportSentenceIds).size !== chain.supportSentenceIds.length ||
      !chain.supportSentenceIds.every((id) => sentenceIds.has(id))) {
      return false;
    }
    return true;
  });
  if (!chainsAreValid) return false;
  const derivedStatus = conclusionSupport.chains.length === 0
    ? "missing"
    : conclusionSupport.chains.every((chain) => isRecord(chain) && chain.verdict === "complete")
      ? "complete"
      : "partial";
  if (conclusionSupport.status !== derivedStatus ||
    value.paperPanorama !== (derivedStatus === "complete" ? "covered" : "missing")) {
    return false;
  }
  return value.coreIdea === "covered" && derivedStatus === "complete" &&
    value.fieldPosition !== "missing" && value.paperTypeVerdict !== "mismatch" &&
    value.retentionVerdict === "focused";
}

function isPersistedPropositionVerdicts(value: unknown, sentenceIds: ReadonlySet<string>) {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length < 1 || value.length > 48 || !value.every((item) => (
    isRecord(item) && typeof item.proposition === "string" &&
    item.proposition.trim().length >= 2 && item.proposition.length <= 300 &&
    typeof item.sentenceId === "string" && sentenceIds.has(item.sentenceId) &&
    item.verdict === "supported"
  ))) {
    return false;
  }
  const reviewedSentenceIds = new Set(value.flatMap((item) => (
    isRecord(item) && typeof item.sentenceId === "string" ? [item.sentenceId] : []
  )));
  return [...sentenceIds].every((id) => reviewedSentenceIds.has(id));
}

function isPersistedPaperEvidenceRecovery(value: unknown) {
  if (!isRecord(value) ||
    !isBoundedStringArray(value.initialEvidenceIds, 18, 160) ||
    !isBoundedStringArray(value.addedEvidenceIds, 6, 160) ||
    !isBoundedStringArray(value.answerObligations, 8, 180) ||
    (value.finalAnswerability !== "complete" && value.finalAnswerability !== "partial" &&
      value.finalAnswerability !== "none") ||
    (value.status !== "exhausted" && value.status !== "no_candidates" && value.status !== "resolved")) {
    return false;
  }
  const allEvidenceIds = [...value.initialEvidenceIds, ...value.addedEvidenceIds];
  if (new Set(value.initialEvidenceIds).size !== value.initialEvidenceIds.length ||
    new Set(value.addedEvidenceIds).size !== value.addedEvidenceIds.length ||
    new Set(allEvidenceIds).size !== allEvidenceIds.length ||
    !allEvidenceIds.every((id) => /^evidence-[A-Za-z0-9-]{1,150}$/.test(id))) {
    return false;
  }
  if (value.status === "no_candidates") {
    return value.addedEvidenceIds.length === 0 && value.finalAnswerability !== "complete";
  }
  if (value.status === "resolved") {
    return value.addedEvidenceIds.length > 0 && value.finalAnswerability === "complete";
  }
  return value.addedEvidenceIds.length > 0 && value.finalAnswerability !== "complete";
}

function isPersistedEvidencePlanningCounts(value: unknown) {
  return isRecord(value) && [
    value.focus,
    value.pageRequests,
    value.searchQueries,
    value.selectedEvidenceIds
  ].every((count) => typeof count === "number" && Number.isInteger(count) && count >= 0);
}

function isPersistedEvidencePlanningAudit(value: unknown) {
  if (!isRecord(value) ||
    (value.mode !== "model" && value.mode !== "deterministic_fallback") ||
    typeof value.repairApplied !== "boolean" ||
    !isStringArray(value.selectedEvidenceIds) || value.selectedEvidenceIds.length < 1 ||
    value.selectedEvidenceIds.length > 18 ||
    new Set(value.selectedEvidenceIds).size !== value.selectedEvidenceIds.length ||
    !value.selectedEvidenceIds.every((id) => /^evidence-[A-Za-z0-9-]{1,150}$/.test(id)) ||
    (value.reason !== undefined && value.reason !== "format_invalid" &&
      value.reason !== "transport_unavailable" && value.reason !== "unavailable_evidence_id")) {
    return false;
  }
  if (value.mode === "model" && value.reason !== undefined) return false;
  if (value.mode === "deterministic_fallback" && value.reason === undefined) return false;
  if (value.normalization === undefined) return true;
  return isRecord(value.normalization) &&
    isPersistedEvidencePlanningCounts(value.normalization.deduplicated) &&
    isPersistedEvidencePlanningCounts(value.normalization.truncated);
}

function isHttpsUrl(value: unknown) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function hasUniqueOptionalStringArray(value: Record<string, unknown>, key: string) {
  const items = value[key];
  return items === undefined || (isStringArray(items) && new Set(items).size === items.length);
}

function isPersistedDeepDiveTarget(value: unknown): value is DeepDiveTargetV1 {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.nodeId !== "string") return false;
  if (value.kind === "generated_object") {
    return typeof value.artifactId === "string" && value.artifactId.trim().length > 0 &&
      typeof value.objectId === "string" && value.objectId.trim().length > 0 &&
      isStringArray(value.objectPath) && value.objectPath.length > 0 &&
      isStringArray(value.evidenceClaimIds) && value.evidenceClaimIds.length > 0;
  }
  if (value.kind === "source_figure") {
    return typeof value.sourceFigureId === "string" && value.sourceFigureId.trim().length > 0 &&
      isStringArray(value.evidenceIds) && value.evidenceIds.length > 0;
  }
  if (value.kind !== "source_region" || typeof value.sourceFigureId !== "string" ||
      !isStringArray(value.evidenceIds) || value.evidenceIds.length === 0 || !isRecord(value.bbox) ||
      !isRecord(value.sourcePixelSize)) return false;
  const bbox = value.bbox as Record<string, unknown>;
  const pixels = value.sourcePixelSize as Record<string, unknown>;
  const x = bbox.x;
  const y = bbox.y;
  const width = bbox.width;
  const height = bbox.height;
  const pixelWidth = pixels.width;
  const pixelHeight = pixels.height;
  return [x, y, width, height].every((item) => typeof item === "number" && Number.isFinite(item)) &&
    typeof pixelWidth === "number" && Number.isFinite(pixelWidth) && pixelWidth > 0 &&
    typeof pixelHeight === "number" && Number.isFinite(pixelHeight) && pixelHeight > 0 &&
    (x as number) >= 0 && (y as number) >= 0 && (width as number) > 0 && (height as number) > 0 &&
    (x as number) + (width as number) <= 1 && (y as number) + (height as number) <= 1;
}

function equalStringArrays(left: unknown, right: unknown) {
  if (left === undefined && right === undefined) {
    return true;
  }
  return isStringArray(left) && isStringArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function isPersistedThinReadingNodeSource(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }
  if (value.kind === "root_overview") {
    return true;
  }
  if (value.kind === "omitted_section") {
    return typeof value.label === "string" && value.label.trim().length > 0 &&
      typeof value.sectionKey === "string" && value.sectionKey.trim().length > 0;
  }
  if (value.kind === "visualization_target") {
    return isPersistedDeepDiveTarget(value.target);
  }
  const expectedOutput = value.quickCommand === "mermaid_causal"
    ? "mermaid"
    : value.quickCommand === "html_algorithm_animation" || value.quickCommand === "html_svg_structure"
      ? "html_demo"
      : value.quickCommand === "visualize_flow" || value.quickCommand === "visualize_process" ||
          value.quickCommand === "visualize_structure"
        ? "visualization_intent"
        : undefined;
  return value.kind === "selected_text" &&
    typeof value.excerpt === "string" && value.excerpt.trim().length > 0 &&
    (value.prompt === undefined || typeof value.prompt === "string") &&
    (value.quickCommand === undefined || value.quickCommand === "html_algorithm_animation" ||
      value.quickCommand === "html_svg_structure" || value.quickCommand === "mermaid_causal" ||
      value.quickCommand === "visualize_flow" || value.quickCommand === "visualize_process" ||
      value.quickCommand === "visualize_structure") &&
    (value.requestedOutput === undefined || value.requestedOutput === "explanation" ||
      value.requestedOutput === "html_demo" || value.requestedOutput === "mermaid" ||
      value.requestedOutput === "visualization_intent") &&
    (expectedOutput === undefined || value.requestedOutput === expectedOutput) &&
    hasUniqueOptionalStringArray(value, "evidenceIds") &&
    hasUniqueOptionalStringArray(value, "externalSourceIds");
}

function isPersistedRecommendationScope(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }
  if (value.kind === "whole_paper") {
    return value.paperId === undefined || typeof value.paperId === "string";
  }
  if (value.kind === "section") {
    return (value.paperId === undefined || typeof value.paperId === "string") &&
      typeof value.sectionKey === "string" && value.sectionKey.trim().length > 0;
  }
  return value.kind === "selected_passage" &&
    (value.paperId === undefined || typeof value.paperId === "string") &&
    typeof value.excerpt === "string" && value.excerpt.trim().length > 0 &&
    hasUniqueOptionalStringArray(value, "evidenceIds") &&
    hasUniqueOptionalStringArray(value, "externalSourceIds");
}

function scopeMatchesPersistedNodeSource(scope: unknown, source: unknown) {
  if (!isPersistedRecommendationScope(scope) || !isPersistedThinReadingNodeSource(source)) {
    return false;
  }
  if (source.kind === "root_overview") {
    return scope.kind === "whole_paper";
  }
  if (source.kind === "omitted_section") {
      return scope.kind === "section" && scope.sectionKey === source.sectionKey;
  }
  if (source.kind === "visualization_target") {
    const target = source.target as DeepDiveTargetV1;
    const targetEvidenceIds = target.kind === "generated_object"
      ? target.evidenceClaimIds
      : target.evidenceIds;
    return scope.kind === "selected_passage" &&
      isStringArray(scope.evidenceIds) && equalStringArrays(scope.evidenceIds, targetEvidenceIds);
  }
  return scope.kind === "selected_passage" &&
    scope.excerpt === source.excerpt &&
    equalStringArrays(scope.evidenceIds, source.evidenceIds) &&
    equalStringArrays(scope.externalSourceIds, source.externalSourceIds);
}

function isPersistedAnnotationTarget(value: unknown, nodeId: string) {
  if (!isRecord(value) || value.nodeId !== nodeId || typeof value.kind !== "string") {
    return false;
  }
  if (value.kind === "node_summary") {
    return true;
  }
  if (value.kind === "claim") {
    return typeof value.claimId === "string" && value.claimId.trim().length > 0;
  }
  if (value.kind === "paper_evidence") {
    return typeof value.evidence === "string" && value.evidence.trim().length > 0;
  }
  if (value.kind === "external_knowledge") {
    return typeof value.source === "string" && value.source.trim().length > 0;
  }
  return value.kind === "recommendation" &&
    typeof value.recommendationId === "string" && value.recommendationId.trim().length > 0;
}

function isPersistedThinReadingAnnotation(
  value: unknown,
  artifactId: string,
  nodes: Record<string, unknown>
) {
  if (!isRecord(value) || value.artifactId !== artifactId || typeof value.id !== "string" ||
    typeof value.body !== "string" || typeof value.excerpt !== "string" ||
    typeof value.createdAt !== "string" || typeof value.updatedAt !== "string" ||
    typeof value.nodeId !== "string" || !isRecord(nodes[value.nodeId]) ||
    (value.visibility !== "private" && value.visibility !== "pending_public")) {
    return false;
  }
  if (!isPersistedAnnotationTarget(value.target, value.nodeId)) {
    return false;
  }
  if (value.syncState === undefined) {
    return true;
  }
  if (!isRecord(value.syncState)) {
    return false;
  }
  if (value.syncState.status === "synced") {
    return typeof value.syncState.intuechoAnnotationId === "string" && value.syncState.intuechoAnnotationId.trim().length > 0 &&
      typeof value.syncState.syncedAt === "string";
  }
  return value.syncState.status === "failed" && typeof value.syncState.error === "string" && value.syncState.error.trim().length > 0 &&
    typeof value.syncState.lastAttemptAt === "string";
}

function isPersistedExternalSource(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  const validRelations = new Set([
    "cited_by_target",
    "cites_target",
    "related",
    "topic_search"
  ]);
  const sourceId = typeof value.sourceId === "string" ? value.sourceId : "";
  const isOpenAlex = value.provider === "openalex" &&
    value.id === `openalex:${sourceId}` &&
    /^W\d+$/i.test(sourceId) &&
    value.sourceRecordUrl === `https://openalex.org/${sourceId}`;
  const crossrefDoi = sourceId.toLowerCase();
  const isCrossref = value.provider === "crossref" &&
    /^[^\s/]+\/[^\s]+$/.test(crossrefDoi) &&
    value.id === `crossref:${crossrefDoi}` &&
    value.doi === `https://doi.org/${crossrefDoi}` &&
    value.url === `https://doi.org/${crossrefDoi}` &&
    value.sourceRecordUrl === `https://api.crossref.org/works/${encodeURIComponent(crossrefDoi)}` &&
    value.relation === "topic_search";
  return (isOpenAlex || isCrossref) &&
    typeof value.title === "string" && value.title.trim().length > 0 &&
    typeof value.abstract === "string" &&
    isStringArray(value.authors) &&
    typeof value.relevance === "number" && Number.isFinite(value.relevance) &&
    typeof value.retrievalQuery === "string" && value.retrievalQuery.trim().length > 0 &&
    typeof value.relation === "string" && validRelations.has(value.relation) &&
    isHttpsUrl(value.url);
}

function isPersistedEvidenceSpan(value: unknown, paperIds: ReadonlySet<string>) {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim().length === 0 ||
    typeof value.paperId !== "string" || !paperIds.has(value.paperId) ||
    typeof value.quote !== "string" || value.quote.trim().length === 0 ||
    typeof value.confidence !== "number" || !Number.isFinite(value.confidence) ||
    value.confidence < 0 || value.confidence > 1) {
    return false;
  }
  const { chunkId, normalizedQuote, page, pageTextEnd, pageTextStart, textExtraction } = value;
  if ((chunkId !== undefined && typeof chunkId !== "string") ||
    (normalizedQuote !== undefined && typeof normalizedQuote !== "string") ||
    (page !== undefined && (typeof page !== "number" || !Number.isInteger(page) || page < 1)) ||
    (pageTextStart !== undefined && (typeof pageTextStart !== "number" || !Number.isInteger(pageTextStart) || pageTextStart < 0)) ||
    (pageTextEnd !== undefined && (typeof pageTextEnd !== "number" || !Number.isInteger(pageTextEnd) || pageTextEnd < 0)) ||
    (textExtraction !== undefined && textExtraction !== "embedded" && textExtraction !== "mineru" && textExtraction !== "ocr")) {
    return false;
  }
  return pageTextStart === undefined || pageTextEnd === undefined ||
    pageTextStart <= pageTextEnd;
}

function isPersistedClaim(value: unknown, availableEvidenceIds: ReadonlySet<string>) {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim().length === 0 ||
    typeof value.text !== "string" || value.text.trim().length === 0 ||
    !isStringArray(value.evidenceIds) || new Set(value.evidenceIds).size !== value.evidenceIds.length ||
    (value.status !== "grounded" && value.status !== "weak" && value.status !== "unsupported") ||
    !value.evidenceIds.every((evidenceId) => availableEvidenceIds.has(evidenceId))) {
    return false;
  }
  return value.status !== "grounded" || value.evidenceIds.length > 0;
}

function normalizedPersistedText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isPersistedSummarySentence(input: {
  availableEvidenceIds: ReadonlySet<string>;
  availableExternalSourceIds: ReadonlySet<string>;
  summary: string;
  value: unknown;
}) {
  const { value } = input;
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim().length === 0 ||
    typeof value.text !== "string" || value.text.trim().length === 0 ||
    !isStringArray(value.evidenceIds) || !isStringArray(value.externalKnowledge) ||
    new Set(value.evidenceIds).size !== value.evidenceIds.length ||
    new Set(value.externalKnowledge).size !== value.externalKnowledge.length ||
    (value.status !== "grounded" && value.status !== "weak" && value.status !== "unsupported") ||
    !value.evidenceIds.every((evidenceId) => input.availableEvidenceIds.has(evidenceId)) ||
    !value.externalKnowledge.every((sourceId) => input.availableExternalSourceIds.has(sourceId)) ||
    !normalizedPersistedText(input.summary).includes(normalizedPersistedText(value.text))) {
    return false;
  }
  if (value.status === "grounded") {
    return value.evidenceIds.length > 0 && value.externalKnowledge.length === 0;
  }
  if (value.status === "weak") {
    return value.evidenceIds.length > 0 || value.externalKnowledge.length > 0;
  }
  return value.evidenceIds.length === 0 && value.externalKnowledge.length === 0;
}

function isPersistedRecommendation(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim().length === 0 ||
    typeof value.relationship !== "string" || value.relationship.trim().length === 0 ||
    typeof value.note !== "string" || value.note.trim().length === 0 ||
    typeof value.compatibility !== "number" || !Number.isFinite(value.compatibility) ||
    value.compatibility < 0 || value.compatibility > 1) {
    return false;
  }
  return value.source === undefined || value.source === "local_agent_lead" || value.source === "intuecho_community";
}

function isPersistedGenerationAudit(value: unknown, availableEvidenceIds: Set<string>, sentenceIds: Set<string>) {
  if (!isRecord(value) ||
    (value.version !== "liteasy.thin-reading-agent/v1" && value.version !== "liteasy.thin-reading-agent/v2") ||
    !isRecord(value.model) ||
    typeof value.model.id !== "string" || value.model.id.trim().length === 0 ||
    typeof value.model.provider !== "string" || value.model.provider.trim().length === 0 ||
    !isRecord(value.qualityGate) || typeof value.qualityGate.attempts !== "number" ||
    !Number.isInteger(value.qualityGate.attempts) || value.qualityGate.attempts < 1 || value.qualityGate.attempts > 8 ||
    typeof value.qualityGate.repaired !== "boolean" || !isStringArray(value.qualityGate.repairReasons) ||
    value.qualityGate.repairReasons.length > 12 ||
    value.qualityGate.repaired !== (value.qualityGate.repairReasons.length > 0) ||
    !value.qualityGate.repairReasons.every((reason) => reason.length <= 600)) {
    return false;
  }
  if (value.aiInterpretationReview !== undefined && (!isRecord(value.aiInterpretationReview) ||
    value.aiInterpretationReview.verdict !== "pass" ||
    typeof value.aiInterpretationReview.reason !== "string" ||
    value.aiInterpretationReview.reason.trim().length === 0 ||
    value.aiInterpretationReview.reason.length > 420 ||
    !isStringArray(value.aiInterpretationReview.unsafeSentenceIds) ||
    value.aiInterpretationReview.unsafeSentenceIds.length > 0 ||
    !isPersistedContentQualityReview(value.aiInterpretationReview.contentQuality, sentenceIds))) {
    return false;
  }
  if (value.externalRetrieval !== undefined) {
    const retrieval = value.externalRetrieval;
    const validRoutes = new Set(["support", "challenge", "context"]);
    const validJoinReasons = new Set(["all_routes_settled", "deadline", "sufficient_sources"]);
    const validStatuses = new Set(["cancelled", "completed", "failed", "timed_out"]);
    const validFailures = new Set(["deadline", "invalid_response", "route_unavailable", "unexpected"]);
    if (!isRecord(retrieval) ||
      !isStringArray(retrieval.attemptedRoutes) ||
      !retrieval.attemptedRoutes.every((route) => validRoutes.has(route)) ||
      !isStringArray(retrieval.completedRoutes) ||
      !retrieval.completedRoutes.every((route) => validRoutes.has(route)) ||
      typeof retrieval.carriedSourceCount !== "number" ||
      !Number.isInteger(retrieval.carriedSourceCount) || retrieval.carriedSourceCount < 0 ||
      typeof retrieval.trustedSourceCount !== "number" ||
      !Number.isInteger(retrieval.trustedSourceCount) || retrieval.trustedSourceCount < 0 ||
      typeof retrieval.deadlineMs !== "number" || retrieval.deadlineMs < 1 ||
      typeof retrieval.durationMs !== "number" || retrieval.durationMs < 0 ||
      typeof retrieval.joinReason !== "string" || !validJoinReasons.has(retrieval.joinReason) ||
      !Array.isArray(retrieval.routeOutcomes) ||
      retrieval.routeOutcomes.length !== retrieval.attemptedRoutes.length ||
      !retrieval.routeOutcomes.every((outcome) => isRecord(outcome) &&
        typeof outcome.route === "string" && validRoutes.has(outcome.route) &&
        typeof outcome.status === "string" && validStatuses.has(outcome.status) &&
        typeof outcome.durationMs === "number" && outcome.durationMs >= 0 &&
        typeof outcome.sourceCount === "number" &&
        Number.isInteger(outcome.sourceCount) && outcome.sourceCount >= 0 &&
        typeof outcome.reused === "boolean" &&
        (outcome.failureKind === undefined || (
          typeof outcome.failureKind === "string" && validFailures.has(outcome.failureKind)
        )))) {
      return false;
    }
  }
  if (value.paperAnswerabilityTransition !== undefined) {
    const transition = value.paperAnswerabilityTransition;
    if (!isRecord(transition) ||
      typeof transition.reason !== "string" ||
      transition.reason.trim().length === 0 || transition.reason.length > 420 ||
      (transition.status !== "partial" && transition.status !== "none") ||
      (transition.answerObligations !== undefined &&
        !isPersistedAnswerObligations(transition.answerObligations, transition.status)) ||
      (
        transition.status === "partial" &&
        transition.targetSupportMode !== "paper_and_external" &&
        transition.targetSupportMode !== "ai_interpretation"
      ) ||
      (
        transition.status === "none" &&
        transition.targetSupportMode !== "external_only" &&
        transition.targetSupportMode !== "ai_interpretation"
      )) {
      return false;
    }
  }
  if (value.paperEvidenceRecovery !== undefined &&
    !isPersistedPaperEvidenceRecovery(value.paperEvidenceRecovery)) {
    return false;
  }
  if (value.evidencePlanning !== undefined &&
    !isPersistedEvidencePlanningAudit(value.evidencePlanning)) {
    return false;
  }
  if (value.evidenceLoop !== undefined) {
    const loop = value.evidenceLoop;
    const stopReasons = new Set([
      "maximum_rounds_reached",
      "no_new_evidence",
      "observation_sufficient",
      "observer_unavailable"
    ]);
    if (!isRecord(loop) || !Array.isArray(loop.rounds) || loop.rounds.length < 1 || loop.rounds.length > 2 ||
      typeof loop.stopReason !== "string" || !stopReasons.has(loop.stopReason) ||
      typeof loop.stopReasonDetail !== "string" || loop.stopReasonDetail.trim().length === 0 ||
      (loop.fallback !== undefined && loop.fallback !== "deterministic_first_round") ||
      (loop.stopReason === "observer_unavailable" && loop.fallback !== "deterministic_first_round") ||
      !loop.rounds.every((round) => isRecord(round) && Number.isInteger(round.round) &&
        isStringArray(round.focus) && isStringArray(round.observedEvidenceIds) &&
        isStringArray(round.searchQueries) && isStringArray(round.selectedEvidenceIds) &&
        Array.isArray(round.pageRequests) && round.pageRequests.every((page) => Number.isInteger(page) && page > 0) &&
        Array.isArray(round.toolCalls))) {
      return false;
    }
  }
  if (value.interpretationPlan !== undefined && (!isRecord(value.interpretationPlan) ||
    (value.interpretationPlan.intent !== "what" && value.interpretationPlan.intent !== "why" &&
      value.interpretationPlan.intent !== "how" && value.interpretationPlan.intent !== "mixed") ||
    (value.interpretationPlan.requestedDepth !== "standard" && value.interpretationPlan.requestedDepth !== "deep") ||
    (value.interpretationPlan.explanationDepth !== undefined &&
      value.interpretationPlan.explanationDepth !== "overview" &&
      value.interpretationPlan.explanationDepth !== "focused" &&
      value.interpretationPlan.explanationDepth !== "mechanistic" &&
      value.interpretationPlan.explanationDepth !== "boundary") ||
    typeof value.interpretationPlan.externalKnowledgeNeeded !== "boolean" ||
    !isStringArray(value.interpretationPlan.discourseMoves) ||
    value.interpretationPlan.discourseMoves.length < 1 || value.interpretationPlan.discourseMoves.length > 6 ||
    (value.interpretationPlan.intentSignals !== undefined &&
      !isBoundedStringArray(value.interpretationPlan.intentSignals, 24, 160)) ||
    (value.interpretationPlan.intentWeights !== undefined &&
      !isPersistedIntentWeights(value.interpretationPlan.intentWeights)) ||
    (value.interpretationPlan.learningGoals !== undefined &&
      (!isBoundedStringArray(value.interpretationPlan.learningGoals, 5, 40) ||
        !value.interpretationPlan.learningGoals.every((goal) => persistedLearningGoals.has(goal)))) ||
    (value.interpretationPlan.paperTypeHint !== undefined &&
      (typeof value.interpretationPlan.paperTypeHint !== "string" ||
        !persistedPaperTypes.has(value.interpretationPlan.paperTypeHint))) ||
    (value.interpretationPlan.readingMode !== undefined &&
      value.interpretationPlan.readingMode !== "orientation" &&
      value.interpretationPlan.readingMode !== "exploration") ||
    (value.interpretationPlan.retentionFocus !== undefined &&
      !isBoundedStringArray(value.interpretationPlan.retentionFocus, 5, 420)) ||
    (value.interpretationPlan.externalQuery !== undefined && typeof value.interpretationPlan.externalQuery !== "string") ||
    (value.interpretationPlan.gap !== undefined && typeof value.interpretationPlan.gap !== "string"))) {
    return false;
  }
  if (value.contextManagement !== undefined && (!isRecord(value.contextManagement) ||
    typeof value.contextManagement.tokenBudget !== "number" || value.contextManagement.tokenBudget < 1 ||
    typeof value.contextManagement.estimatedTokens !== "number" || value.contextManagement.estimatedTokens < 0 ||
    typeof value.contextManagement.droppedAncestors !== "number" || value.contextManagement.droppedAncestors < 0 ||
    typeof value.contextManagement.droppedClaims !== "number" || value.contextManagement.droppedClaims < 0 ||
    typeof value.contextManagement.droppedEvidenceSpans !== "number" || value.contextManagement.droppedEvidenceSpans < 0)) {
    return false;
  }
  if (value.workload !== undefined && (!isRecord(value.workload) ||
    (value.workload.strategy !== "direct" && value.workload.strategy !== "guided" && value.workload.strategy !== "parallel") ||
    (value.workload.maxConcurrency !== 0 && value.workload.maxConcurrency !== 1 && value.workload.maxConcurrency !== 2) ||
    typeof value.workload.contextBudgetTokens !== "number" || value.workload.contextBudgetTokens < 1 ||
    typeof value.workload.evidenceCharacters !== "number" || value.workload.evidenceCharacters < 0 ||
    typeof value.workload.evidenceCount !== "number" || value.workload.evidenceCount < 0 ||
    typeof value.workload.reason !== "string" || !isStringArray(value.workload.plannedSubagents))) {
    return false;
  }
  if (value.responsibilitySubagents !== undefined && (!Array.isArray(value.responsibilitySubagents) ||
    value.responsibilitySubagents.length > 2 ||
    !value.responsibilitySubagents.every((outcome) => isRecord(outcome) &&
      (outcome.id === "relationship_mapper" || outcome.id === "visual_editor") &&
      (outcome.status === "completed" || outcome.status === "failed") &&
      typeof outcome.durationMs === "number" && outcome.durationMs >= 0 &&
      typeof outcome.includedInFinalPrompt === "boolean" &&
      (outcome.failureKind === undefined || outcome.failureKind === "empty_output" ||
        outcome.failureKind === "unavailable" || outcome.failureKind === "unexpected")))) {
    return false;
  }
  if (value.evidencePlan !== undefined && (!isRecord(value.evidencePlan) ||
    !isStringArray(value.evidencePlan.focus) || value.evidencePlan.focus.length < 1 || value.evidencePlan.focus.length > 5 ||
    !isStringArray(value.evidencePlan.selectedEvidenceIds) || value.evidencePlan.selectedEvidenceIds.length < 1 ||
    value.evidencePlan.selectedEvidenceIds.length > 18 ||
    new Set(value.evidencePlan.selectedEvidenceIds).size !== value.evidencePlan.selectedEvidenceIds.length ||
    !value.evidencePlan.selectedEvidenceIds.every((id) => /^evidence-[A-Za-z0-9-]{1,150}$/.test(id)))) {
    return false;
  }
  if (value.evidenceReview !== undefined && (!isRecord(value.evidenceReview) ||
    value.evidenceReview.verdict !== "pass" || typeof value.evidenceReview.reason !== "string" ||
    value.evidenceReview.reason.trim().length === 0 || value.evidenceReview.reason.length > 420 ||
    !isBoundedStringArray(value.evidenceReview.unsupportedSentenceIds, 16, 160) ||
    value.evidenceReview.unsupportedSentenceIds.length > 0 ||
    !isPersistedPropositionVerdicts(value.evidenceReview.propositionVerdicts, sentenceIds) ||
    !isPersistedRootOrientationReview(value.evidenceReview.rootOrientation, sentenceIds) ||
    !isPersistedContentQualityReview(value.evidenceReview.contentQuality, sentenceIds))) {
    return false;
  }
  if (isRecord(value.evidenceReview) && value.evidenceReview.paperAnswerability !== undefined &&
    value.evidenceReview.paperAnswerability !== null) {
    const answerability = value.evidenceReview.paperAnswerability;
    if (!isRecord(answerability) ||
      (answerability.status !== "complete" && answerability.status !== "partial" && answerability.status !== "none") ||
      typeof answerability.reason !== "string" || answerability.reason.trim().length < 8 ||
      answerability.reason.length > 420 ||
      (answerability.answerObligations !== undefined &&
        !isPersistedAnswerObligations(answerability.answerObligations, answerability.status)) ||
      !isBoundedStringArray(answerability.paperSupportedSentenceIds, 16, 160) ||
      new Set(answerability.paperSupportedSentenceIds).size !== answerability.paperSupportedSentenceIds.length ||
      !answerability.paperSupportedSentenceIds.every((id) => sentenceIds.has(id)) ||
      (answerability.status === "none" && answerability.paperSupportedSentenceIds.length > 0) ||
      (answerability.status !== "none" && answerability.paperSupportedSentenceIds.length === 0)) {
      return false;
    }
  }
  if (value.evidenceToolCalls !== undefined && (!Array.isArray(value.evidenceToolCalls) ||
    !value.evidenceToolCalls.every((call) => isRecord(call) &&
      (call.kind === "read" || call.kind === "search" || call.kind === "view") &&
      isBoundedStringArray(call.evidenceIds, 18, 160) &&
      new Set(call.evidenceIds).size === call.evidenceIds.length &&
      call.evidenceIds.every((id) => /^evidence-[A-Za-z0-9-]{1,150}$/.test(id)) &&
      (call.query === undefined || typeof call.query === "string") &&
      (call.pages === undefined || (Array.isArray(call.pages) && call.pages.every((page) => Number.isInteger(page) && page > 0)))))) {
    return false;
  }
  const plannedEvidenceIds = isRecord(value.evidencePlan) && isStringArray(value.evidencePlan.selectedEvidenceIds)
    ? value.evidencePlan.selectedEvidenceIds
    : [];
  const auditedEvidenceIds = new Set(availableEvidenceIds);
  if (Array.isArray(value.evidenceToolCalls)) {
    value.evidenceToolCalls.forEach((call) => {
      if (isRecord(call) && isStringArray(call.evidenceIds)) {
        call.evidenceIds.forEach((id) => auditedEvidenceIds.add(id));
      }
    });
  }
  if (!plannedEvidenceIds.every((id) => auditedEvidenceIds.has(id))) {
    return false;
  }
  return value.evidencePlan === undefined || value.evidenceReview !== undefined;
}

function hasValidV2VisualizationArtifacts(node: Record<string, unknown>) {
  if (!Array.isArray(node.visualizations)) {
    return false;
  }
  try {
    node.visualizations.forEach((artifact) => parseVisualizationArtifact(artifact));
  } catch {
    return false;
  }
  return true;
}

function isPersistedThinReadingDocument(
  value: Record<string, unknown>,
  expectedVersion: typeof v1DocumentVersion | typeof v2DocumentVersion
) {
  const nodes = value.nodes;
  if (!isRecord(nodes)) {
    return false;
  }
  const rootNodeId = value.rootNodeId;
  const activeNodeId = value.activeNodeId;
  const baseDocumentValid = value.version === expectedVersion &&
    typeof value.artifactId === "string" && value.artifactId.trim().length > 0 &&
    typeof value.title === "string" && value.title.trim().length > 0 &&
    typeof value.targetLanguage === "string" &&
    isStringArray(value.paperIds) && value.paperIds.length > 0 &&
    new Set(value.paperIds).size === value.paperIds.length &&
    Array.isArray(value.annotations) &&
    isStringArray(value.pendingPublicAnnotationIds) &&
    isRecord(value.annotationSettings) &&
    typeof value.annotationSettings.autoPublic === "boolean" &&
    typeof rootNodeId === "string" &&
    typeof activeNodeId === "string" &&
    isRecord(nodes[rootNodeId]) &&
    isRecord(nodes[activeNodeId]);
  if (!baseDocumentValid) {
    return false;
  }
  const artifactId = value.artifactId;
  const annotations = value.annotations;
  const pendingPublicAnnotationIds = value.pendingPublicAnnotationIds;
  if (typeof artifactId !== "string" || !Array.isArray(annotations) || !isStringArray(pendingPublicAnnotationIds)) {
    return false;
  }

  if (!annotations.every((annotation) => (
    isPersistedThinReadingAnnotation(annotation, artifactId, nodes)
  ))) {
    return false;
  }
  const expectedPendingAnnotationIds = annotations.flatMap((annotation) => (
    isRecord(annotation) && annotation.visibility === "pending_public" &&
      (!isRecord(annotation.syncState) || annotation.syncState.status !== "synced") &&
      typeof annotation.id === "string"
        ? [annotation.id]
        : []
  ));
  if (new Set(pendingPublicAnnotationIds).size !== pendingPublicAnnotationIds.length ||
    !equalStringArrays(pendingPublicAnnotationIds, expectedPendingAnnotationIds)) {
    return false;
  }

  const cachedPaperIds = value.paperIds;
  if (!isStringArray(cachedPaperIds)) {
    return false;
  }
  const paperIds = new Set<string>(cachedPaperIds);
  return Object.entries(nodes).every(([nodeId, node]) => {
    if (!isRecord(node) || node.id !== nodeId || typeof node.depth !== "number" || node.depth < 0 ||
      typeof node.createdAt !== "string" || typeof node.summary !== "string" || node.summary.trim().length === 0 ||
      typeof node.title !== "string" || node.title.trim().length === 0 || typeof node.withinPaperClosure !== "boolean" ||
      !isStringArray(node.childIds) || new Set(node.childIds).size !== node.childIds.length) {
      return false;
    }
    if (node.closureState !== undefined &&
      node.closureState !== "inside_paper" &&
      node.closureState !== "near_boundary" &&
      node.closureState !== "outside_paper") {
      return false;
    }
    if (node.closureState !== undefined &&
      (node.closureState === "inside_paper") !== node.withinPaperClosure) {
      return false;
    }
    if (!isPersistedThinReadingNodeSource(node.source) ||
      !scopeMatchesPersistedNodeSource(node.recommendationScope, node.source)) {
      return false;
    }
    if (!Array.isArray(node.recommendations) ||
      new Set(node.recommendations.map((recommendation) => isRecord(recommendation) ? recommendation.id : undefined)).size !== node.recommendations.length ||
      !node.recommendations.every(isPersistedRecommendation)) {
      return false;
    }
    const evidence = node.evidence;
    if (!isRecord(evidence) ||
      !isStringArray(evidence.paperEvidence) || new Set(evidence.paperEvidence).size !== evidence.paperEvidence.length ||
      !isStringArray(evidence.externalKnowledge) || new Set(evidence.externalKnowledge).size !== evidence.externalKnowledge.length ||
      (evidence.externalSources !== undefined && (
        !Array.isArray(evidence.externalSources) ||
        !evidence.externalSources.every(isPersistedExternalSource)
      ))) {
      return false;
    }
    if (expectedVersion === v2DocumentVersion && (
      !hasValidV2VisualizationArtifacts(node) ||
      evidence.interactiveDemo !== undefined ||
      evidence.mermaid !== undefined
    )) {
      return false;
    }
    if (expectedVersion === v1DocumentVersion && node.visualizations !== undefined) {
      return false;
    }
    const paperEvidence = evidence.paperEvidence;
    const externalKnowledge = evidence.externalKnowledge;
    const summary = node.summary;
    if (!isStringArray(paperEvidence) || !isStringArray(externalKnowledge) || typeof summary !== "string") {
      return false;
    }
    const availableEvidenceIds = new Set<string>(paperEvidence);
    if (evidence.mermaid !== undefined &&
      (typeof evidence.mermaid !== "string" || evidence.mermaid.length > 8_000)) {
      return false;
    }
    if (evidence.interactiveDemo !== undefined && (
      !isRecord(evidence.interactiveDemo) || evidence.interactiveDemo.kind !== "html" ||
      typeof evidence.interactiveDemo.title !== "string" || !evidence.interactiveDemo.title.trim() ||
      typeof evidence.interactiveDemo.description !== "string" || !evidence.interactiveDemo.description.trim() ||
      typeof evidence.interactiveDemo.html !== "string" || evidence.interactiveDemo.html.length < 80 ||
      evidence.interactiveDemo.html.length > 60_000
    )) {
      return false;
    }
    if (evidence.recommendedFigures !== undefined && (
      !Array.isArray(evidence.recommendedFigures) || evidence.recommendedFigures.length > 2 ||
      new Set(evidence.recommendedFigures.map((figure) => isRecord(figure) ? figure.figureId : undefined)).size !== evidence.recommendedFigures.length ||
      !evidence.recommendedFigures.every((figure) => isRecord(figure) &&
        typeof figure.figureId === "string" && figure.figureId.trim().length > 0 &&
        typeof figure.reason === "string" && figure.reason.trim().length > 0 &&
        isStringArray(figure.evidenceIds) && figure.evidenceIds.length > 0 &&
        figure.evidenceIds.every((evidenceId) => availableEvidenceIds.has(evidenceId)))
    )) {
      return false;
    }
    const spans = evidence.paperEvidenceSpans;
    if (spans !== undefined && (!Array.isArray(spans) ||
      new Set(spans.map((span) => isRecord(span) ? span.id : undefined)).size !== spans.length ||
      !spans.every((span) => {
        if (!isPersistedEvidenceSpan(span, paperIds) || !isRecord(span) || typeof span.id !== "string") {
          return false;
        }
        return availableEvidenceIds.has(span.id);
      }))) {
      return false;
    }
    const claims = evidence.claims;
    if (claims !== undefined && (!Array.isArray(claims) ||
      new Set(claims.map((claim) => isRecord(claim) ? claim.id : undefined)).size !== claims.length ||
      !claims.every((claim) => isPersistedClaim(claim, availableEvidenceIds)))) {
      return false;
    }
    const sourceIds = new Set<string>(
      Array.isArray(evidence.externalSources)
        ? evidence.externalSources.map((source) => (
          isRecord(source) && typeof source.id === "string" ? source.id : ""
        ))
        : []
    );
    if (externalKnowledge.length > 0 &&
      !externalKnowledge.every((sourceId) => sourceIds.has(sourceId))) {
      return false;
    }
    const summarySentences = evidence.summarySentences;
    if (summarySentences !== undefined && (!Array.isArray(summarySentences) ||
      new Set(summarySentences.map((sentence) => isRecord(sentence) ? sentence.id : undefined)).size !== summarySentences.length ||
      !summarySentences.every((sentence) => isPersistedSummarySentence({
        availableEvidenceIds,
        availableExternalSourceIds: sourceIds,
        summary,
        value: sentence
      })))) {
      return false;
    }
    const sentenceIds = new Set<string>(
      Array.isArray(summarySentences)
        ? summarySentences.flatMap((sentence) => isRecord(sentence) && typeof sentence.id === "string" ? [sentence.id] : [])
        : []
    );
    if (evidence.generationAudit !== undefined &&
      !isPersistedGenerationAudit(evidence.generationAudit, availableEvidenceIds, sentenceIds)) {
      return false;
    }
    const hasExplicitSentenceMap = Array.isArray(summarySentences) && summarySentences.length > 0;
    const hasSentencePaperSupport = hasExplicitSentenceMap && summarySentences.some((sentence) => (
      isRecord(sentence) && isStringArray(sentence.evidenceIds) && sentence.evidenceIds.length > 0
    ));
    const hasSentenceExternalSupport = hasExplicitSentenceMap && summarySentences.some((sentence) => (
      isRecord(sentence) && isStringArray(sentence.externalKnowledge) && sentence.externalKnowledge.length > 0
    ));
    const hasPaperSupport = hasExplicitSentenceMap
      ? hasSentencePaperSupport
      : paperEvidence.length > 0;
    const hasExternalSupport = hasExplicitSentenceMap
      ? hasSentenceExternalSupport
      : externalKnowledge.length > 0;
    const hasAnyPaperReference = paperEvidence.length > 0 || hasSentencePaperSupport;
    const hasAnyExternalReference = externalKnowledge.length > 0 || hasSentenceExternalSupport;
    const inferredSupportMode = hasPaperSupport && hasExternalSupport
      ? "paper_and_external"
      : hasExternalSupport
        ? "external_only"
        : "paper";
    const declaredSupportMode = node.supportMode;
    if (declaredSupportMode !== undefined &&
      declaredSupportMode !== "paper" &&
      declaredSupportMode !== "paper_and_external" &&
      declaredSupportMode !== "external_only" &&
      declaredSupportMode !== "ai_interpretation") {
      return false;
    }
    if (declaredSupportMode === "ai_interpretation") {
      const audit = evidence.generationAudit;
      if (hasAnyPaperReference || hasAnyExternalReference || !isRecord(audit) ||
        !isRecord(audit.externalFallback) || !isRecord(audit.aiInterpretationReview) ||
        audit.aiInterpretationReview.verdict !== "pass" ||
        !Array.isArray(summarySentences) || summarySentences.length === 0 ||
        !summarySentences.every((sentence) => isRecord(sentence) &&
          sentence.status === "unsupported" && sentence.supportMode === "ai_interpretation")) {
        return false;
      }
    } else if (declaredSupportMode !== undefined && declaredSupportMode !== inferredSupportMode) {
      return false;
    }
    const resolvedSupportMode = declaredSupportMode ?? inferredSupportMode;
    if (resolvedSupportMode === "external_only" && paperEvidence.length > 0) {
      return false;
    }
    const generationAudit = evidence.generationAudit;
    const transition = isRecord(generationAudit) && isRecord(generationAudit.paperAnswerabilityTransition)
      ? generationAudit.paperAnswerabilityTransition
      : undefined;
    if (transition && transition.targetSupportMode !== resolvedSupportMode) {
      return false;
    }
    const answerability = isRecord(generationAudit) && isRecord(generationAudit.evidenceReview) &&
      isRecord(generationAudit.evidenceReview.paperAnswerability)
      ? generationAudit.evidenceReview.paperAnswerability
      : undefined;
    if (answerability) {
      const expectedClosureState = answerability.status === "complete"
        ? "inside_paper"
        : answerability.status === "partial"
          ? "near_boundary"
          : "outside_paper";
      if (node.withinPaperClosure !== (answerability.status === "complete") ||
        (node.closureState !== undefined && node.closureState !== expectedClosureState) ||
        (transition && transition.status !== answerability.status)) {
        return false;
      }
    }
    if (!node.childIds.every((childId) => isRecord(nodes[childId]))) {
      return false;
    }
    if (nodeId === rootNodeId) {
      return node.parentId === undefined && node.depth === 0;
    }
    if (typeof node.parentId !== "string") {
      return false;
    }
    const parent = nodes[node.parentId];
    if (!isRecord(parent)) {
      return false;
    }
    if (!isStringArray(parent.childIds) ||
      typeof parent.depth !== "number" ||
      node.depth !== parent.depth + 1) {
      return false;
    }
    const source = node.source;
    if (!isPersistedThinReadingNodeSource(source)) return false;
    if (source.kind === "visualization_target") {
      return isDeepDiveTargetBoundToNode(source.target as DeepDiveTargetV1, parent as unknown as ThinReadingNodeV2);
    }
    if (source.kind !== "selected_text") return true;
    const selectedEvidenceIds = source.evidenceIds;
    const parentEvidence = isRecord(parent.evidence) && isStringArray(parent.evidence.paperEvidence)
      ? new Set(parent.evidence.paperEvidence)
      : null;
    if (selectedEvidenceIds !== undefined &&
      (!isStringArray(selectedEvidenceIds) || parentEvidence === null || !selectedEvidenceIds.every((evidenceId) => parentEvidence.has(evidenceId)))) {
      return false;
    }
    const selectedExternalSourceIds = source.externalSourceIds;
    const parentExternalSources = isRecord(parent.evidence) && Array.isArray(parent.evidence.externalSources)
      ? new Set(parent.evidence.externalSources.flatMap((source) => (
        isRecord(source) && typeof source.id === "string" ? [source.id] : []
      )))
      : null;
    return selectedExternalSourceIds === undefined || (
      isStringArray(selectedExternalSourceIds) &&
      parentExternalSources !== null &&
      selectedExternalSourceIds.every((sourceId) => parentExternalSources.has(sourceId))
    );
  });
}

function parseV1(value: Record<string, unknown>): ThinReadingDocumentV1 {
  if (!isPersistedThinReadingDocument(value, v1DocumentVersion)) {
    throw new Error("thin_reading_document_invalid");
  }
  return value as unknown as ThinReadingDocumentV1;
}

function parseV2(value: Record<string, unknown>): ThinReadingDocumentV2 {
  if (!isPersistedThinReadingDocument(value, v2DocumentVersion)) {
    throw new Error("thin_reading_document_invalid");
  }
  return value as unknown as ThinReadingDocumentV2;
}

export function isThinReadingV1(value: unknown): value is ThinReadingDocumentV1 {
  return isRecord(value) && value.version === v1DocumentVersion;
}

export function isThinReadingV2(value: unknown): value is ThinReadingDocumentV2 {
  return isRecord(value) && value.version === v2DocumentVersion;
}

export function parseThinReadingDocument(value: unknown): ThinReadingDocument {
  if (!isRecord(value)) {
    throw new Error("thin_reading_document_invalid");
  }
  return value.version === v1DocumentVersion ? parseV1(value) : parseV2(value);
}

export function cloneThinReadingV1AsV2(
  value: unknown,
  input: { artifactId: string; createdAt: string }
): ThinReadingDocumentV2 {
  const oldDocument = parseV1(isRecord(value) ? value : {});
  const nodes = Object.fromEntries(Object.entries(oldDocument.nodes).map(([nodeId, node]) => {
    const { version: _version, ...nodeWithoutVersion } = node;
    const { interactiveDemo: _interactiveDemo, mermaid: _mermaid, ...evidence } = node.evidence;
    const nextNode: ThinReadingNodeV2 = {
      ...nodeWithoutVersion,
      evidence,
      visualizations: []
    } as unknown as ThinReadingNodeV2;
    return [nodeId, nextNode];
  }));
  const annotations = oldDocument.annotations.map((annotation) => ({
    ...annotation,
    artifactId: input.artifactId
  }));
  return {
    ...oldDocument,
    annotations,
    artifactId: input.artifactId,
    migrationProvenance: {
      migratedAt: input.createdAt,
      sourceArtifactId: oldDocument.artifactId
    },
    nodes,
    version: v2DocumentVersion
  };
}
