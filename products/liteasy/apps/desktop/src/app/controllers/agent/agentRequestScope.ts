import type { SubmitAgentTurnRequest } from "../../features/agent-api/agentApi.types";
import type { PaperIdentityCandidate } from "../../features/paper-identity/paperIdentity";
import type { RetrievalChunk } from "../../features/retrieval/retrieval.types";
import type {
  ThinReadingAncestorSummary,
  ThinReadingClaim,
  ThinReadingEvidenceSpan,
  ThinReadingExternalSource,
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

function normalizeThinReadingSource(value: unknown): ThinReadingNodeSource | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Partial<ThinReadingNodeSource>;
  if (source.kind === "root_overview") {
    return { kind: "root_overview" };
  }
  if (source.kind === "omitted_section") {
    if (
      typeof source.label !== "string" || source.label.trim().length === 0 || source.label.length > 96 ||
      typeof source.sectionKey !== "string" || source.sectionKey.trim().length === 0 || source.sectionKey.length > 96
    ) {
      return undefined;
    }
    return {
      kind: "omitted_section",
      label: source.label.trim(),
      sectionKey: source.sectionKey.trim()
    };
  }
  if (source.kind === "selected_text") {
    const evidenceIds = source.evidenceIds;
    const externalSourceIds = source.externalSourceIds;
    const expectedOutput = source.quickCommand === "mermaid_causal"
      ? "mermaid"
      : source.quickCommand === "html_algorithm_animation" || source.quickCommand === "html_svg_structure"
        ? "html_demo"
        : undefined;
    if (
      typeof source.excerpt !== "string" || source.excerpt.trim().length === 0 || source.excerpt.length > 1_600 ||
      (source.prompt !== undefined && (typeof source.prompt !== "string" || source.prompt.length > 600)) ||
      (source.quickCommand !== undefined && source.quickCommand !== "html_algorithm_animation" &&
        source.quickCommand !== "html_svg_structure" && source.quickCommand !== "mermaid_causal") ||
      (source.requestedOutput !== undefined && source.requestedOutput !== "explanation" &&
        source.requestedOutput !== "html_demo" && source.requestedOutput !== "mermaid") ||
      (expectedOutput !== undefined && source.requestedOutput !== expectedOutput) ||
      (evidenceIds !== undefined && (!isStringArray(evidenceIds) || evidenceIds.length > 12 || evidenceIds.some((id) => id.trim().length === 0 || id.length > 160))) ||
      (externalSourceIds !== undefined && (!isStringArray(externalSourceIds) || externalSourceIds.length > 12 || externalSourceIds.some((id) => id.trim().length === 0 || id.length > 180)))
    ) {
      return undefined;
    }
    return {
      ...(evidenceIds?.length ? { evidenceIds: [...new Set(evidenceIds)] } : {}),
      ...(externalSourceIds?.length ? { externalSourceIds: [...new Set(externalSourceIds)] } : {}),
      excerpt: source.excerpt.trim(),
      kind: "selected_text",
      ...(source.prompt?.trim() ? { prompt: source.prompt.trim() } : {}),
      ...(source.quickCommand ? { quickCommand: source.quickCommand } : {}),
      ...(source.requestedOutput ? { requestedOutput: source.requestedOutput } : {})
    };
  }
  return undefined;
}

function normalizeAvailableFigures(
  value: unknown
): ThinReadingGenerationContext["availableFigures"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const boundedValue = value.slice(0, 24);
  const figures = boundedValue.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const figure = item as NonNullable<ThinReadingGenerationContext["availableFigures"]>[number];
    if (
      typeof figure.id !== "string" || !figure.id.trim() || figure.id.length > 180 ||
      typeof figure.title !== "string" || !figure.title.trim() || figure.title.length > 240 ||
      typeof figure.page !== "number" || !Number.isFinite(figure.page) || figure.page < 1 ||
      (figure.description !== undefined && (typeof figure.description !== "string" || figure.description.length > 600)) ||
      (figure.importance !== undefined && figure.importance !== "primary" &&
        figure.importance !== "supporting" && figure.importance !== "reference") ||
      (figure.kind !== undefined && figure.kind !== "architecture" && figure.kind !== "chart" &&
        figure.kind !== "comparison" && figure.kind !== "example" && figure.kind !== "formula" &&
        figure.kind !== "result" && figure.kind !== "table" && figure.kind !== "workflow" &&
        figure.kind !== "other") ||
      (figure.placement !== undefined && figure.placement !== "overview" &&
        figure.placement !== "evidence" && figure.placement !== "method" &&
        figure.placement !== "results")
    ) {
      return [];
    }
    return [{
      description: figure.description?.trim(),
      id: figure.id.trim(),
      importance: figure.importance,
      kind: figure.kind,
      page: Math.trunc(figure.page),
      placement: figure.placement,
      title: figure.title.trim()
    }];
  });
  return figures.length === boundedValue.length ? figures : undefined;
}

function normalizeAncestorSummaries(value: unknown): ThinReadingAncestorSummary[] | undefined {
  if (!Array.isArray(value) || value.length > 16) {
    return undefined;
  }
  const summaries = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const candidate = item as Partial<ThinReadingAncestorSummary>;
    if (
      typeof candidate.nodeId !== "string" || candidate.nodeId.trim().length === 0 || candidate.nodeId.length > 180 ||
      typeof candidate.title !== "string" || candidate.title.trim().length === 0 || candidate.title.length > 240 ||
      typeof candidate.summary !== "string" || candidate.summary.trim().length === 0 || candidate.summary.length > 2_400
    ) {
      return [];
    }
    return [{
      nodeId: candidate.nodeId.trim(),
      summary: candidate.summary.trim(),
      title: candidate.title.trim()
    }];
  });
  return summaries.length === value.length ? summaries : undefined;
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
    (span.page === undefined || typeof span.page === "number") &&
    (span.pageTextStart === undefined || typeof span.pageTextStart === "number") &&
    (span.pageTextEnd === undefined || typeof span.pageTextEnd === "number");
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
      pageTextEnd: span.pageTextEnd,
      pageTextStart: span.pageTextStart,
      paperId: span.paperId,
      quote: span.quote
    }));
  return spans.length > 0 ? spans : undefined;
}

