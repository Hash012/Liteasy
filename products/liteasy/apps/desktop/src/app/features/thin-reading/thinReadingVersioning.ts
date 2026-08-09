import { parseVisualizationArtifact } from "../visualization/visualizationArtifact.schema";
import type {
  ThinReadingDocument,
  ThinReadingDocumentV1,
  ThinReadingDocumentV2,
  ThinReadingNodeV2
} from "./thinReading.types";

const v1DocumentVersion = "liteasy.thin-reading/v1";
const v2DocumentVersion = "liteasy.thin-reading/v2";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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
    !Number.isInteger(value.qualityGate.attempts) || value.qualityGate.attempts < 1 || value.qualityGate.attempts > 2 ||
    typeof value.qualityGate.repaired !== "boolean" || !isStringArray(value.qualityGate.repairReasons) ||
    value.qualityGate.repairReasons.length !== value.qualityGate.attempts - 1 ||
    value.qualityGate.repaired !== (value.qualityGate.attempts > 1) ||
    !value.qualityGate.repairReasons.every((reason) => reason.length <= 600)) {
    return false;
  }
  if (value.interpretationPlan !== undefined && (!isRecord(value.interpretationPlan) ||
    (value.interpretationPlan.intent !== "what" && value.interpretationPlan.intent !== "why" &&
      value.interpretationPlan.intent !== "how" && value.interpretationPlan.intent !== "mixed") ||
    (value.interpretationPlan.requestedDepth !== "standard" && value.interpretationPlan.requestedDepth !== "deep") ||
    typeof value.interpretationPlan.externalKnowledgeNeeded !== "boolean" ||
    !isStringArray(value.interpretationPlan.discourseMoves) ||
    value.interpretationPlan.discourseMoves.length < 1 || value.interpretationPlan.discourseMoves.length > 6 ||
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
  if (value.evidencePlan !== undefined && (!isRecord(value.evidencePlan) ||
    !isStringArray(value.evidencePlan.focus) || value.evidencePlan.focus.length < 1 || value.evidencePlan.focus.length > 5 ||
    !isStringArray(value.evidencePlan.selectedEvidenceIds) || value.evidencePlan.selectedEvidenceIds.length < 1 ||
    value.evidencePlan.selectedEvidenceIds.length > 12 ||
    !value.evidencePlan.selectedEvidenceIds.every((id) => availableEvidenceIds.has(id)))) {
    return false;
  }
  if (value.evidenceReview !== undefined && (!isRecord(value.evidenceReview) ||
    value.evidenceReview.verdict !== "pass" || typeof value.evidenceReview.reason !== "string" ||
    value.evidenceReview.reason.trim().length === 0 || value.evidenceReview.reason.length > 420 ||
    !isStringArray(value.evidenceReview.unsupportedSentenceIds) ||
    !value.evidenceReview.unsupportedSentenceIds.every((id) => sentenceIds.has(id)))) {
    return false;
  }
  if (value.evidenceToolCalls !== undefined && (!Array.isArray(value.evidenceToolCalls) ||
    !value.evidenceToolCalls.every((call) => isRecord(call) &&
      (call.kind === "read" || call.kind === "search" || call.kind === "view") &&
      isStringArray(call.evidenceIds) && call.evidenceIds.every((id) => availableEvidenceIds.has(id)) &&
      (call.query === undefined || typeof call.query === "string") &&
      (call.pages === undefined || (Array.isArray(call.pages) && call.pages.every((page) => Number.isInteger(page) && page > 0)))))) {
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
      (node.closureState === "outside_paper") !== !node.withinPaperClosure) {
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
    if (!isPersistedThinReadingNodeSource(source) || source.kind !== "selected_text") {
      return true;
    }
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
