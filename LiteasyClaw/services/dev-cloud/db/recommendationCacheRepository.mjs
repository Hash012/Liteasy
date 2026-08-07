const defaultRecommendationCacheMaxAgeMs = 24 * 60 * 60 * 1000;
const maximumRecommendationCacheEntriesPerOwner = 100;
let singleton;

function scopeKey(scope) {
  return [
    scope.workspaceKey,
    scope.selectionKey,
    scope.sortMode,
    scope.personalizationVersion ?? 0
  ].join("::");
}

export function createRecommendationCacheRepository(database, options = {}) {
  const now = () => options.now?.() ?? new Date();
  return {
    get(scope) {
      const current = now();
      const key = scopeKey(scope);
      const row = database.prepare(`
        SELECT * FROM recommendation_cache_entries
        WHERE owner_key = ? AND scope_key = ?
      `).get(scope.sessionId, key);
      if (!row || Date.parse(row.expires_at) <= current.getTime()) {
        if (row) {
          database.prepare(`
            DELETE FROM recommendation_cache_entries WHERE owner_key = ? AND scope_key = ?
          `).run(scope.sessionId, key);
        }
        return { cacheHit: false, recommendations: [] };
      }
      return {
        cacheHit: true,
        cachedAt: row.cached_at,
        expiresAt: row.expires_at,
        recommendations: JSON.parse(row.recommendations_json),
        serverNow: current.toISOString()
      };
    },

    put(scope, recommendations) {
      const cachedAt = now();
      const expiresAt = new Date(cachedAt.getTime() + defaultRecommendationCacheMaxAgeMs);
      database.prepare(`
        INSERT INTO recommendation_cache_entries (
          owner_key, scope_key, recommendations_json, cached_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_key, scope_key) DO UPDATE SET
          recommendations_json = excluded.recommendations_json,
          cached_at = excluded.cached_at,
          expires_at = excluded.expires_at
      `).run(
        scope.sessionId,
        scopeKey(scope),
        JSON.stringify(recommendations),
        cachedAt.toISOString(),
        expiresAt.toISOString()
      );
      database.prepare(
        "DELETE FROM recommendation_cache_entries WHERE expires_at <= ?"
      ).run(cachedAt.toISOString());
      database.prepare(`
        DELETE FROM recommendation_cache_entries
        WHERE owner_key = ? AND scope_key IN (
          SELECT scope_key FROM recommendation_cache_entries
          WHERE owner_key = ? ORDER BY cached_at DESC, scope_key
          LIMIT -1 OFFSET ?
        )
      `).run(
        scope.sessionId,
        scope.sessionId,
        maximumRecommendationCacheEntriesPerOwner
      );
      return {
        cachedAt: cachedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ok: true,
        serverNow: cachedAt.toISOString()
      };
    },

    clear(scope) {
      database.prepare(`
        DELETE FROM recommendation_cache_entries WHERE owner_key = ? AND scope_key = ?
      `).run(scope.sessionId, scopeKey(scope));
      return { cleared: true };
    },

    clearForUser(ownerKey) {
      return database.prepare(
        "DELETE FROM recommendation_cache_entries WHERE owner_key = ?"
      ).run(ownerKey).changes;
    }
  };
}

export function setRecommendationCacheRepository(repository) {
  singleton = repository;
}

function requireRepository() {
  if (!singleton) throw new Error("recommendation_cache_repository_not_initialized");
  return singleton;
}

export function getRecommendationCache(scope) {
  return requireRepository().get(scope);
}

export function putRecommendationCache(scope, recommendations) {
  return requireRepository().put(scope, recommendations);
}

export function clearRecommendationCache(scope) {
  return requireRepository().clear(scope);
}

export function clearRecommendationCacheForSession(ownerKey) {
  return requireRepository().clearForUser(ownerKey);
}
