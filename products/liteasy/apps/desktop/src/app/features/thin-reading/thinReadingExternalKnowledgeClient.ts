import type { ModelTransportResponse } from "../models/modelHttpClient";
import { externalSourceProviderContract } from "./externalSourceProviders";
import type { ThinReadingExternalSource } from "./thinReading.types";

export type ThinReadingExternalKnowledgeTransport = (request: {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  signal?: AbortSignal;
  url: string;
}) => Promise<ModelTransportResponse>;

type SearchInput = {
  /**
   * The references the paper cites next to this anchor, as printed. The provider pipeline resolves
   * them and uses them instead of the whole paper's
   * citation neighbourhood — which measured 40% relevant against an anchor, against 68% for
   * plain topic search.
   */
  anchorReferences?: readonly { number: number; text: string }[];
  artifactId: string;
  intent?: "challenge" | "context" | "support";
  limit?: number;
  query: string;
  queryVariants?: readonly string[];
  signal?: AbortSignal;
  targetPaperTitle?: string;
  targetPaperIdentity?: {
    kind: string;
    value: string;
  };
};

export const thinReadingExternalCandidateLimit = 32;

export type ThinReadingExternalRetrievalState = {
  attempts: number;
  id: string;
  reused: boolean;
  status: "completed" | "skipped";
};

export type ThinReadingExternalKnowledgeResult = {
  retrieval?: ThinReadingExternalRetrievalState;
  sources: ThinReadingExternalSource[];
  warnings?: string[];
};

function isExternalSource(value: unknown): value is ThinReadingExternalSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const source = value as Partial<ThinReadingExternalSource>;
  const provider = source.provider;
  const sourceId = source.sourceId?.trim() ?? "";
  const providerContract = externalSourceProviderContract(provider);
  const validRelation = source.relation === "bibliographic_coupling" ||
    source.relation === "cited_by_target" || source.relation === "cites_target" ||
    source.relation === "co_cited" || source.relation === "related" ||
    source.relation === "topic_search";
  const recordUrl = source.sourceRecordUrl?.trim() ?? "";
  return Boolean(providerContract) && providerContract!.validIdentity(source, sourceId) &&
    source.id === `${provider}:${sourceId}` &&
    typeof source.url === "string" && /^https:\/\//i.test(source.url) &&
    typeof source.title === "string" && source.title.trim().length > 0 &&
    typeof source.abstract === "string" &&
    Array.isArray(source.authors) && source.authors.every((author) => typeof author === "string") &&
    recordUrl === providerContract!.recordUrl(sourceId) &&
    validRelation &&
    typeof source.relevance === "number" && Number.isFinite(source.relevance) &&
    (source.fullTextGrantId === undefined || (typeof source.fullTextGrantId === "string" && /^pdfgrant_[A-Za-z0-9-]+$/.test(source.fullTextGrantId))) &&
    (source.fullTextUrl === undefined || (typeof source.fullTextUrl === "string" && /^https:\/\//i.test(source.fullTextUrl))) &&
    (source.isRetracted === undefined || typeof source.isRetracted === "boolean") &&
    typeof source.retrievalQuery === "string";
}

export function isTrustedThinReadingExternalSource(
  source: ThinReadingExternalSource,
  options: { allowVerifiedGraphMetadataOnly?: boolean } = {}
) {
  const hasReviewableAbstract = source.abstract.replace(/\s+/g, " ").trim().length >= 16;
  const canUseVerifiedMetadataOnly =
    externalSourceProviderContract(source.provider)?.acceptsMetadataOnly === true &&
    source.title.trim().length >= 16;
  const isVerifiedGraphRecord = options.allowVerifiedGraphMetadataOnly === true &&
    source.provider === "openalex" &&
    source.title.trim().length >= 16 &&
    source.relation !== "topic_search" &&
    (source.confidenceBasis === "author_citation" || source.confidenceBasis === "citation_graph");
  return source.isRetracted !== true &&
    (hasReviewableAbstract || canUseVerifiedMetadataOnly || isVerifiedGraphRecord);
}

function isRetrievalState(value: unknown): value is ThinReadingExternalRetrievalState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const state = value as Partial<ThinReadingExternalRetrievalState>;
  return typeof state.id === "string" && state.id.length > 0 &&
    typeof state.attempts === "number" && Number.isInteger(state.attempts) && state.attempts > 0 &&
    typeof state.reused === "boolean" &&
    (state.status === "completed" || state.status === "skipped");
}

