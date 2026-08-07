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
