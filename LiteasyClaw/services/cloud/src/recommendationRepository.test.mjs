import assert from "node:assert/strict";
import test from "node:test";
import { PostgresRecommendationRepository } from "./recommendationRepository.mjs";

test("rejects cache scopes that could upload a local absolute path", async () => {
  const repository = new PostgresRecommendationRepository({
    async query() { throw new Error("database must not be reached"); }
  });
  await assert.rejects(() => repository.getCache("user_1", {
    personalizationVersion: 0,
    selectionKey: "selection:12345678",
    sortMode: "relevance",
    workspaceKey: "local:C:\\Users\\person\\LiteasyLibrary"
  }), /recommendation_cache_scope_invalid/);
});

test("returns no profile history from a disabled personalization state", async () => {
  const queries = [];
  const repository = new PostgresRecommendationRepository({
    async query(sql) {
      queries.push(sql);
      if (sql.includes("SELECT enabled, version")) return { rows: [{ enabled: false, version: 7 }] };
      return { rows: [] };
    }
  });
  assert.deepEqual(await repository.context("user_1"), {
    enabled: false,
    feedback: [],
    suppressions: [],
    terms: [],
    version: 7
  });
  assert.equal(queries.some((sql) => sql.includes("personalization_terms")), false);
});
