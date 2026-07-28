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
  limit?: number;
  query: string;
  signal?: AbortSignal;
  targetPaperTitle?: string;
  targetPaperIdentity?: {
    kind: string;
    value: string;
  };
};

function isExternalSource(value: unknown): value is ThinReadingExternalSource {
  return Boolean(
    value &&
    typeof value === "object" &&
    "abstract" in value && typeof value.abstract === "string" &&
    "authors" in value && Array.isArray(value.authors) && value.authors.every((author) => typeof author === "string") &&
    "id" in value && typeof value.id === "string" &&
    "provider" in value && value.provider === "openalex" &&
    "relation" in value && (
      value.relation === "cited_by_target" ||
      value.relation === "cites_target" ||
      value.relation === "related" ||
      value.relation === "topic_search"
    ) &&
    "relevance" in value && typeof value.relevance === "number" &&
    "retrievalQuery" in value && typeof value.retrievalQuery === "string" &&
    "sourceId" in value && typeof value.sourceId === "string" &&
    "title" in value && typeof value.title === "string" &&
    "url" in value && typeof value.url === "string"
  );
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
  transport?: ThinReadingExternalKnowledgeTransport;
}) {
  return async (search: SearchInput): Promise<ThinReadingExternalSource[]> => {
    const response = await (input.transport ?? defaultTransport)({
      body: JSON.stringify({
        limit: search.limit ?? 5,
        query: search.query,
        targetPaperIdentity: search.targetPaperIdentity,
        targetPaperTitle: search.targetPaperTitle
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: search.signal,
      url: `${input.endpoint.replace(/\/+$/, "")}/v1/research/external-knowledge`
    });
    if (!response.ok) {
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
    return payload.sources;
  };
}
