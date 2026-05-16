import {
  clearRecommendationCache,
  getRecommendationCache,
  putRecommendationCache
} from "../db/recommendationCacheRepository.mjs";

function isScope(body = {}) {
  return (
    typeof body.selectionKey === "string" &&
    typeof body.sessionId === "string" &&
    (body.sortMode === "relevance" || body.sortMode === "retrieved_at") &&
    typeof body.workspaceKey === "string"
  );
}

function isRecommendationItem(item) {
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
    typeof item.title === "string"
  );
}

function getScope(body) {
  return {
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
