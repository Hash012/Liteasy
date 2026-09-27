import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRecommendationStyle, rankRecommendationStyle } from "./recommendationStyle.mjs";
import { buildLiveRecommendationPayload } from "./recommendationPayloads.mjs";
import { applyRecommendationExternalReranker } from "./recommendationRerankerPayloads.mjs";

const now = new Date("2026-09-21T00:00:00Z");
const candidates = [
  { id: "classic", title: "Retrieval foundations", relevanceScore: 0.9, publishedYear: 2010, citationCount: 2500 },
  { id: "frontier", title: "Neural ranking advances", relevanceScore: 0.88, publishedAt: "2026-09-01", publishedYear: 2026, citationCount: 2 },
  { id: "unrelated", title: "Unrelated popular subject", relevanceScore: 0.2, publishedYear: 2010, citationCount: 1000000 }
];

test("frontier and classic styles change order while bounded influence preserves relevance", () => {
  const frontier = rankRecommendationStyle(candidates, "frontier", now);
  const classic = rankRecommendationStyle(candidates, "classic", now);
  assert.equal(frontier[0].id, "frontier");
  assert.equal(classic[0].id, "classic");
  for (const ranked of [frontier, classic]) {
    assert.equal(ranked.at(-1).id, "unrelated");
    for (const candidate of ranked) {
      assert.ok(candidate.styleScore >= 0 && candidate.styleScore <= 1);
      assert.ok(candidate.scoreComponents.finalScore <= candidate.relevanceScore);
      assert.ok(candidate.scoreComponents.finalScore >= candidate.relevanceScore * 0.75);
    }
  }
  assert.deepEqual(rankRecommendationStyle(candidates, undefined, now).map((item) => item.id), candidates.map((item) => item.id));
});

test("balanced preserves upstream final scores and browser sorting keeps the server order", () => {
  const input = [
    { id: "diverse", title: "Useful diverse topic", relevanceScore: 0.7, scoreComponents: { finalScore: 0.65, fusionScore: 0.9, diversityPenalty: 0 } },
    { id: "duplicate", title: "Repeated topic", relevanceScore: 0.9, scoreComponents: { finalScore: 0.55, fusionScore: 0.95, diversityPenalty: 0.2 } }
  ];
  const result = rankRecommendationStyle(input, "balanced", now);
  assert.deepEqual(result.map((item) => item.scoreComponents), input.map((item) => item.scoreComponents));
  const browserSorted = [...result].sort((left, right) => right.scoreComponents.finalScore - left.scoreComponents.finalScore || right.relevanceScore - left.relevanceScore);
  assert.deepEqual(browserSorted.map((item) => item.id), input.map((item) => item.id));
  assert.deepEqual(rankRecommendationStyle(result, "balanced", now), result);
});

test("a weak topical match cannot use citation volume to outrank a stronger match", () => {
  const input = [
    { id: "weak", title: "Neural biology textbook", relevanceScore: 0.7, publishedYear: 2000, citationCount: 1000000, scoreComponents: { lexicalRelevance: 0.1 } },
    { id: "topical", title: "Neural retrieval ranking", relevanceScore: 0.8, publishedYear: 2026, citationCount: 0, scoreComponents: { lexicalRelevance: 1 } }
  ];
  const result = rankRecommendationStyle(input, "classic", now);
  assert.equal(result[0].id, "topical");
  assert.equal(result[1].styleScore, 1);
  assert.ok(result[1].scoreComponents.finalScore < result[0].scoreComponents.finalScore);
});

test("missing, invalid and future dates receive no manufactured metadata or freshness advantage", () => {
  const items = [
    { id: "missing", title: "Unknown paper", relevanceScore: 0.8 },
    { id: "invalid", title: "Invalid date", relevanceScore: 0.8, publishedAt: "2026-02-30" },
    { id: "future", title: "Future date", relevanceScore: 0.8, publishedAt: "2028-01-01" }
  ];
  for (const style of ["frontier", "classic"]) {
    const ranked = rankRecommendationStyle(items, style, now);
    assert.ok(ranked.every((item) => item.styleScore === 0.5));
    assert.equal("citationCount" in ranked[0], false);
    assert.equal("publishedAt" in ranked[0], false);
  }
  const oldUnknown = rankRecommendationStyle([{ ...items[0], publishedYear: 1900 }], "classic", now)[0];
  assert.equal(oldUnknown.styleScore, 0.5);
});

