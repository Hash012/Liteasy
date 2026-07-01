import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { RecommendationItem } from "./recommendation.types";
import type {
  RecommendationCacheClearResult,
  RecommendationCacheLookupResult,
  RecommendationCachePutResult,
  RecommendationCacheScope
} from "./recommendationCache.types";

export type RecommendationCacheTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type RecommendationCacheTransport = (
  request: RecommendationCacheTransportRequest
) => Promise<ModelTransportResponse>;

type CreateRecommendationCacheClientInput = {
  endpoint: string;
  transport?: RecommendationCacheTransport;
};

function buildCacheUrl(endpoint: string, action: "get" | "put" | "clear") {
  return `${endpoint.replace(/\/+$/, "")}/v1/recommendation-cache/${action}`;
}

function isRecommendationItem(item: unknown): item is RecommendationItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "discoveredAt" in item &&
    typeof item.discoveredAt === "string" &&
    "id" in item &&
    typeof item.id === "string" &&
    "relatedDocumentTitle" in item &&
    typeof item.relatedDocumentTitle === "string" &&
    "relevanceBand" in item &&
    (item.relevanceBand === "high" ||
      item.relevanceBand === "medium" ||
      item.relevanceBand === "low") &&
    "relevanceScore" in item &&
    typeof item.relevanceScore === "number" &&
    "reason" in item &&
    typeof item.reason === "string" &&
    "source" in item &&
    typeof item.source === "string" &&
    "title" in item &&
    typeof item.title === "string"
  );
}

function isLookupPayload(payload: unknown): payload is RecommendationCacheLookupResult {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "cacheHit" in payload &&
    typeof payload.cacheHit === "boolean" &&
    "recommendations" in payload &&
    Array.isArray(payload.recommendations) &&
    payload.recommendations.every(isRecommendationItem)
  );
}

function isPutPayload(payload: unknown): payload is RecommendationCachePutResult {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "cachedAt" in payload &&
    typeof payload.cachedAt === "string" &&
    "ok" in payload &&
    payload.ok === true
  );
}

function isClearPayload(payload: unknown): payload is RecommendationCacheClearResult {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "cleared" in payload &&
    typeof payload.cleared === "boolean"
  );
}

async function defaultTransport(
  request: RecommendationCacheTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createRecommendationCacheClient({
  endpoint,
  transport = defaultTransport
}: CreateRecommendationCacheClientInput) {
  return {
    async get(scope: RecommendationCacheScope): Promise<RecommendationCacheLookupResult> {
      const response = await transport({
        body: JSON.stringify(scope),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST",
        url: buildCacheUrl(endpoint, "get")
      });

      if (!response.ok) {
        throw new Error(`关联推荐缓存读取失败（${response.status}）`);
      }

      const payload = await response.json();
      if (!isLookupPayload(payload)) {
        throw new Error("关联推荐缓存返回格式无效");
      }

      return payload;
    },
    async put(
      scope: RecommendationCacheScope,
      recommendations: RecommendationItem[]
    ): Promise<RecommendationCachePutResult> {
      const response = await transport({
        body: JSON.stringify({
          ...scope,
          recommendations
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST",
        url: buildCacheUrl(endpoint, "put")
      });

      if (!response.ok) {
        throw new Error(`关联推荐缓存写入失败（${response.status}）`);
      }

      const payload = await response.json();
      if (!isPutPayload(payload)) {
        throw new Error("关联推荐缓存返回格式无效");
      }

      return payload;
    },
    async clear(scope: RecommendationCacheScope): Promise<RecommendationCacheClearResult> {
      const response = await transport({
        body: JSON.stringify(scope),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST",
        url: buildCacheUrl(endpoint, "clear")
      });

      if (!response.ok) {
        throw new Error(`关联推荐缓存清理失败（${response.status}）`);
      }

      const payload = await response.json();
      if (!isClearPayload(payload)) {
        throw new Error("关联推荐缓存返回格式无效");
      }

      return payload;
    }
  };
}
