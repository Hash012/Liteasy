import test from "node:test";
import assert from "node:assert/strict";
import { applyRecommendationExternalReranker } from "./recommendationRerankerPayloads.mjs";

const candidates = [
  {
    abstract: "dense retrieval for language tasks",
    authors: ["A Researcher"],
    id: "reading-candidate:openalex:W1",
    reason: "provider rank",
    relevanceBand: "high",
    relevanceScore: 0.9,
    scoreComponents: { finalScore: 0.9 },
    title: "Dense Language Retrieval"
  },
  {
    abstract: "graph retrieval for protein discovery",
    authors: ["B Researcher"],
    id: "reading-candidate:openalex:W2",
    reason: "provider rank",
    relevanceBand: "medium",
    relevanceScore: 0.6,
    scoreComponents: { finalScore: 0.6 },
    title: "Graph Protein Discovery"
  }
];

test("applies a bounded external reranker after deterministic candidate ranking", async () => {
  let request;
  const result = await applyRecommendationExternalReranker(candidates, {
    apiKey: "reranker-secret",
    baseUrl: "https://reranker.example.com/v2",
    model: "research-reranker-v1",
    query: "protein graph retrieval",
    transport: async (url, options) => {
      request = { body: JSON.parse(options.body), headers: options.headers, url };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          results: [
            { index: 1, relevance_score: 0.95 },
            { index: 0, relevance_score: 0.1 }
          ]
        })
      };
    }
  });

  assert.equal(request.url, "https://reranker.example.com/v2/rerank");
  assert.equal(request.headers.Authorization, "Bearer reranker-secret");
  assert.deepEqual(request.body, {
    documents: [
      "Dense Language Retrieval dense retrieval for language tasks A Researcher",
      "Graph Protein Discovery graph retrieval for protein discovery B Researcher"
    ],
    model: "research-reranker-v1",
    query: "protein graph retrieval",
    return_documents: false,
    top_n: 2
  });
  assert.equal(result.recommendations[0].id, "reading-candidate:openalex:W2");
  assert.deepEqual(result.recommendations[0].externalReranker, {
    finalScore: 0.827,
    originalScore: 0.6,
    rank: 1,
    relevanceScore: 0.95,
    version: "recommendation-external-reranker/v1",
    weight: 0.65
  });
  assert.equal(result.recommendations[0].scoreComponents.preRerankerScore, 0.6);
  assert.deepEqual(result.audit, {
    candidateCount: 2,
    model: "research-reranker-v1",
    provider: "rerank_api",
    queryLength: 23,
    status: "completed",
    version: "recommendation-external-reranker/v1",
    weight: 0.65
  });
  assert.equal(JSON.stringify(result).includes("reranker-secret"), false);
});

test("keeps the RRF order when reranker output is incomplete or malformed", async () => {
  const result = await applyRecommendationExternalReranker(candidates, {
    apiKey: "reranker-secret",
    baseUrl: "https://reranker.example.com/v2",
    model: "research-reranker-v1",
    query: "protein graph retrieval",
    transport: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        results: [{ index: 1, relevance_score: 0.95 }]
      })
    })
  });

  assert.equal(result.audit.status, "failed");
  assert.equal(result.audit.error, "recommendation_reranker_results_invalid");
  assert.equal(result.recommendations, candidates);
});

test("does not call the reranker unless endpoint, key, model, query, and a shortlist exist", async () => {
  let calls = 0;
  const result = await applyRecommendationExternalReranker(candidates, {
    baseUrl: "https://reranker.example.com/v2",
    model: "research-reranker-v1",
    query: "protein graph retrieval",
    transport: async () => {
      calls += 1;
    }
  });

  assert.equal(calls, 0);
  assert.deepEqual(result.audit, {
    status: "disabled",
    version: "recommendation-external-reranker/v1"
  });
  assert.equal(result.recommendations, candidates);
});
