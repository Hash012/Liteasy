import { expect, test, vi } from "vitest";

import { retrieveThinReadingAnchorRecommendations } from "../app/features/thin-reading/useThinReadingAnchorRecommendations";
import type { ThinReadingAnchor } from "../app/features/thin-reading/thinReading.types";

function anchor(index: number): ThinReadingAnchor {
  return {
    end: 8,
    evidenceIds: [`evidence-${index}`],
    externalSourceIds: [],
    id: `anchor-${index}`,
    importance: 0.8,
    kind: "concept",
    searchQuery: `query ${index}`,
    start: 0,
    summarySentenceId: "sentence-1",
    text: `concept${index}`
  };
}

test("loads anchor recommendations with bounded concurrency and publishes each completed anchor", async () => {
  let active = 0;
  let maximumActive = 0;
  const onAnchor = vi.fn();
  const transport = vi.fn(async (request: { body: string }) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    const query = String(JSON.parse(request.body).query);
    const index = Number(query.split(" ")[1]);
    return {
      json: async () => ({
        sources: [{
          abstract: "A sufficiently detailed and reviewable scholarly abstract.",
          authors: ["Researcher"],
          id: `openalex:W${index}`,
          provider: "openalex",
          relation: "related",
          relevance: 0.9,
          retrievalQuery: query,
          sourceId: `W${index}`,
          sourceRecordUrl: `https://openalex.org/W${index}`,
          title: `Related paper ${index}`,
          url: `https://openalex.org/W${index}`
        }]
      }),
      ok: true,
      status: 200
    };
  });
  const result = await retrieveThinReadingAnchorRecommendations({
    anchors: [0, 1, 2, 3, 4].map(anchor),
    artifactId: "artifact-1",
    endpoint: "https://api.example",
    existingSources: [],
    onAnchor,
    signal: new AbortController().signal,
    transport
  });
  expect(maximumActive).toBe(3);
  expect(transport).toHaveBeenCalledTimes(5);
  expect(onAnchor).toHaveBeenCalledTimes(5);
  expect(result.get("anchor-4")?.[0].id).toBe("openalex:W4");
});
