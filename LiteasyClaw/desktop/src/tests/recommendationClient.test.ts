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
