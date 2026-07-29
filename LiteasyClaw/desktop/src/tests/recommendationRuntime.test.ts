import { expect, test } from "vitest";
import { fetchCloudRecommendations } from "../app/features/recommendations/recommendationRuntime";

test("marks local demo recommendations as mock provenance", async () => {
  const recommendations = await fetchCloudRecommendations({
    controlPlaneEndpoint: "mock://control-plane",
    selectedDocuments: [
      {
        id: "demo-2",
        title: "Survey of Vector Database Management Systems"
      }
    ],
    sessionId: "demo-session-1",
    sortMode: "relevance"
  });

  expect(recommendations).toEqual([
    expect.objectContaining({
      id: "rec-vdbms-1",
      source: "Semantic Scholar",
      sourceKind: "mock"
    }),
    expect.objectContaining({
      id: "rec-vdbms-2",
      source: "arXiv Watch",
      sourceKind: "mock"
    })
  ]);
});