function normalizeExternalSources(value: unknown): ThinReadingGenerationContext["externalSources"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const sources = value.filter(isCanonicalExternalSource);
  return sources.length > 0
    ? sources.map((source) => ({
        abstract: source.abstract,
        authors: [...source.authors],
        doi: "doi" in source && typeof source.doi === "string" ? source.doi : undefined,
        id: source.id,
        provider: source.provider,
        relation: source.relation,
        relevance: source.relevance,
        retrievalQuery: source.retrievalQuery,
        sourceRecordUrl: source.sourceRecordUrl,
        sourceId: source.sourceId,
        title: source.title,
        url: source.url,
        year: "year" in source && typeof source.year === "number" ? source.year : undefined
      }))
    : undefined;
}

function hasExternalSourceContent(source: Partial<ThinReadingExternalSource>) {
  return typeof source.url === "string" && /^https:\/\//i.test(source.url) &&
    typeof source.title === "string" && source.title.trim().length > 0 &&
    typeof source.abstract === "string" &&
    Array.isArray(source.authors) && source.authors.every((author) => typeof author === "string") &&
    typeof source.relevance === "number" && Number.isFinite(source.relevance) &&
    typeof source.retrievalQuery === "string";
}

function isCanonicalExternalSource(value: unknown): value is ThinReadingExternalSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const source = value as Partial<ThinReadingExternalSource>;
  const sourceId = source.sourceId?.trim().toUpperCase() ?? "";
  const isOpenAlex = source.provider === "openalex" &&
    /^W\d+$/.test(sourceId) &&
    source.id === `openalex:${sourceId}` &&
    source.sourceRecordUrl === `https://openalex.org/${sourceId}` &&
    (source.relation === "cited_by_target" ||
      source.relation === "cites_target" ||
      source.relation === "related" ||
      source.relation === "topic_search");
  const crossrefDoi = source.sourceId?.trim().toLowerCase() ?? "";
  const isCrossref = source.provider === "crossref" &&
    /^[^\s/]+\/[^\s]+$/.test(crossrefDoi) &&
    source.id === `crossref:${crossrefDoi}` &&
    source.doi === `https://doi.org/${crossrefDoi}` &&
    source.url === `https://doi.org/${crossrefDoi}` &&
    source.sourceRecordUrl === `https://api.crossref.org/works/${encodeURIComponent(crossrefDoi)}` &&
    source.relation === "topic_search";
  return (isOpenAlex || isCrossref) && hasExternalSourceContent(source);
}

function isPaperIdentityKind(value: unknown): value is PaperIdentityCandidate["kind"] {
  return value === "doi" ||
    value === "arxiv_id" ||
    value === "semantic_scholar_id" ||
    value === "openalex_id" ||
    value === "title_authors_year_hash" ||
    value === "local_paper_id";
}

function isPaperIdentitySource(value: unknown): value is PaperIdentityCandidate["source"] {
  return value === "inferred" || value === "local" || value === "metadata";
}

function normalizePaperIdentityCandidate(value: unknown): PaperIdentityCandidate | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Partial<PaperIdentityCandidate>;
  const kind = candidate.kind;
  const source = candidate.source;
  if (
    !isPaperIdentityKind(kind) ||
    !isPaperIdentitySource(source) ||
    typeof candidate.value !== "string" ||
    candidate.value.trim().length === 0 ||
    candidate.id !== `${candidate.kind}:${candidate.value}`
  ) {
    return undefined;
  }
  return {
    id: candidate.id,
    kind,
    source,
    value: candidate.value
  };
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
  const source = normalizeThinReadingSource(candidate.source);
  if (
    typeof candidate.artifactId !== "string" ||
    typeof candidate.depth !== "number" ||
    !Array.isArray(candidate.paperIds) ||
    !candidate.paperIds.every((paperId) => typeof paperId === "string") ||
    !source ||
    typeof candidate.targetLanguage !== "string"
  ) {
    return null;
  }
  const selectedExternalSources = normalizeExternalSources(candidate.selectedExternalSources);
  if (selectedExternalSources?.length) {
    const selectedExternalSourceIds = source.kind === "selected_text"
      ? new Set(source.externalSourceIds ?? [])
      : new Set<string>();
    if (
      selectedExternalSourceIds.size !== selectedExternalSources.length ||
      selectedExternalSources.some((externalSource) => !selectedExternalSourceIds.has(externalSource.id))
    ) {
      return null;
    }
  }
  return {
    ancestorSummaries: normalizeAncestorSummaries(candidate.ancestorSummaries),
    availableFigures: normalizeAvailableFigures(candidate.availableFigures),
    artifactId: candidate.artifactId,
    depth: candidate.depth,
    paperIds: [...candidate.paperIds],
    primaryPaperId: typeof candidate.primaryPaperId === "string" ? candidate.primaryPaperId : undefined,
    primaryPaperIdentity: normalizePaperIdentityCandidate(candidate.primaryPaperIdentity),
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
    source,
    targetLanguage: candidate.targetLanguage,
    externalSources: normalizeExternalSources(candidate.externalSources),
    selectedExternalSources
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
