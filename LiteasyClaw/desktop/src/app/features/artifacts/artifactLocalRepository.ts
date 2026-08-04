import { invoke } from "@tauri-apps/api/core";
import type { ArtifactTab, ArtifactType } from "./artifact.types";
import { IntuitionGraphDocumentSchema } from "../intuition-graph/intuitionGraph.schema";

const browserStorageKey = "liteasy.artifact-catalog.v1";
const databaseName = "liteasy-artifact-cache";
const objectStoreName = "snapshots";
const snapshotKey = "catalog-v1";

type ArtifactCatalogSnapshot = {
  artifacts: ArtifactTab[];
  savedAt: string;
  version: "liteasy.artifact-catalog/v1";
};

type ArtifactCatalogTransport = {
  load: () => Promise<unknown>;
  save: (snapshot: ArtifactCatalogSnapshot) => Promise<void>;
};

const artifactTypes = new Set<ArtifactType>([
  "comparison_table",
  "layered_graph",
  "mindmap",
  "ppt",
  "skill_doc",
  "thin_reading",
  "tree"
]);

function isTauriRuntime() {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>)
  );
}

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

function hasOptionalStringArray(value: Record<string, unknown>, key: string) {
  return value[key] === undefined || isStringArray(value[key]);
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

function isCachedThinReadingNodeSource(value: unknown): value is Record<string, unknown> {
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
      : undefined;
  return value.kind === "selected_text" &&
    typeof value.excerpt === "string" && value.excerpt.trim().length > 0 &&
    (value.prompt === undefined || typeof value.prompt === "string") &&
    (value.quickCommand === undefined || value.quickCommand === "html_algorithm_animation" ||
      value.quickCommand === "html_svg_structure" || value.quickCommand === "mermaid_causal") &&
    (value.requestedOutput === undefined || value.requestedOutput === "explanation" ||
      value.requestedOutput === "html_demo" || value.requestedOutput === "mermaid") &&
    (expectedOutput === undefined || value.requestedOutput === expectedOutput) &&
    hasUniqueOptionalStringArray(value, "evidenceIds") &&
    hasUniqueOptionalStringArray(value, "externalSourceIds");
}

function isCachedRecommendationScope(value: unknown): value is Record<string, unknown> {
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

function scopeMatchesCachedNodeSource(scope: unknown, source: unknown) {
  if (!isCachedRecommendationScope(scope) || !isCachedThinReadingNodeSource(source)) {
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

function isCachedAnnotationTarget(value: unknown, nodeId: string) {
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

function isCachedThinReadingAnnotation(
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
  if (!isCachedAnnotationTarget(value.target, value.nodeId)) {
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

function normalizeCachedExternalSource(value: unknown): unknown {
  if (!isRecord(value) || typeof value.sourceRecordUrl === "string") {
    return value;
  }
  const sourceId = typeof value.sourceId === "string" ? value.sourceId : "";
  if (value.provider !== "openalex" || !/^W\d+$/i.test(sourceId)) {
    return value;
  }
  return { ...value, sourceRecordUrl: `https://openalex.org/${sourceId}` };
}

function isCachedExternalSource(value: unknown) {
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

function isCachedEvidenceSpan(value: unknown, paperIds: ReadonlySet<string>) {
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

function isCachedClaim(value: unknown, availableEvidenceIds: ReadonlySet<string>) {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim().length === 0 ||
    typeof value.text !== "string" || value.text.trim().length === 0 ||
    !isStringArray(value.evidenceIds) || new Set(value.evidenceIds).size !== value.evidenceIds.length ||
    (value.status !== "grounded" && value.status !== "weak" && value.status !== "unsupported") ||
    !value.evidenceIds.every((evidenceId) => availableEvidenceIds.has(evidenceId))) {
    return false;
  }
  return value.status !== "grounded" || value.evidenceIds.length > 0;
}

function normalizedCachedText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isCachedSummarySentence(input: {
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
    !normalizedCachedText(input.summary).includes(normalizedCachedText(value.text))) {
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

function isCachedRecommendation(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.trim().length === 0 ||
    typeof value.relationship !== "string" || value.relationship.trim().length === 0 ||
    typeof value.note !== "string" || value.note.trim().length === 0 ||
    typeof value.compatibility !== "number" || !Number.isFinite(value.compatibility) ||
    value.compatibility < 0 || value.compatibility > 1) {
    return false;
  }
  return value.source === undefined || value.source === "local_agent_lead" || value.source === "intuecho_community";
}

function isCachedGenerationAudit(value: unknown, availableEvidenceIds: Set<string>, sentenceIds: Set<string>) {
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

function normalizeCachedThinReadingDocument(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.nodes)) {
    return value;
  }
  const nodes = Object.fromEntries(Object.entries(value.nodes).map(([nodeId, node]) => {
    if (!isRecord(node)) {
      return [nodeId, node];
    }
    return [nodeId, {
      ...node,
      ...(isRecord(node.evidence) && Array.isArray(node.evidence.externalSources)
        ? {
            evidence: {
              ...node.evidence,
              externalSources: node.evidence.externalSources.map(normalizeCachedExternalSource)
            }
          }
        : {}),
      recommendations: Array.isArray(node.recommendations)
        ? node.recommendations.filter((recommendation) => (
            isRecord(recommendation) && recommendation.source === "intuecho_community"
          ))
        : []
    }];
  }));
  return { ...value, nodes };
}

function isCachedThinReadingDocument(value: unknown, artifactId: string) {
  if (!isRecord(value)) {
    return false;
  }
  const nodes = value.nodes;
  if (!isRecord(nodes)) {
    return false;
  }
  const rootNodeId = value.rootNodeId;
  const activeNodeId = value.activeNodeId;
  const baseDocumentValid = value.version === "liteasy.thin-reading/v1" &&
    value.artifactId === artifactId &&
    typeof value.title === "string" &&
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
  if (!Array.isArray(value.annotations) || !isStringArray(value.pendingPublicAnnotationIds)) {
    return false;
  }
  const annotations = value.annotations;
  const pendingPublicAnnotationIds = value.pendingPublicAnnotationIds;

  if (!annotations.every((annotation) => (
    isCachedThinReadingAnnotation(annotation, artifactId, nodes)
  ))) {
    return false;
  }
  const annotationsById = new Map<string, Record<string, unknown>>();
  for (const annotation of annotations) {
    if (isRecord(annotation) && typeof annotation.id === "string") {
      annotationsById.set(annotation.id, annotation);
    }
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
    if (!isCachedThinReadingNodeSource(node.source) ||
      !scopeMatchesCachedNodeSource(node.recommendationScope, node.source)) {
      return false;
    }
    if (!Array.isArray(node.recommendations) ||
      new Set(node.recommendations.map((recommendation) => isRecord(recommendation) ? recommendation.id : undefined)).size !== node.recommendations.length ||
      !node.recommendations.every(isCachedRecommendation)) {
      return false;
    }
    if (!isRecord(node.evidence) ||
      !isStringArray(node.evidence.paperEvidence) || new Set(node.evidence.paperEvidence).size !== node.evidence.paperEvidence.length ||
      !isStringArray(node.evidence.externalKnowledge) || new Set(node.evidence.externalKnowledge).size !== node.evidence.externalKnowledge.length ||
      (node.evidence.externalSources !== undefined && (
        !Array.isArray(node.evidence.externalSources) ||
        !node.evidence.externalSources.every(isCachedExternalSource)
      ))) {
      return false;
    }
    const paperEvidence = node.evidence.paperEvidence;
    const externalKnowledge = node.evidence.externalKnowledge;
    const summary = node.summary;
    if (!isStringArray(paperEvidence) || !isStringArray(externalKnowledge) || typeof summary !== "string") {
      return false;
    }
    const availableEvidenceIds = new Set<string>(paperEvidence);
    if (node.evidence.mermaid !== undefined &&
      (typeof node.evidence.mermaid !== "string" || node.evidence.mermaid.length > 8_000)) {
      return false;
    }
    if (node.evidence.interactiveDemo !== undefined && (
      !isRecord(node.evidence.interactiveDemo) || node.evidence.interactiveDemo.kind !== "html" ||
      typeof node.evidence.interactiveDemo.title !== "string" || !node.evidence.interactiveDemo.title.trim() ||
      typeof node.evidence.interactiveDemo.description !== "string" || !node.evidence.interactiveDemo.description.trim() ||
      typeof node.evidence.interactiveDemo.html !== "string" || node.evidence.interactiveDemo.html.length < 80 ||
      node.evidence.interactiveDemo.html.length > 60_000
    )) {
      return false;
    }
    if (node.evidence.recommendedFigures !== undefined && (
      !Array.isArray(node.evidence.recommendedFigures) || node.evidence.recommendedFigures.length > 2 ||
      new Set(node.evidence.recommendedFigures.map((figure) => isRecord(figure) ? figure.figureId : undefined)).size !== node.evidence.recommendedFigures.length ||
      !node.evidence.recommendedFigures.every((figure) => isRecord(figure) &&
        typeof figure.figureId === "string" && figure.figureId.trim().length > 0 &&
        typeof figure.reason === "string" && figure.reason.trim().length > 0 &&
        isStringArray(figure.evidenceIds) && figure.evidenceIds.length > 0 &&
        figure.evidenceIds.every((evidenceId) => availableEvidenceIds.has(evidenceId)))
    )) {
      return false;
    }
    const spans = node.evidence.paperEvidenceSpans;
    if (spans !== undefined && (!Array.isArray(spans) ||
      new Set(spans.map((span) => isRecord(span) ? span.id : undefined)).size !== spans.length ||
      !spans.every((span) => {
        if (!isCachedEvidenceSpan(span, paperIds) || !isRecord(span) || typeof span.id !== "string") {
          return false;
        }
        return availableEvidenceIds.has(span.id);
      }))) {
      return false;
    }
    const claims = node.evidence.claims;
    if (claims !== undefined && (!Array.isArray(claims) ||
      new Set(claims.map((claim) => isRecord(claim) ? claim.id : undefined)).size !== claims.length ||
      !claims.every((claim) => isCachedClaim(claim, availableEvidenceIds)))) {
      return false;
    }
    const sourceIds = new Set<string>(
      Array.isArray(node.evidence.externalSources)
        ? node.evidence.externalSources.map((source) => (
          isRecord(source) && typeof source.id === "string" ? source.id : ""
        ))
        : []
    );
    if (externalKnowledge.length > 0 &&
      !externalKnowledge.every((sourceId) => sourceIds.has(sourceId))) {
      return false;
    }
    const summarySentences = node.evidence.summarySentences;
    if (summarySentences !== undefined && (!Array.isArray(summarySentences) ||
      new Set(summarySentences.map((sentence) => isRecord(sentence) ? sentence.id : undefined)).size !== summarySentences.length ||
      !summarySentences.every((sentence) => isCachedSummarySentence({
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
    if (node.evidence.generationAudit !== undefined &&
      !isCachedGenerationAudit(node.evidence.generationAudit, availableEvidenceIds, sentenceIds)) {
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
    if (node.source.kind !== "selected_text") {
      return true;
    }
    const selectedEvidenceIds = node.source.evidenceIds;
    const parentEvidence = isRecord(parent.evidence) && isStringArray(parent.evidence.paperEvidence)
      ? new Set(parent.evidence.paperEvidence)
      : null;
    if (selectedEvidenceIds !== undefined &&
      (!isStringArray(selectedEvidenceIds) || parentEvidence === null || !selectedEvidenceIds.every((evidenceId) => parentEvidence.has(evidenceId)))) {
      return false;
    }
    const selectedExternalSourceIds = node.source.externalSourceIds;
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

function isCachedArtifact(value: unknown): value is ArtifactTab {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<ArtifactTab>;
  return (
    typeof candidate.artifactId === "string" &&
    candidate.artifactId.length > 0 &&
    typeof candidate.title === "string" &&
    typeof candidate.type === "string" &&
    artifactTypes.has(candidate.type as ArtifactType) &&
    candidate.type !== "skill_doc" &&
    (candidate.type !== "thin_reading" || isCachedThinReadingDocument(candidate.thinReadingDocument, candidate.artifactId)) &&
    (candidate.intuitionGraph === undefined || IntuitionGraphDocumentSchema.safeParse(candidate.intuitionGraph).success)
  );
}

function normalizeSnapshot(value: unknown): ArtifactTab[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const snapshot = value as Partial<ArtifactCatalogSnapshot>;
  if (snapshot.version !== "liteasy.artifact-catalog/v1" || !Array.isArray(snapshot.artifacts)) {
    return [];
  }
  return snapshot.artifacts
    .map((artifact) => {
      if (!isRecord(artifact) || artifact.type !== "thin_reading") {
        return artifact;
      }
      return {
        ...artifact,
        thinReadingDocument: normalizeCachedThinReadingDocument(artifact.thinReadingDocument)
      };
    })
    .filter(isCachedArtifact);
}

function createTauriTransport(): ArtifactCatalogTransport {
  return {
    load: () => invoke<unknown>("load_artifact_catalog_state"),
    save: (snapshot) => invoke<void>("save_artifact_catalog_state", { snapshot })
  };
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(objectStoreName)) {
        database.createObjectStore(objectStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地产物数据库"));
  });
}

function createIndexedDbTransport(): ArtifactCatalogTransport {
  return {
    async load() {
      const database = await openDatabase();
      try {
        return await new Promise<unknown>((resolve, reject) => {
          const request = database
            .transaction(objectStoreName, "readonly")
            .objectStore(objectStoreName)
            .get(snapshotKey);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error ?? new Error("无法读取本地产物数据库"));
        });
      } finally {
        database.close();
      }
    },
    async save(snapshot) {
      const database = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(objectStoreName, "readwrite");
          transaction.objectStore(objectStoreName).put(snapshot, snapshotKey);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error ?? new Error("无法保存本地产物数据库"));
          transaction.onabort = () => reject(transaction.error ?? new Error("本地产物数据库写入已中止"));
        });
      } finally {
        database.close();
      }
    }
  };
}

function createLocalStorageTransport(): ArtifactCatalogTransport {
  return {
    async load() {
      const serialized = window.localStorage.getItem(browserStorageKey);
      return serialized ? JSON.parse(serialized) : null;
    },
    async save(snapshot) {
      window.localStorage.setItem(browserStorageKey, JSON.stringify(snapshot));
    }
  };
}

function createDefaultTransport(): ArtifactCatalogTransport {
  if (isTauriRuntime()) {
    return createTauriTransport();
  }
  if (typeof window !== "undefined" && window.indexedDB) {
    return createIndexedDbTransport();
  }
  return createLocalStorageTransport();
}

export function createArtifactLocalRepository(transport?: ArtifactCatalogTransport) {
  const activeTransport = transport ?? createDefaultTransport();
  return {
    async list() {
      return normalizeSnapshot(await activeTransport.load());
    },
    async replace(artifacts: ArtifactTab[]) {
      const persistentArtifacts = artifacts.filter(isCachedArtifact);
      await activeTransport.save({
        artifacts: persistentArtifacts,
        savedAt: new Date().toISOString(),
        version: "liteasy.artifact-catalog/v1"
      });
    }
  };
}

export type ArtifactLocalRepository = ReturnType<typeof createArtifactLocalRepository>;