async function defaultTransport(request: Parameters<ThinReadingExternalKnowledgeTransport>[0]) {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method,
    signal: request.signal
  });
}

async function responseError(response: ModelTransportResponse) {
  try {
    const payload = await response.json();
    if (payload && typeof payload === "object" && typeof (payload as { message?: unknown }).message === "string") {
      return new Error((payload as { message: string }).message);
    }
  } catch {
    // The status below remains useful when an upstream proxy did not return JSON.
  }
  return new Error(`外部文献检索失败（${response.status}）`);
}

async function fetchServerKnowledge(input: {
  body: Record<string, unknown>;
  endpoint: string;
  signal?: AbortSignal;
  transport: ThinReadingExternalKnowledgeTransport;
}) {
  const response = await input.transport({
    body: JSON.stringify(input.body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: input.signal,
    url: `${input.endpoint.replace(/\/+$/, "")}/v1/research/external-knowledge`
  });
  if (!response.ok) throw await responseError(response);
  const payload = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    !("sources" in payload) ||
    !Array.isArray(payload.sources) ||
    !payload.sources.every(isExternalSource)
  ) {
    throw new Error("外部文献检索返回格式无效");
  }
  const retrieval = "retrieval" in payload ? payload.retrieval : undefined;
  const anchorResolution = "anchorReferenceResolution" in payload &&
    payload.anchorReferenceResolution && typeof payload.anchorReferenceResolution === "object"
    ? payload.anchorReferenceResolution as { resolved?: unknown; unmatched?: unknown }
    : undefined;
  const unmatched = Array.isArray(anchorResolution?.unmatched)
    ? anchorResolution.unmatched.filter((value): value is number => Number.isInteger(value))
    : [];
  return {
    retrieval: isRetrievalState(retrieval) ? retrieval : undefined,
    sources: payload.sources as ThinReadingExternalSource[],
    warnings: unmatched.length > 0
      ? [`有 ${unmatched.length} 条锚点附近的参考文献尚未解析到学术图谱，已保留主题检索结果。`]
      : []
  };
}

export function createThinReadingExternalKnowledgeClient(input: {
  endpoint: string;
  transport?: ThinReadingExternalKnowledgeTransport;
}) {
  return async (search: SearchInput): Promise<ThinReadingExternalKnowledgeResult> => {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(search.artifactId)) {
      throw new Error("外部文献检索缺少有效 artifactId");
    }
    const limit = search.limit ?? thinReadingExternalCandidateLimit;
    const requestBody = {
      // Presence identifies an anchor-aware request. Keep `[]`: it tells every provider that this
      // anchor has no local citation and must not fall back to the paper's whole citation graph.
      ...(search.anchorReferences ? { anchorReferences: search.anchorReferences } : {}),
      artifactId: search.artifactId,
      includeArxiv: (search.intent ?? "support") === "support",
      includeExpandedSources: true,
      // OpenAlex credentials are deployment secrets. The desktop only requests the capability;
      // it can never read, forward, or persist the service-owned key.
      includeOpenAlex: true,
      limit,
      query: search.query,
      ...(search.queryVariants && search.queryVariants.length > 1
        ? { queryVariants: search.queryVariants.slice(0, 2) }
        : {}),
      targetPaperIdentity: search.targetPaperIdentity,
      targetPaperTitle: search.targetPaperTitle
    };
    const serverResult = await fetchServerKnowledge({
      body: requestBody,
      endpoint: input.endpoint,
      signal: search.signal,
      transport: input.transport ?? defaultTransport
    });
    if (!Array.isArray(serverResult.sources) || !serverResult.sources.every(isExternalSource)) {
      throw new Error("外部文献检索返回格式无效");
    }
    const sources = serverResult.sources as ThinReadingExternalSource[];
    return {
      ...(serverResult.retrieval ? { retrieval: serverResult.retrieval } : {}),
      ...(serverResult.warnings.length > 0 ? { warnings: serverResult.warnings } : {}),
      sources: sources.filter((source) => isTrustedThinReadingExternalSource(source, {
        allowVerifiedGraphMetadataOnly: search.intent === "context"
      })).map((source) => ({
        ...source,
        evidenceBasis: "abstract" as const,
        retrievalIntents: [search.intent ?? "support"],
        retrievalQueries: [search.query]
      }))
    };
  };
}
