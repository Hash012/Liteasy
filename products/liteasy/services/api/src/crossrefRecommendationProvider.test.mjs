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
    publishedAt: "2025-01-01",
    publishedYear: 2025,
    retrievalLane: "relevance",
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

test("retrieves style-specific lanes with bounded rows and documented publication filters", async () => {
  const requests = [];
  const provider = new CrossrefRecommendationProvider(config, {
    now: () => new Date("2026-09-21T12:00:00Z"),
    fetch: async (url) => {
      requests.push(new URL(url));
      return { ok: true, json: async () => ({ message: { items: [] } }) };
    }
  });
  await provider.search("neural retrieval", 100, { style: "frontier" });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].searchParams.get("filter"), "from-pub-date:2024-09-21,until-pub-date:2026-09-21");
  assert.equal(requests[1].searchParams.get("sort"), "relevance");
  requests.length = 0;
  await provider.search("neural retrieval", 100, { style: "classic" });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].searchParams.get("filter"), "until-pub-date:2021-09-21");
  assert.equal(requests[1].searchParams.get("sort"), "is-referenced-by-count");
  for (const url of requests) {
    assert.equal(url.searchParams.get("rows"), "12");
    assert.equal(url.searchParams.get("query.bibliographic"), "neural retrieval");
    assert.match(url.searchParams.get("select"), /is-referenced-by-count/);
    assert.doesNotMatch(url.searchParams.get("select"), /created/);
  }
  requests.length = 0;
  await assert.rejects(() => provider.search("neural retrieval", 12, { style: "arbitrary" }), /recommendation_style_invalid/);
  assert.equal(requests.length, 0);
});

test("keeps unknown metadata unknown and prefers the earliest actual publication over deposit time", async () => {
  const provider = new CrossrefRecommendationProvider(config, {
    now: () => new Date("2026-09-21T12:00:00Z"),
    fetch: async () => ({ ok: true, json: async () => ({ message: { items: [
      { DOI: "10.1000/unknown", title: ["Unknown publication"], created: { "date-parts": [[2026, 9, 20]] }, "is-referenced-by-count": null },
      { DOI: "10.1000/partial", title: ["Year only publication"], issued: { "date-parts": [[2000]] }, "is-referenced-by-count": 0 },
      { DOI: "10.1000/invalid", title: ["Invalid publication date"], issued: { "date-parts": [[2026, 2, 30]] }, "is-referenced-by-count": -1 },
      { DOI: "10.1000/earliest", title: ["Online first publication"], "published-print": { "date-parts": [[2025, 3, 1]] }, "published-online": { "date-parts": [[2024, 11, 20]] }, "is-referenced-by-count": 25 }
    ] } }) })
  });
  const [unknown, partial, invalid, earliest] = await provider.search("publication");
  assert.equal(unknown.publishedYear, undefined);
  assert.equal(unknown.publishedAt, undefined);
  assert.equal(unknown.citationCount, undefined);
  assert.equal(partial.publishedYear, 2000);
  assert.equal(partial.publishedAt, undefined);
  assert.equal(partial.citationCount, 0);
  assert.equal(invalid.publishedYear, undefined);
  assert.equal(invalid.citationCount, undefined);
  assert.equal(earliest.publishedAt, "2024-11-20");
  assert.equal(earliest.publishedYear, 2024);
  assert.equal(earliest.citationCount, 25);
});

test("enforces the timeout while reading the response body", async () => {
  const signals = [];
  const provider = new CrossrefRecommendationProvider({ ...config, timeoutMs: 10 }, {
    fetch: async (_, options) => {
      signals.push(options.signal);
      return { ok: true, json: () => new Promise(() => {}) };
    }
  });
  await assert.rejects(() => provider.search("retrieval", 5, { style: "frontier" }), /recommendation_provider_timeout/);
  assert.equal(signals.every((signal) => signal.aborted), true);
});

test("survives a partial lane failure without inventing results", async () => {
  const provider = new CrossrefRecommendationProvider(config, {
    fetch: async (url) => {
      if (new URL(url).searchParams.has("filter")) throw new Error("upstream unavailable");
      return { ok: true, json: async () => ({ message: { items: [{ DOI: "10.1000/live", title: ["Live retrieved result"] }] } }) };
    }
  });
  const candidates = await provider.search("retrieved");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].canonicalId, "doi:10.1000/live");
  assert.equal(candidates[0].retrievalLane, "relevance");
});
