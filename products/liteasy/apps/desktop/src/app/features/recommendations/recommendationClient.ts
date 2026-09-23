import type { ModelTransportResponse } from "../models/modelHttpClient";
import { readCloudServiceError } from "../network/cloudErrorMessage";
import type {
  RecommendationItem,
  RecommendationStyle,
  RecommendationRequestDocument,
  RecommendationResearchProfile
} from "./recommendation.types";

export type RecommendationTransportRequest = {
  signal?: AbortSignal;
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
  style?: RecommendationStyle;
  signal?: AbortSignal;
  researchProfile?: RecommendationResearchProfile;
  selectedDocuments: RecommendationRequestDocument[];
  sessionId: string;
};

function buildRecommendationUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/recommendations`;
}

function hasValidFinalScore(item: object) {
  if (!("scoreComponents" in item) || item.scoreComponents === undefined) return true;
  const components = item.scoreComponents;
  if (!components || typeof components !== "object") return false;
  return !("finalScore" in components) || (typeof components.finalScore === "number" &&
    Number.isFinite(components.finalScore) && components.finalScore >= 0 && components.finalScore <= 1);
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
  const hasValidSourceKind = sourceKind === "cache" || sourceKind === "live";
  const hasValidSourceUrl =
    sourceKind === "live"
      ? typeof sourceUrl === "string" && sourceUrl.trim().length > 0
      : sourceUrl === undefined || typeof sourceUrl === "string";
  const openAccessAvailable = item && typeof item === "object" && "openAccessAvailable" in item
    ? item.openAccessAvailable
    : undefined;
  return (
    typeof item === "object" &&
    item !== null &&
    hasValidFinalScore(item) &&
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
    Number.isFinite(item.relevanceScore) && item.relevanceScore >= 0 && item.relevanceScore <= 1 &&
    (!("citationCount" in item) || (typeof item.citationCount === "number" && Number.isSafeInteger(item.citationCount) && item.citationCount >= 0)) &&
    (!("publishedAt" in item) || typeof item.publishedAt === "string") &&
    (!("rankingStyle" in item) || ["balanced", "frontier", "classic", "exploratory"].includes(item.rankingStyle as string)) &&
    (!("styleScore" in item) || (typeof item.styleScore === "number" && Number.isFinite(item.styleScore) && item.styleScore >= 0 && item.styleScore <= 1)) &&
    "reason" in item &&
    typeof item.reason === "string" &&
    "source" in item &&
    typeof item.source === "string" &&
    hasValidSourceKind &&
    hasValidSourceUrl &&
    (openAccessAvailable === undefined || typeof openAccessAvailable === "boolean") &&
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
    method: request.method,
    signal: request.signal
  });
}

export function createRecommendationClient({
  endpoint,
  transport = defaultTransport
}: CreateRecommendationClientInput) {
  return async ({
    style,
    signal,
    researchProfile,
    selectedDocuments,
    sessionId
  }: RecommendationClientInput): Promise<RecommendationItem[]> => {
    signal?.throwIfAborted();
    const response = await transport({
      ...(signal ? { signal } : {}),
      body: JSON.stringify({
        ...(style ? { style } : {}),
        ...(researchProfile ? { researchProfile } : {}),
        selectedDocuments: selectedDocuments.slice(0, 3),
        sessionId
      }),
      headers: {
        Authorization: `Bearer ${sessionId}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      url: buildRecommendationUrl(endpoint)
    });

    if (!response.ok) {
      throw await readCloudServiceError(response, {
        code: "recommendation_request_failed",
        message: "关联推荐获取失败，请稍后重试。"
      });
    }

    const payload = await response.json();
    signal?.throwIfAborted();
    if (!isRecommendationPayload(payload)) {
      throw new Error("关联推荐返回格式无效");
    }

    return payload.recommendations;
  };
}
