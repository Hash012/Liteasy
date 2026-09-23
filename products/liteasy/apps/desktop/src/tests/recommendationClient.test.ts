import { createRecommendationClient } from "../app/features/recommendations/recommendationClient";
import { expect, test, vi } from "vitest";

test("sends style, bounds the seed set to the service limit, and forwards cancellation", async () => {
  const transport = vi.fn(async (_request: unknown) => ({
    json: async () => ({ recommendations: [] }), ok: true, status: 200
  }));
  const client = createRecommendationClient({ endpoint: "https://liteasy.example.com", transport });
  const controller = new AbortController();
  const selectedDocuments = Array.from({ length: 5 }, (_, index) => ({ id: `paper-${index}`, title: `Paper ${index}` }));
  await client({ style: "frontier", signal: controller.signal, selectedDocuments, sessionId: "session" });
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({
    signal: controller.signal,
    body: JSON.stringify({ style: "frontier", selectedDocuments: selectedDocuments.slice(0, 3), sessionId: "session" })
  }));
  controller.abort();
  await expect(client({ signal: controller.signal, selectedDocuments, sessionId: "session" })).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});

test("preserves actual publication metadata and refuses invalid ranking scores", async () => {
  const candidate = {
    discoveredAt: "2026-09-21T00:00:00Z", id: "paper", title: "Paper", relatedDocumentTitle: "Seed",
    relevanceBand: "high", relevanceScore: 0.9, reason: "Related", source: "Crossref",
    sourceKind: "live", sourceUrl: "https://doi.org/10.1234/paper", citationCount: 100,
    publishedAt: "2016-04-01", rankingStyle: "classic", styleScore: 0.7,
    scoreComponents: { finalScore: 0.85 }
  };
  const client = createRecommendationClient({ endpoint: "https://liteasy.example.com", transport: async () => ({
    json: async () => ({ recommendations: [candidate] }), ok: true, status: 200
  }) });
  const input = { selectedDocuments: [], sessionId: "session" };
  expect(await client(input)).toEqual([candidate]);
  for (const finalScore of [NaN, Infinity, -1, 2]) {
    candidate.scoreComponents.finalScore = finalScore;
    await expect(client(input)).rejects.toThrow("关联推荐返回格式无效");
  }
});

test("posts the selected document set to the cloud recommendation endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createRecommendationClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          recommendations: [
            {
              discoveredAt: "2026-05-14T08:15:00Z",
              id: "rec-vdbms-1",
              relatedDocumentTitle: "Survey of Vector Database Management Systems",
              relevanceBand: "high",
              relevanceScore: 0.92,
              reason: "同样关注向量数据库系统架构与相似度检索能力。",
              scoreComponents: {
                baseRelevance: 0.95,
                diversityPenalty: 0.03,
                finalScore: 0.92,
                preference: 0,
                sourceRelevance: 0.95
              },
              source: "Semantic Scholar",
              sourceKind: "live",
              sourceUrl: "https://www.semanticscholar.org/paper/rec-vdbms-1",
              title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
            }
          ]
        }),
        ok: true,
        status: 200
      };
    }
  });

  const recommendations = await client({
    selectedDocuments: [
      {
        id: "demo-2",
        title: "Survey of Vector Database Management Systems"
      }
    ],
    sessionId: "demo-session-1"
  });

  expect(recommendations).toEqual([
    {
      discoveredAt: "2026-05-14T08:15:00Z",
      id: "rec-vdbms-1",
      relatedDocumentTitle: "Survey of Vector Database Management Systems",
      relevanceBand: "high",
      relevanceScore: 0.92,
      reason: "同样关注向量数据库系统架构与相似度检索能力。",
      scoreComponents: {
        baseRelevance: 0.95,
        diversityPenalty: 0.03,
        finalScore: 0.92,
        preference: 0,
        sourceRelevance: 0.95
      },
      source: "Semantic Scholar",
      sourceKind: "live",
      sourceUrl: "https://www.semanticscholar.org/paper/rec-vdbms-1",
      title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
    }
  ]);
  expect(requests).toEqual([
    {
      body: JSON.stringify({
        selectedDocuments: [
          {
            id: "demo-2",
            title: "Survey of Vector Database Management Systems"
          }
        ],
        sessionId: "demo-session-1"
      }),
      url: "https://liteasy.example.com/control-plane/v1/recommendations"
    }
  ]);
});

test("does not expose source-provider credentials in a recommendation request", async () => {
  const requests: Array<{ headers: Record<string, string> }> = [];
  const client = createRecommendationClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      requests.push({ headers: request.headers });
      return {
        json: async () => ({ recommendations: [] }),
        ok: true,
        status: 200
      };
    }
  });

  await client({ selectedDocuments: [], sessionId: "demo-session-1" });

  expect(requests).toEqual([{
    headers: {
        "Authorization": "Bearer demo-session-1",
        "Content-Type": "application/json"
    }
  }]);
});

test("preserves a unified retrieval-service error for the recommendation surface", async () => {
  const client = createRecommendationClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async () => ({
      json: async () => ({
        code: "external_knowledge_unavailable",
        message: "统一联网服务当前无法连接外部学术来源，请检查服务端网络连接后重试。",
        traceId: "trace_recommendation_1"
      }),
      ok: false,
      status: 502
    })
  });

  await expect(client({ selectedDocuments: [], sessionId: "demo-session-1" }))
    .rejects.toThrow("统一联网服务当前无法连接外部学术来源");
});

test("posts only the structured research profile fields used for recommendation", async () => {
  const bodies: unknown[] = [];
  const client = createRecommendationClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async (request) => {
      bodies.push(JSON.parse(request.body));
      return {
        json: async () => ({ recommendations: [] }),
        ok: true,
        status: 200
      };
    }
  });

  await client({
    researchProfile: {
      datasets: ["BEIR"],
      languages: ["中文", "English"],
      methods: ["hybrid retrieval"],
      topics: ["neural information retrieval"]
    },
    selectedDocuments: [],
    sessionId: "demo-session-1"
  });

  expect(bodies).toEqual([{
    researchProfile: {
      datasets: ["BEIR"],
      languages: ["中文", "English"],
      methods: ["hybrid retrieval"],
      topics: ["neural information retrieval"]
    },
    selectedDocuments: [],
    sessionId: "demo-session-1"
  }]);
});

test("rejects recommendation payloads without explicit source provenance", async () => {
  const client = createRecommendationClient({
    endpoint: "https://liteasy.example.com/control-plane",
    transport: async () => ({
      json: async () => ({
        recommendations: [
          {
            discoveredAt: "2026-05-14T08:15:00Z",
            id: "rec-vdbms-1",
            relatedDocumentTitle: "Survey of Vector Database Management Systems",
            relevanceBand: "high",
            relevanceScore: 0.92,
            reason: "同样关注向量数据库系统架构与相似度检索能力。",
            source: "Semantic Scholar",
            title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
          }
        ]
      }),
      ok: true,
      status: 200
    })
  });

  await expect(client({
    selectedDocuments: [
      {
        id: "demo-2",
        title: "Survey of Vector Database Management Systems"
      }
    ],
    sessionId: "demo-session-1"
  })).rejects.toThrow("关联推荐返回格式无效");
});
