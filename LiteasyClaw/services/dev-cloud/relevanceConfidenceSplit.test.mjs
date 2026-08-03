import assert from "node:assert/strict";
import test from "node:test";
import { searchExternalKnowledge } from "./payloads/externalKnowledgePayloads.mjs";

/**
 * Relevance is a continuous estimate; confidence is the discrete fact of where the link came
 * from. They used to be one scalar, which let an algorithmic guess render identically to the
 * author's own citation.
 */

function openAlexTransport(works) {
  return async () => ({ json: async () => ({ results: works }), ok: true, status: 200 });
}

function work(overrides) {
  return {
    abstract_inverted_index: { late: [0], interaction: [1] },
    authorships: [],
    display_name: "Late interaction retrieval",
    id: "https://openalex.org/W1",
    primary_location: { landing_page_url: "https://openalex.org/W1" },
    publication_year: 2024,
    referenced_works: [],
    related_works: [],
    ...overrides
  };
}

async function searchWith(works) {
  return searchExternalKnowledge(
    { limit: 5, query: "late interaction retrieval" },
    {
      crossrefEnabled: false,
      openAlexApiKey: "test-key",
      openAlexEnabled: true,
      openAlexTransport: openAlexTransport(works)
    }
  );
}

test("a topic-search hit is labelled as algorithmic retrieval, not as a citation", async () => {
  const result = await searchWith([work({})]);

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].relation, "topic_search");
  assert.equal(result.sources[0].confidenceBasis, "algorithmic_retrieval");
  assert.equal(result.sources[0].confidence, 0.3);
});

test("confidence is a discrete tier, so it never drifts with the relevance estimate", async () => {
  const low = await searchWith([work({ display_name: "Something unrelated entirely" })]);
  const high = await searchWith([work({ display_name: "Late interaction retrieval methods" })]);

  // Different relevance estimates…
  assert.notEqual(low.sources[0].relevance, high.sources[0].relevance);
  // …but the provenance fact is identical, because both were found the same way.
  assert.equal(low.sources[0].confidence, high.sources[0].confidence);
  assert.equal(low.sources[0].confidenceBasis, high.sources[0].confidenceBasis);
});

test("a citation relation no longer outranks a better query match", async () => {
  const target = work({
    display_name: "Target paper",
    id: "https://openalex.org/W900",
    referenced_works: ["https://openalex.org/W1"]
  });
  const result = await searchExternalKnowledge(
    { limit: 5, query: "late interaction retrieval", targetPaperTitle: "Target paper" },
    {
      crossrefEnabled: false,
      openAlexApiKey: "test-key",
      openAlexEnabled: true,
      openAlexTransport: openAlexTransport([
        target,
        // The target's own reference, but about something else entirely.
        work({ display_name: "Unrelated crystallography survey", id: "https://openalex.org/W1" }),
        // A plain topic hit that actually matches the query.
        work({ display_name: "Late interaction retrieval methods", id: "https://openalex.org/W2" })
      ])
    }
  );

  const cited = result.sources.find((source) => source.id === "openalex:W1");
  const topical = result.sources.find((source) => source.id === "openalex:W2");
  assert.ok(cited && topical, "both sources should come back");

  // The citation is the more trustworthy link…
  assert.equal(cited.confidenceBasis, "author_citation");
  assert.equal(topical.confidenceBasis, "algorithmic_retrieval");
  // …but relevance answers a different question, and the better match wins it. Under the old
  // fused score the relation term alone contributed 34% and would have flipped this.
  assert.ok(
    topical.relevance > cited.relevance,
    `expected the better query match to score higher, got ${topical.relevance} vs ${cited.relevance}`
  );
});
