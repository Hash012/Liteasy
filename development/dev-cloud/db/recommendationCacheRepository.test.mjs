import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase } from "./database.mjs";
import { createRecommendationCacheRepository } from "./recommendationCacheRepository.mjs";

function scope(sessionId, index) {
  return {
    personalizationVersion: 0,
    selectionKey: `selection-${index}`,
    sessionId,
    sortMode: "relevance",
    workspaceKey: "workspace"
  };
}

test("recommendation cache evicts expired and oldest entries per owner", () => {
  const database = createDatabase({ databasePath: ":memory:" });
  let current = new Date("2026-08-01T00:00:00.000Z");
  try {
    const repository = createRecommendationCacheRepository(database, { now: () => current });
    for (let index = 0; index < 101; index += 1) {
      current = new Date(current.getTime() + 1_000);
      repository.put(scope("user:alice", index), [{ id: `recommendation-${index}` }]);
    }
    repository.put(scope("user:bob", 0), [{ id: "bob-recommendation" }]);

    assert.equal(database.prepare(
      "SELECT count(*) AS count FROM recommendation_cache_entries WHERE owner_key = ?"
    ).get("user:alice").count, 100);
    assert.equal(repository.get(scope("user:alice", 0)).cacheHit, false);
    assert.equal(repository.get(scope("user:alice", 100)).cacheHit, true);
    assert.equal(repository.get(scope("user:bob", 0)).cacheHit, true);

    current = new Date(current.getTime() + 24 * 60 * 60 * 1000 + 1);
    assert.equal(repository.get(scope("user:alice", 100)).cacheHit, false);
  } finally {
    database.close();
  }
});
