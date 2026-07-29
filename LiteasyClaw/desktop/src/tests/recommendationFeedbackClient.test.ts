import { expect, test } from "vitest";
import { createRecommendationFeedbackClient } from "../app/features/recommendations/recommendationFeedbackClient";

test("posts only bounded candidate identity fields as explicit recommendation feedback", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createRecommendationFeedbackClient({
    endpoint: "https://liteasy.example.com/control-plane/",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });
      return {
        json: async () => ({ feedback: { action: "dismissed" }, invalidatedCacheEntries: 1 }),
        ok: true,
        status: 200
      };
    }
  });

  await client({
    action: "dismissed",
    candidate: {
      canonicalId: "openalex:W200",
      discoveredAt: "2026-07-29T00:00:00Z",
      id: "reading-candidate:openalex:W200",
      relatedDocumentTitle: "Target Paper",
      relevanceBand: "high",
      relevanceScore: 0.9,
      reason: "reading lead",
      source: "OpenAlex",
      sourceKind: "live",
      sourceUrl: "https://openalex.org/W200",
      title: "Candidate Paper"
    },
    sessionId: "demo-session-1"
  });

  expect(requests).toEqual([{
    body: JSON.stringify({
      action: "dismissed",
      candidate: {
        canonicalId: "openalex:W200",
        id: "reading-candidate:openalex:W200",
        source: "OpenAlex",
        title: "Candidate Paper"
      },
      sessionId: "demo-session-1"
    }),
    url: "https://liteasy.example.com/control-plane/v1/recommendations/feedback"
  }]);
});
