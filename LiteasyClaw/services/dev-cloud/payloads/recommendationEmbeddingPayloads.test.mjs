import test from "node:test";
import assert from "node:assert/strict";
import { applyRecommendationEmbeddingScores } from "./recommendationEmbeddingPayloads.mjs";

function vector(...values) {
  return [...values, ...Array(Math.max(0, 8 - values.length)).fill(0)];
}

const sourceGroups = [{
  relatedDocumentTitle: "neural retrieval",
  sources: [
    {
      abstract: "late interaction retrieval",
      id: "openalex:W1",
      provider: "openalex",
      title: "Neural Retrieval",
      url: "https://openalex.org/W1"
    },
    {
      abstract: "protein folding",
      id: "crossref:10.1000/protein",
      provider: "crossref",
      title: "Protein Folding",
      url: "https://doi.org/10.1000/protein"
    }
  ]
}];

test("adds real provider embedding scores with a bounded auditable batch", async () => {
  let request;
  const result = await applyRecommendationEmbeddingScores(sourceGroups, {
    apiKey: "embedding-secret",
    baseUrl: "https://embedding.example.com/v1",
    model: "research-embedding-v1",
    transport: async (url, options) => {
      request = { body: JSON.parse(options.body), headers: options.headers, url };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: [
            { embedding: vector(1, 0), index: 0 },
            { embedding: vector(1, 0), index: 1 },
            { embedding: vector(0, 1), index: 2 }
          ]
        })
      };
    }
  });

  assert.equal(request.url, "https://embedding.example.com/v1/embeddings");
  assert.equal(request.headers.Authorization, "Bearer embedding-secret");
  assert.equal(request.body.model, "research-embedding-v1");
  assert.equal(request.body.input.length, 3);
  assert.equal(result.sourceGroups[0].sources[0].semanticRelevance, 1);
  assert.equal(result.sourceGroups[0].sources[1].semanticRelevance, 0);
  assert.deepEqual(result.audit, {
    candidateCount: 2,
    dimension: 8,
    inputCount: 3,
    model: "research-embedding-v1",
    provider: "openai_compatible",
    status: "completed",
    version: "recommendation-semantic-retrieval/v1"
  });
  assert.equal(JSON.stringify(result.audit).includes("embedding-secret"), false);
});

test("falls back without semantic scores when the configured provider returns invalid vectors", async () => {
  const result = await applyRecommendationEmbeddingScores(sourceGroups, {
    apiKey: "embedding-secret",
    baseUrl: "https://embedding.example.com/v1",
    model: "research-embedding-v1",
    transport: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ embedding: vector(1, 0), index: 0 }] })
    })
  });

  assert.equal(result.audit.status, "failed");
  assert.equal(result.audit.error, "recommendation_embedding_vectors_invalid");
  assert.equal("semanticRelevance" in result.sourceGroups[0].sources[0], false);
});

test("does not call a provider unless endpoint, key, and model are all explicitly configured", async () => {
  let calls = 0;
  const result = await applyRecommendationEmbeddingScores(sourceGroups, {
    baseUrl: "https://embedding.example.com/v1",
    model: "research-embedding-v1",
    transport: async () => {
      calls += 1;
    }
  });

  assert.equal(calls, 0);
  assert.deepEqual(result.audit, {
    status: "disabled",
    version: "recommendation-semantic-retrieval/v1"
  });
});
