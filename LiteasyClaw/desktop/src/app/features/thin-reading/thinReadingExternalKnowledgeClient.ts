import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { ThinReadingExternalSource } from "./thinReading.types";

export type ThinReadingExternalKnowledgeTransport = (request: {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  signal?: AbortSignal;
  url: string;
}) => Promise<ModelTransportResponse>;

type SearchInput = {
  artifactId: string;
  intent?: "challenge" | "context" | "support";
  limit?: number;
  query: string;
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
};

function isExternalSource(value: unknown): value is ThinReadingExternalSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const source = value as Partial<ThinReadingExternalSource>;
  const sourceId = source.sourceId?.trim().toUpperCase() ?? "";
  const isOpenAlex = source.provider === "openalex" &&
    /^W\d+$/.test(sourceId) &&
    source.id === `openalex:${sourceId}` &&
    source.sourceRecordUrl === `https://openalex.org/${sourceId}`;
  const crossrefDoi = source.sourceId?.trim().toLowerCase() ?? "";
  const isCrossref = source.provider === "crossref" &&
    /^[^\s/]+\/[^\s]+$/.test(crossrefDoi) &&
    source.id === `crossref:${crossrefDoi}` &&
    source.doi === `https://doi.org/${crossrefDoi}` &&
    source.url === `https://doi.org/${crossrefDoi}` &&
    source.sourceRecordUrl === `https://api.crossref.org/works/${encodeURIComponent(crossrefDoi)}` &&
    source.relation === "topic_search";
  const arxivId = source.sourceId?.trim() ?? "";
  const isArxiv = source.provider === "arxiv" &&
    /^(?:[a-z-]+(?:\.[a-z]{2})?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/i.test(arxivId) &&
    source.id === `arxiv:${arxivId}` &&
    source.arxivId === arxivId &&
    source.url === `https://arxiv.org/abs/${arxivId}` &&
    source.sourceRecordUrl === source.url &&
    source.relation === "topic_search";
  return (isOpenAlex || isCrossref || isArxiv) &&
    typeof source.url === "string" && /^https:\/\//i.test(source.url) &&
    typeof source.title === "string" && source.title.trim().length > 0 &&
    typeof source.abstract === "string" &&
    Array.isArray(source.authors) && source.authors.every((author) => typeof author === "string") &&
    (source.relation === "cited_by_target" ||
      source.relation === "cites_target" ||
      source.relation === "related" ||
      source.relation === "topic_search") &&
    typeof source.relevance === "number" && Number.isFinite(source.relevance) &&
    (source.fullTextUrl === undefined || (typeof source.fullTextUrl === "string" && /^https:\/\//i.test(source.fullTextUrl))) &&
    (source.isRetracted === undefined || typeof source.isRetracted === "boolean") &&
    typeof source.retrievalQuery === "string";
}

export function isTrustedThinReadingExternalSource(source: ThinReadingExternalSource) {
  return source.isRetracted !== true &&
    source.abstract.replace(/\s+/g, " ").trim().length >= 16;
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

export function createThinReadingExternalKnowledgeClient(input: {
  endpoint: string;
  openAlexApiKey?: string;
  transport?: ThinReadingExternalKnowledgeTransport;
}) {
  return async (search: SearchInput): Promise<ThinReadingExternalKnowledgeResult> => {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(search.artifactId)) {
      throw new Error("外部文献检索缺少有效 artifactId");
    }
    const openAlexApiKey = input.openAlexApiKey?.trim() ?? "";
    if (openAlexApiKey && (openAlexApiKey.length > 512 || /\s/.test(openAlexApiKey))) {
      throw new Error("OpenAlex API 密钥格式无效，请在设置中重新配置。");
    }
    const response = await (input.transport ?? defaultTransport)({
      body: JSON.stringify({
        artifactId: search.artifactId,
        limit: search.limit ?? thinReadingExternalCandidateLimit,
        query: search.query,
        targetPaperIdentity: search.targetPaperIdentity,
        targetPaperTitle: search.targetPaperTitle
      }),
      headers: {
        "Content-Type": "application/json",
        ...(openAlexApiKey ? { "X-OpenAlex-Api-Key": openAlexApiKey } : {})
      },
      method: "POST",
      signal: search.signal,
      url: `${input.endpoint.replace(/\/+$/, "")}/v1/research/external-knowledge`
    });
    if (!response.ok) {
      try {
        const payload = await response.json();
        if (
          payload && typeof payload === "object" &&
          (payload as { error?: unknown }).error === "openalex_api_key_required" &&
          typeof (payload as { message?: unknown }).message === "string"
        ) {
          throw new Error((payload as { message: string }).message);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("OpenAlex")) {
          throw error;
        }
      }
      throw new Error(`外部文献检索失败（${response.status}）`);
    }
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
    const sources = payload.sources as ThinReadingExternalSource[];
    return {
      ...(isRetrievalState("retrieval" in payload ? payload.retrieval : undefined)
        ? { retrieval: payload.retrieval }
        : {}),
      sources: sources.filter(isTrustedThinReadingExternalSource).map((source) => ({
        ...source,
        evidenceBasis: "abstract" as const,
        retrievalIntents: [search.intent ?? "support"],
        retrievalQueries: [search.query]
      }))
    };
  };
}
