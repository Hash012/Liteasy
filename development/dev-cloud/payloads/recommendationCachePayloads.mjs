import {
  clearRecommendationCache,
  getRecommendationCache,
  putRecommendationCache
} from "../db/recommendationCacheRepository.mjs";

function isScope(body = {}) {
  return (
    typeof body.selectionKey === "string" &&
    typeof body.sessionId === "string" &&
    (typeof body.personalizationVersion === "undefined" ||
      (Number.isInteger(body.personalizationVersion) && body.personalizationVersion >= 0)) &&
    (body.sortMode === "relevance" || body.sortMode === "retrieved_at") &&
    typeof body.workspaceKey === "string"
  );
}

function isRecommendationItem(item) {
  const hasValidSourceKind =
    item?.sourceKind === "cache" ||
    item?.sourceKind === "live";
  const hasValidSourceUrl =
    item?.sourceKind === "live"
      ? typeof item?.sourceUrl === "string" && item.sourceUrl.trim().length > 0
      : item?.sourceUrl === undefined || typeof item.sourceUrl === "string";
  return (
    typeof item === "object" &&
    item !== null &&
    typeof item.discoveredAt === "string" &&
    typeof item.id === "string" &&
    typeof item.relatedDocumentTitle === "string" &&
    (item.relevanceBand === "high" ||
      item.relevanceBand === "medium" ||
      item.relevanceBand === "low") &&
    typeof item.relevanceScore === "number" &&
    typeof item.reason === "string" &&
    typeof item.source === "string" &&
    hasValidSourceKind &&
    hasValidSourceUrl &&
    typeof item.title === "string"
  );
}

function getScope(body) {
  return {
    personalizationVersion:
      typeof body.personalizationVersion === "number" ? body.personalizationVersion : 0,
    selectionKey: body.selectionKey,
    sessionId: body.sessionId,
    sortMode: body.sortMode,
    workspaceKey: body.workspaceKey
  };
}

export function buildRecommendationCacheGetPayload(body = {}) {
  if (!isScope(body)) {
    return {
      error: "invalid_recommendation_cache_scope"
    };
  }

  return getRecommendationCache(getScope(body));
}

export function buildRecommendationCachePutPayload(body = {}) {
  if (!isScope(body) || !Array.isArray(body.recommendations) || !body.recommendations.every(isRecommendationItem)) {
    return {
      error: "invalid_recommendation_cache_payload"
    };
  }

  return putRecommendationCache(getScope(body), body.recommendations);
}

export function buildRecommendationCacheClearPayload(body = {}) {
  if (!isScope(body)) {
    return {
      error: "invalid_recommendation_cache_scope"
    };
  }

  return clearRecommendationCache(getScope(body));
}
