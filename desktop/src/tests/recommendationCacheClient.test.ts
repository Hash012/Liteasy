import { expect, test } from "vitest";
import { createRecommendationCacheClient } from "../app/features/recommendations/recommendationCacheClient";

test("posts a scoped cache lookup to the recommendation-cache get endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createRecommendationCacheClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });
      return {
        json: async () => ({
          cacheHit: false,
          recommendations: []
        }),
        ok: true,
        status: 200
      };
    }
  });

  const result = await client.get({
    selectionKey: "demo-2",
    sessionId: "demo-session-1",
    sortMode: "relevance",
    workspaceKey: "local:/tmp/LiteasyLibrary"
  });

  expect(result.cacheHit).toBe(false);
  expect(requests[0].url).toBe(
    "https://liteasy.example.com/control-plane/v1/recommendation-cache/get"
  );
});

test("posts generated recommendations to the recommendation-cache put endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createRecommendationCacheClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });
      return {
        json: async () => ({
          cachedAt: "2026-05-14T08:15:00Z",
          ok: true
        }),
        ok: true,
        status: 200
      };
    }
  });

  await client.put(
    {
      selectionKey: "demo-2",
      sessionId: "demo-session-1",
      sortMode: "relevance",
      workspaceKey: "local:/tmp/LiteasyLibrary"
    },
    [
      {
        discoveredAt: "2026-05-14T08:15:00Z",
        id: "rec-bert-1",
        relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
        relevanceBand: "high",
        relevanceScore: 0.92,
        reason: "cached",
        source: "Semantic Scholar",
        title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
      }
    ]
  );

  expect(requests[0].url).toBe(
    "https://liteasy.example.com/control-plane/v1/recommendation-cache/put"
  );
});

test("posts a scoped cache clear request to the recommendation-cache clear endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createRecommendationCacheClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });
      return {
        json: async () => ({
          cleared: true
        }),
        ok: true,
        status: 200
      };
    }
  });

  const result = await client.clear({
    selectionKey: "demo-2",
    sessionId: "demo-session-1",
    sortMode: "relevance",
    workspaceKey: "local:/tmp/LiteasyLibrary"
  });

  expect(result.cleared).toBe(true);
  expect(requests[0].url).toBe(
    "https://liteasy.example.com/control-plane/v1/recommendation-cache/clear"
  );
});
