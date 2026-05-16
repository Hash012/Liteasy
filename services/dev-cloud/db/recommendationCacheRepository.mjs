import { readJsonFile, writeJsonFile } from "./jsonFileStore.mjs";

const recommendationCacheFilename = "recommendation-cache.json";

function buildScopeKey(scope) {
  return [
    scope.sessionId,
    scope.workspaceKey,
    scope.selectionKey,
    scope.sortMode
  ].join("::");
}

function readRecommendationCacheState() {
  return readJsonFile(recommendationCacheFilename, {});
}

export function getRecommendationCache(scope) {
  const state = readRecommendationCacheState();
  const entry = state[buildScopeKey(scope)];

  if (!entry) {
    return {
      cacheHit: false,
      recommendations: []
    };
  }

  return {
    cacheHit: true,
    recommendations: Array.isArray(entry.recommendations) ? entry.recommendations : []
  };
}

export function putRecommendationCache(scope, recommendations) {
  const state = readRecommendationCacheState();
  const cachedAt = new Date().toISOString();

  state[buildScopeKey(scope)] = {
    cachedAt,
    recommendations
  };
  writeJsonFile(recommendationCacheFilename, state);

  return {
    cachedAt,
    ok: true
  };
}

export function clearRecommendationCache(scope) {
  const state = readRecommendationCacheState();
  delete state[buildScopeKey(scope)];
  writeJsonFile(recommendationCacheFilename, state);

  return {
    cleared: true
  };
}
