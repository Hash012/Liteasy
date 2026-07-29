import { readJsonFile, writeJsonFile } from "./jsonFileStore.mjs";

const recommendationCacheFilename = "recommendation-cache.json";
const defaultRecommendationCacheMaxAgeMs = 24 * 60 * 60 * 1000;

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

export function getRecommendationCache(scope, options = {}) {
  const state = readRecommendationCacheState();
  const entry = state[buildScopeKey(scope)];

  if (!entry) {
    return {
      cacheHit: false,
      recommendations: []
    };
  }

  const cachedAt = typeof entry.cachedAt === "string" ? Date.parse(entry.cachedAt) : Number.NaN;
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs)
    ? Math.max(0, options.maxAgeMs)
    : defaultRecommendationCacheMaxAgeMs;
  if (!Number.isFinite(cachedAt) || now - cachedAt > maxAgeMs) {
    delete state[buildScopeKey(scope)];
    writeJsonFile(recommendationCacheFilename, state);
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

export function clearRecommendationCacheForSession(sessionId) {
  const state = readRecommendationCacheState();
  const prefix = `${sessionId}::`;
  let clearedCount = 0;
  for (const key of Object.keys(state)) {
    if (key.startsWith(prefix)) {
      delete state[key];
      clearedCount += 1;
    }
  }
  if (clearedCount > 0) {
    writeJsonFile(recommendationCacheFilename, state);
  }
  return clearedCount;
}

export function resetRecommendationCacheData() {
  writeJsonFile(recommendationCacheFilename, {});
  return {
    reset: true
  };
}