test("exploratory style interleaves distinct topics without promoting irrelevant candidates", () => {
  const input = [
    { id: "a", title: "Neural dense retrieval methods", relevanceScore: 0.9 },
    { id: "b", title: "Neural dense retrieval models", relevanceScore: 0.89 },
    { id: "c", title: "Knowledge graph inference", relevanceScore: 0.86 },
    { id: "d", title: "Remote unrelated subject", relevanceScore: 0.1 }
  ];
  assert.deepEqual(rankRecommendationStyle(input, "exploratory", now).map((item) => item.id), ["a", "c", "b", "d"]);
});

test("style remains effective after an optional external reranker and never compounds on reapplication", async () => {
  const styled = rankRecommendationStyle(candidates, "frontier", now);
  const reranker = await applyRecommendationExternalReranker(styled, {
    apiKey: "test-key", baseUrl: "https://reranker.example", model: "test", query: "retrieval",
    transport: async () => ({ ok: true, json: async () => ({ results: styled.map((item, index) => ({ index, relevance_score: item.id === "unrelated" ? 0.1 : 0.9 })) }) })
  });
  assert.equal(reranker.audit.status, "completed");
  const result = rankRecommendationStyle(reranker.recommendations, "frontier", now);
  assert.equal(result[0].id, "frontier");
  assert.deepEqual(rankRecommendationStyle(result, "frontier", now), result);
});

test("balanced retains completed external reranker scores, audit and order", async () => {
  const reranked = await applyRecommendationExternalReranker(candidates, {
    apiKey: "test-key", baseUrl: "https://reranker.example", model: "test", query: "retrieval",
    transport: async () => ({ ok: true, json: async () => ({ results: candidates.map((item, index) => ({ index, relevance_score: item.id === "frontier" ? 0.95 : 0.2 })) }) })
  });
  const result = rankRecommendationStyle(reranked.recommendations, "balanced", now);
  assert.equal(result[0].id, "frontier");
  assert.deepEqual(result.map((item) => item.scoreComponents), reranked.recommendations.map((item) => item.scoreComponents));
  assert.deepEqual(result.map((item) => item.externalReranker), reranked.recommendations.map((item) => item.externalReranker));
});

test("all styles preserve quality gates, metadata provenance and exclusions", () => {
  const sources = candidates.map((candidate, index) => ({
    id: `openalex:W${index + 1}`, provider: "openalex", relation: "topic_search",
    title: candidate.title, relevance: candidate.relevanceScore, url: `https://openalex.org/W${index + 1}`,
    year: candidate.publishedYear, citationCount: candidate.citationCount, publishedAt: candidate.publishedAt
  }));
  sources.push({ ...sources[0], id: "openalex:W99", title: "Retracted paper", isRetracted: true });
  for (const style of ["balanced", "frontier", "classic", "exploratory"]) {
    const result = buildLiveRecommendationPayload({ style }, [{ sources }], now);
    assert.equal(result.qualityGate.rejected, 1);
    assert.equal(result.recommendations.length, 3);
    assert.ok(result.recommendations.every((item) => item.rankingStyle === style && item.qualityGate.passed));
    assert.equal(result.recommendations.find((item) => item.title === candidates[0].title).citationCount, 2500);
  }
});

test("merging a higher-relevance record retains observed metadata from the same paper", () => {
  const shared = {
    id: "openalex:W42", provider: "openalex", title: "Shared retrieval record",
    relevance: 0.8, url: "https://openalex.org/W42", year: 2020
  };
  const result = buildLiveRecommendationPayload({ style: "classic" }, [
    { sources: [{ ...shared, citationCount: 420, publishedAt: "2020-05-01" }] },
    { sources: [{ ...shared, relevance: 0.9 }] }
  ], now);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].citationCount, 420);
  assert.equal(result.recommendations[0].publishedAt, "2020-05-01");
});

test("unsupported styles are rejected explicitly", () => {
  assert.deepEqual(normalizeRecommendationStyle(), { ok: true, value: "balanced" });
  for (const style of ["unknown", "CLASSIC", "", null, 1, {}, []]) {
    assert.deepEqual(normalizeRecommendationStyle(style), { ok: false, error: "recommendation_style_invalid" });
  }
});
