import { expect, test, vi } from "vitest";
import { fetchCloudRecommendations } from "../app/features/recommendations/recommendationRuntime";

test("loads real transport recommendations and applies the selected sort", async () => {
  const transport = vi.fn(async () => ({
    json: async () => ({ recommendations: [
      { discoveredAt: "2026-05-14T08:00:00Z", id: "rec-low", relatedDocumentTitle: "Paper", relevanceBand: "medium", relevanceScore: 0.7, reason: "Related", source: "OpenAlex", sourceKind: "live", sourceUrl: "https://openalex.org/work", title: "Lower" },
      { discoveredAt: "2026-05-14T07:00:00Z", id: "rec-high", relatedDocumentTitle: "Paper", relevanceBand: "high", relevanceScore: 0.9, reason: "Related", source: "Crossref", sourceKind: "live", sourceUrl: "https://doi.org/example", title: "Higher" }
    ] }),
    ok: true,
    status: 200
  }));

  const recommendations = await fetchCloudRecommendations({
    controlPlaneEndpoint: "https://liteasy.example.com",
    selectedDocuments: [{ id: "paper-1", title: "Paper" }],
    sessionId: "real-session",
    sortMode: "relevance"
  }, { transport });

  expect(recommendations.map((item) => item.id)).toEqual(["rec-high", "rec-low"]);
  expect(transport).toHaveBeenCalledOnce();
});

test("cloud requests preserve the three-document API contract while covering every selected asset", async () => {
  const bodies: { selectedDocuments: { id: string }[] }[] = [];
  await fetchCloudRecommendations({ controlPlaneEndpoint: "https://cloud.test", sessionId: "session", sortMode: "relevance",
    selectedDocuments: Array.from({ length: 8 }, (_, index) => ({ id: index === 7 ? "liteasy://" + "long-path".repeat(100) : `asset-${index}`, title: `Database research ${index}`, abstract: "transaction concurrency control" })),
  }, { transport: async (request) => { bodies.push(JSON.parse(request.body)); return { ok: true, status: 200, json: async () => ({ recommendations: [] }) }; } });
  expect(bodies).toHaveLength(3);
  expect(bodies.flatMap((body) => body.selectedDocuments)).toHaveLength(8);
  expect(bodies.every((body) => body.selectedDocuments.length <= 3 && body.selectedDocuments.every((doc) => doc.id.length <= 300))).toBe(true);
});
