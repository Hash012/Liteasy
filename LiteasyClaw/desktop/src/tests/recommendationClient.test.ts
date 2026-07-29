import { createRecommendationClient } from "../app/features/recommendations/recommendationClient";

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
              sourceKind: "mock",
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
      sourceKind: "mock",
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

test("forwards the configured OpenAlex key only to the recommendation retrieval request", async () => {
  const requests: Array<{ headers: Record<string, string> }> = [];
  const client = createRecommendationClient({
    endpoint: "https://liteasy.example.com/control-plane",
    openAlexApiKey: "openalex-test-key",
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
      "Content-Type": "application/json",
      "X-OpenAlex-Api-Key": "openalex-test-key"
    }
  }]);
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
