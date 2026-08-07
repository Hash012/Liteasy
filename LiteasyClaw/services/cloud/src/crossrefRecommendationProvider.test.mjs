import assert from "node:assert/strict";
import test from "node:test";
import { CrossrefRecommendationProvider } from "./crossrefRecommendationProvider.mjs";

const config = {
  endpoint: "https://api.crossref.org/works",
  mailto: "operations@liteasy.example",
  timeoutMs: 1000
};

test("retrieves real provenance fields through the configured Crossref boundary", async () => {
  let requested;
  const provider = new CrossrefRecommendationProvider(config, {
    fetch: async (url, options) => {
      requested = { options, url: url.toString() };
      return {
        async json() {
          return { message: { items: [{
            DOI: "10.1000/Test.Paper",
            URL: "https://api.crossref.org/works/10.1000/Test.Paper",
            author: [{ family: "Doe", given: "Jane" }],
            issued: { "date-parts": [[2025, 1, 1]] },
            link: [{ "content-type": "application/pdf", URL: "https://publisher.example/paper.pdf" }],
            score: 42,
            title: ["A Real Retrieved Paper"]
          }, {
            DOI: "invalid",
            title: ["Rejected record"]
          }] } };
        },
        ok: true
      };
    }
  });

  assert.deepEqual(await provider.search("retrieval systems", 5), [{
    authors: ["Jane Doe"],
    canonicalId: "doi:10.1000/test.paper",
    fullTextUrl: "https://publisher.example/paper.pdf",
    id: "reading-candidate:doi:10.1000/test.paper",
    openAccessAvailable: true,
    providerRank: 1,
    providerScore: 42,
    publishedYear: 2025,
    source: "Crossref",
    sourceUrl: "https://doi.org/10.1000/test.paper",
    title: "A Real Retrieved Paper"
  }]);
  assert.match(requested.url, /query\.bibliographic=retrieval\+systems/);
  assert.match(requested.url, /mailto=operations%40liteasy\.example/);
  assert.equal(requested.options.headers["user-agent"].includes("operations@liteasy.example"), true);
});

test("returns an explicit provider failure instead of fabricated candidates", async () => {
  const provider = new CrossrefRecommendationProvider(config, {
    fetch: async () => { throw new Error("network down"); }
  });
  await assert.rejects(() => provider.search("paper"), /recommendation_provider_unavailable/);
});
