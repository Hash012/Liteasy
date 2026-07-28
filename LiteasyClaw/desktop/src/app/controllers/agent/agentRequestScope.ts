import type { SubmitAgentTurnRequest } from "../../features/agent-api/agentApi.types";
import type { RetrievalChunk } from "../../features/retrieval/retrieval.types";
import type {
  ThinReadingClaim,
  ThinReadingEvidenceSpan,
  ThinReadingGenerationContext,
  ThinReadingNodeSource
} from "../../features/thin-reading/thinReading.types";
import type { Paper } from "../../features/workspace/workspace.types";

export type AgentKnowledgeScopeInput = {
  allPapers: Paper[];
  fallbackImportedChunksByPaperId: Record<string, RetrievalChunk[]>;
  fallbackSelectedPapers: Paper[];
  getImportedChunksForPaperId?: (paperId: string) => RetrievalChunk[];
  request?: SubmitAgentTurnRequest;
};

export function getAgentRequestSelectionPaperIds(request?: SubmitAgentTurnRequest) {
  const selectionAttachment = request?.attachments?.find(
    (attachment) => attachment.source === "selection" && attachment.uri === "liteasy://selection/current"
  );
  const paperIds = selectionAttachment?.metadata?.paperIds;
  return Array.isArray(paperIds) && paperIds.every((paperId) => typeof paperId === "string")
    ? paperIds
    : null;
}

function isThinReadingSource(value: unknown): value is ThinReadingNodeSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const source = value as Partial<ThinReadingNodeSource>;
  if (source.kind === "root_overview") {
    return true;
  }
  if (source.kind === "omitted_section") {
    return typeof source.label === "string" && typeof source.sectionKey === "string";
  }
  if (source.kind === "selected_text") {
    return typeof source.excerpt === "string" &&
      (source.prompt === undefined || typeof source.prompt === "string");
  }
  return false;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isThinReadingClaim(value: unknown): value is ThinReadingClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const claim = value as Partial<ThinReadingClaim>;
  return typeof claim.id === "string" &&
    typeof claim.text === "string" &&
    (claim.status === "grounded" || claim.status === "unsupported" || claim.status === "weak") &&
    isStringArray(claim.evidenceIds);
}

function isThinReadingEvidenceSpan(value: unknown): value is ThinReadingEvidenceSpan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const span = value as Partial<ThinReadingEvidenceSpan>;
  return typeof span.id === "string" &&
    typeof span.paperId === "string" &&
    typeof span.quote === "string" &&
    typeof span.confidence === "number" &&
    (span.chunkId === undefined || typeof span.chunkId === "string") &&
    (span.normalizedQuote === undefined || typeof span.normalizedQuote === "string") &&
    (span.page === undefined || typeof span.page === "number");
}

function normalizeThinReadingClaims(value: unknown): ThinReadingClaim[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const claims = value
    .filter(isThinReadingClaim)
    .map((claim) => ({
      evidenceIds: [...claim.evidenceIds],
      id: claim.id,
      status: claim.status,
      text: claim.text
    }));
  return claims.length > 0 ? claims : undefined;
}

function normalizeThinReadingEvidenceSpans(value: unknown): ThinReadingEvidenceSpan[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const spans = value
    .filter(isThinReadingEvidenceSpan)
    .map((span) => ({
      chunkId: span.chunkId,
      confidence: span.confidence,
      id: span.id,
      normalizedQuote: span.normalizedQuote,
      page: span.page,
      paperId: span.paperId,
      quote: span.quote
    }));
  return spans.length > 0 ? spans : undefined;
}

function normalizeExternalSources(value: unknown): ThinReadingGenerationContext["externalSources"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const sources = value.filter((source) => (
    source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    "id" in source && typeof source.id === "string" &&
    "provider" in source && source.provider === "openalex" &&
    "sourceId" in source && typeof source.sourceId === "string" &&
    "title" in source && typeof source.title === "string" &&
    "url" in source && typeof source.url === "string" &&
    "authors" in source && Array.isArray(source.authors) && source.authors.every((author: unknown) => typeof author === "string") &&
    "abstract" in source && typeof source.abstract === "string" &&
    "relevance" in source && typeof source.relevance === "number" &&
    "retrievalQuery" in source && typeof source.retrievalQuery === "string"
  ));
  return sources.length > 0 ? sources as NonNullable<ThinReadingGenerationContext["externalSources"]> : undefined;
}

export function getAgentRequestThinReadingContext(
  request?: SubmitAgentTurnRequest
): ThinReadingGenerationContext | null {
  const selectionAttachment = request?.attachments?.find(
    (attachment) => attachment.source === "selection" && attachment.uri === "liteasy://selection/current"
  );
  const value = selectionAttachment?.metadata?.thinReadingContext;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Partial<ThinReadingGenerationContext>;
  if (
    typeof candidate.artifactId !== "string" ||
    typeof candidate.depth !== "number" ||
    !Array.isArray(candidate.paperIds) ||
    !candidate.paperIds.every((paperId) => typeof paperId === "string") ||
    !isThinReadingSource(candidate.source) ||
    typeof candidate.targetLanguage !== "string"
  ) {
    return null;
  }
  return {
    artifactId: candidate.artifactId,
    depth: candidate.depth,
    paperIds: [...candidate.paperIds],
    primaryPaperId: typeof candidate.primaryPaperId === "string" ? candidate.primaryPaperId : undefined,
    primaryPaperTitle: typeof candidate.primaryPaperTitle === "string" ? candidate.primaryPaperTitle : undefined,
    prompt: typeof candidate.prompt === "string" ? candidate.prompt : undefined,
    parentClaims: normalizeThinReadingClaims(candidate.parentClaims),
    parentEvidenceSpans: normalizeThinReadingEvidenceSpans(candidate.parentEvidenceSpans),
    parentNodeId: typeof candidate.parentNodeId === "string" ? candidate.parentNodeId : undefined,
    parentWithinPaperClosure: typeof candidate.parentWithinPaperClosure === "boolean"
      ? candidate.parentWithinPaperClosure
      : undefined,
    parentSummary: typeof candidate.parentSummary === "string" ? candidate.parentSummary : undefined,
    parentTitle: typeof candidate.parentTitle === "string" ? candidate.parentTitle : undefined,
    source: candidate.source,
    targetLanguage: candidate.targetLanguage,
    externalSources: normalizeExternalSources(candidate.externalSources)
  };
}

export function resolveAgentKnowledgeScope({
  allPapers,
  fallbackImportedChunksByPaperId,
  fallbackSelectedPapers,
  getImportedChunksForPaperId,
  request
}: AgentKnowledgeScopeInput) {
  const sourcePaperIds = getAgentRequestSelectionPaperIds(request);
  if (!sourcePaperIds) {
    return {
      importedChunksByPaperId: fallbackImportedChunksByPaperId,
      selectedPapers: fallbackSelectedPapers
    };
  }

  const sourcePaperIdSet = new Set(sourcePaperIds);
  const paperById = new Map(allPapers.map((paper) => [paper.id, paper]));
  return {
    importedChunksByPaperId: Object.fromEntries(
      sourcePaperIds.map((paperId) => [
        paperId,
        getImportedChunksForPaperId?.(paperId) ?? fallbackImportedChunksByPaperId[paperId] ?? []
      ])
    ),
    selectedPapers: sourcePaperIds.flatMap((paperId) => {
      const paper = paperById.get(paperId);
      return paper && sourcePaperIdSet.has(paper.id) ? [paper] : [];
    })
  };
}
