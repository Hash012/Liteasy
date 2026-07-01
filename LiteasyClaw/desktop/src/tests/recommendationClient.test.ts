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
              id: "rec-bert-1",
              relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
              relevanceBand: "high",
              relevanceScore: 0.92,
              reason: "同样关注大规模预训练语言模型的迁移能力。",
              source: "Semantic Scholar",
              title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
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
        title: "BERT: Pre-training of Deep Bidirectional Transformers"
      }
    ],
    sessionId: "demo-session-1"
  });

  expect(recommendations).toEqual([
    {
      discoveredAt: "2026-05-14T08:15:00Z",
      id: "rec-bert-1",
      relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
      relevanceBand: "high",
      relevanceScore: 0.92,
      reason: "同样关注大规模预训练语言模型的迁移能力。",
      source: "Semantic Scholar",
      title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
    }
  ]);
  expect(requests).toEqual([
    {
      body: JSON.stringify({
        selectedDocuments: [
          {
            id: "demo-2",
            title: "BERT: Pre-training of Deep Bidirectional Transformers"
          }
        ],
        sessionId: "demo-session-1"
      }),
      url: "https://liteasy.example.com/control-plane/v1/recommendations"
    }
  ]);
});
