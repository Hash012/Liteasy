import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { RecommendationItem, RecommendationRequestDocument } from "./recommendation.types";

export type RecommendationTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type RecommendationTransport = (
  request: RecommendationTransportRequest
) => Promise<ModelTransportResponse>;

type CreateRecommendationClientInput = {
  endpoint: string;
  transport?: RecommendationTransport;
};

type RecommendationPayload = {
  recommendations: RecommendationItem[];
};

type RecommendationClientInput = {
  selectedDocuments: RecommendationRequestDocument[];
  sessionId: string;
};

function buildRecommendationUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/recommendations`;
}

function isRecommendationItem(item: unknown): item is RecommendationItem {
  const sourceKind = item &&
    typeof item === "object" &&
    "sourceKind" in item
      ? item.sourceKind
      : undefined;
  const sourceUrl = item &&
    typeof item === "object" &&
    "sourceUrl" in item
      ? item.sourceUrl
      : undefined;
  const hasValidSourceKind = sourceKind === "cache" || sourceKind === "live" || sourceKind === "mock";
  const hasValidSourceUrl =
    sourceKind === "live"
      ? typeof sourceUrl === "string" && sourceUrl.trim().length > 0
      : sourceUrl === undefined || typeof sourceUrl === "string";
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
    (item.relevanceBand === "high" || item.relevanceBand === "medium" || item.relevanceBand === "low") &&
    "relevanceScore" in item &&
    typeof item.relevanceScore === "number" &&
    "reason" in item &&
    typeof item.reason === "string" &&
    "source" in item &&
    typeof item.source === "string" &&
    hasValidSourceKind &&
    hasValidSourceUrl &&
    "title" in item &&
    typeof item.title === "string"
  );
}

function isRecommendationPayload(payload: unknown): payload is RecommendationPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "recommendations" in payload &&
    Array.isArray(payload.recommendations) &&
    payload.recommendations.every(isRecommendationItem)
  );
}

async function defaultTransport(
  request: RecommendationTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export function createRecommendationClient({
  endpoint,
  transport = defaultTransport
}: CreateRecommendationClientInput) {
  return async ({
    selectedDocuments,
    sessionId
  }: RecommendationClientInput): Promise<RecommendationItem[]> => {
    const response = await transport({
      body: JSON.stringify({
        selectedDocuments,
        sessionId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildRecommendationUrl(endpoint)
    });

    if (!response.ok) {
      throw new Error(`关联推荐获取失败（${response.status}）`);
    }

    const payload = await response.json();
    if (!isRecommendationPayload(payload)) {
      throw new Error("关联推荐返回格式无效");
    }

    return payload.recommendations;
  };
}
