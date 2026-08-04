import assert from "node:assert/strict";
import test from "node:test";
import { searchExternalKnowledge } from "./payloads/externalKnowledgePayloads.mjs";

/**
 * The three ways an anchor's own local reference subset can be used.
 *
 * Measured on the retrieval gate: whole-paper citation-graph items were 40% relevant against an
 * anchor while plain topic search was 68%, and the three anchors with no graph items at all were
 * the three best. `exclusive` is the arm that acts on that; `additive` adds the anchor's own cited
 * works without removing the paper-level noise; `off` is the behaviour that produced the first
 * measurement and must stay byte-identical so the arms remain comparable.
 */

function work(overrides) {
  return {
    abstract_inverted_index: {},
    authorships: [],
    display_name: "Untitled",
    primary_location: { landing_page_url: `https://openalex.org/${overrides.id ?? "W0"}` },
    publication_year: 2016,
    referenced_works: [],
    related_works: [],
    ...overrides,
    id: `https://openalex.org/${overrides.id}`
  };
}

/** The anchor cites [2] and [31]; [7] is cited elsewhere in the paper, far from the anchor. */
const anchorReferences = [
  { number: 2, text: "Bahdanau, D. Attention Mechanism For Translation. ICLR, 2015." },
  { number: 31, text: "Sennrich, R. Byte Pair Encoding Of Rare Words. ACL, 2016." }
];

function corpus(targetId) {
  const cited = work({
    display_name: "Attention Mechanism For Translation",
    id: "W1",
    publication_year: 2015
  });
  const elsewhere = work({ display_name: "Penn Treebank Corpus", id: "W7" });
  const alsoCited = work({ display_name: "Byte Pair Encoding Of Rare Words", id: "W31" });
  const related = work({ display_name: "An Unrelated Survey", id: "W8" });
  const citing = work({
    display_name: "Protein Folding With Attention",
    id: "W9",
    referenced_works: [`https://openalex.org/${targetId}`]
  });
  const topical = work({
    // Has to genuinely match the query, or the lexical filter drops it before coupling is even
    // considered — a topic hit that says nothing about the query is not a candidate at all.
    display_name: "Attention Mechanism Survey For Retrieval",
    id: "W5",
    // Shares one of the anchor's own references, which is what coupling measures.
    referenced_works: ["https://openalex.org/W1"]
  });
  const target = work({
    display_name: "Target Paper",
    id: targetId,
    ids: { doi: "https://doi.org/10.1000/target" },
    doi: "https://doi.org/10.1000/target",
    referenced_works: [
      "https://openalex.org/W1",
      "https://openalex.org/W7",
      "https://openalex.org/W31"
    ],
    related_works: ["https://openalex.org/W8"]
  });
  const byId = new Map([cited, elsewhere, alsoCited, related, citing, topical, target]
    .map((entry) => [entry.id.replace("https://openalex.org/", ""), entry]));
  return { byId, target, topical };
}

function transportFor(targetId) {
  const { byId, target, topical } = corpus(targetId);
  const requested = [];
  const transport = async (url) => {
    const href = String(url);
    requested.push(href);
    const json = (value) => ({ json: async () => value, ok: true, status: 200 });
    if (href.includes(encodeURIComponent("https://doi.org/10.1000/target")) ||
      href.includes("https://doi.org/10.1000/target")) {
      return json(target);
    }
    if (href.includes("filter=cites")) {
      return json({ results: [byId.get("W9")] });
    }
    const batch = href.match(/filter=openalex_id[:%3A]+([^&]+)/i);
    if (batch) {
      const ids = decodeURIComponent(batch[1]).split("|").map((id) => id.trim());
      return json({ results: ids.map((id) => byId.get(id)).filter(Boolean) });
    }
    const single = href.match(/\/works\/(W\d+)(?:$|\?)/);
    if (single) {
      return json(byId.get(single[1]) ?? null);
    }
    // The keyword search itself: the target plus one honest topic hit.
    return json({ results: [target, topical] });
  };
  return { requested, transport };
}

async function searchWithMode(mode, targetId) {
  const { requested, transport } = transportFor(targetId);
  const payload = await searchExternalKnowledge(
    {
      anchorReferences,
      limit: 8,
      query: "attention mechanism for translation",
      targetPaperIdentity: { kind: "doi", value: "10.1000/target" },
      targetPaperTitle: "Target Paper"
    },
    {
      anchorReferenceMode: mode,
      crossrefEnabled: false,
      openAlexApiKey: "test-key",
      openAlexEnabled: true,
      openAlexTransport: transport
    }
  );
  return { ids: payload.sources.map((source) => source.id), payload, requested };
}

test("exclusive keeps the anchor's own neighbourhood and drops the paper-level noise", async () => {
  const { ids, payload } = await searchWithMode("exclusive", "W900");

  // The two works the author cited right next to the anchor.
  assert.ok(ids.includes("openalex:W1"), `expected the anchor's [2], got ${ids.join(", ")}`);
  assert.ok(ids.includes("openalex:W31"), `expected the anchor's [31], got ${ids.join(", ")}`);
  // A reference from elsewhere in the paper is not this anchor's business.
  assert.ok(!ids.includes("openalex:W7"), "a reference cited far from the anchor must not appear");
  // `related_works` is OpenAlex's whole-paper similarity, and a work citing the paper cites it for
  // any reason at all — that is how a protein-folding paper reached an attention anchor.
  assert.ok(!ids.includes("openalex:W8"), "related_works must not appear in the exclusive arm");
  assert.ok(!ids.includes("openalex:W9"), "whole-paper citing works must not appear either");

  const cited = payload.sources.find((source) => source.id === "openalex:W1");
  assert.equal(cited.relation, "cited_by_target");
  assert.equal(cited.confidenceBasis, "author_citation");
  assert.equal(cited.confidence, 1);
});

test("exclusive does not fall back to the whole-paper graph when an anchor has no local citations", async () => {
  const { requested, transport } = transportFor("W906");
  const payload = await searchExternalKnowledge(
    {
      anchorReferences: [],
      limit: 8,
      query: "attention mechanism for translation",
      targetPaperIdentity: { kind: "doi", value: "10.1000/target" },
      targetPaperTitle: "Target Paper"
    },
    {
      anchorReferenceMode: "exclusive",
      crossrefEnabled: false,
      openAlexApiKey: "test-key",
      openAlexEnabled: true,
      openAlexTransport: transport
    }
  );

  const ids = payload.sources.map((source) => source.id);
  assert.ok(!ids.includes("openalex:W7"), "whole-paper references must stay suppressed");
  assert.ok(!ids.includes("openalex:W8"), "whole-paper related works must stay suppressed");
  assert.ok(!ids.includes("openalex:W9"), "whole-paper citing works must stay suppressed");
  assert.ok(ids.includes("openalex:W5"), "ordinary topic retrieval should remain available");
  assert.ok(!requested.some((href) => href.includes("filter=cites")));
});

test("additive adds the anchor's works without removing the paper-level neighbourhood", async () => {
  const { ids } = await searchWithMode("additive", "W901");

  assert.ok(ids.includes("openalex:W1"));
  assert.ok(ids.includes("openalex:W31"));
  // Still present, unlike in the exclusive arm — this arm measures the seeds alone.
  assert.ok(ids.includes("openalex:W9"), `expected citing works to remain, got ${ids.join(", ")}`);
  assert.ok(ids.includes("openalex:W8"), `expected related works to remain, got ${ids.join(", ")}`);
});

test("off ignores the subset entirely, so the first measurement stays comparable", async () => {
  const { ids, requested } = await searchWithMode("off", "W902");

  // Whatever the client sent, this arm behaves exactly as it did before the feature existed.
  assert.ok(ids.includes("openalex:W7"), "the paper-level references are used, unfiltered");
  assert.ok(ids.includes("openalex:W8"));
  assert.ok(ids.includes("openalex:W9"));
  // And it never spends a request resolving the bibliography.
  assert.ok(
    !requested.some((href) => /filter=openalex_id/i.test(href)),
    "the off arm must not resolve anchor references at all"
  );
});

test("a topic hit sharing the anchor's references is relabelled as coupling, not as a citation", async () => {
  const { payload } = await searchWithMode("exclusive", "W903");

  const topical = payload.sources.find((source) => source.id === "openalex:W5");
  assert.ok(topical, "the topic hit should survive");
  // It shares W1 with the anchor's subset: built on the same work, with no direct citation.
  assert.equal(topical.relation, "bibliographic_coupling");
  assert.equal(topical.confidenceBasis, "citation_graph");
  assert.equal(topical.confidence, 0.6);
  // The measured overlap feeds the relevance estimate through the slot that already exists for it.
  assert.ok(topical.relationshipStrength > 0, "coupling must be recorded as a measured magnitude");
});

test("resolving a bibliography costs one batched request, not one per entry", async () => {
  const { requested } = await searchWithMode("exclusive", "W904");

  const perId = requested.filter((href) => /\/works\/W\d+(?:$|\?)/.test(href));
  assert.deepEqual(perId, [], `expected no per-id fetches, got ${perId.join(", ")}`);
  assert.ok(requested.some((href) => /filter=openalex_id/i.test(href)));
});

test("the anchor's own citations survive the provider-level slice", async () => {
  const { requested, transport } = transportFor("W905");
  void requested;
  const payload = await searchExternalKnowledge(
    {
      anchorReferences,
      // Only two slots: the seeds must win them, or they would never reach the reader.
      limit: 2,
      query: "attention mechanism for translation",
      targetPaperIdentity: { kind: "doi", value: "10.1000/target" },
      targetPaperTitle: "Target Paper"
    },
    {
      anchorReferenceMode: "additive",
      crossrefEnabled: false,
      openAlexApiKey: "test-key",
      openAlexEnabled: true,
      openAlexTransport: transport
    }
  );

  const ids = payload.sources.map((source) => source.id);
  assert.ok(
    ids.includes("openalex:W1") && ids.includes("openalex:W31"),
    `expected both anchor seeds to survive, got ${ids.join(", ")}`
  );
});

test("exclusive strictly verifies an open-search fallback when OpenAlex omits a bibliography entry", async () => {
  const target = work({
    display_name: "Sparse Target",
    doi: "https://doi.org/10.1000/sparse",
    id: "W980",
    ids: { doi: "https://doi.org/10.1000/sparse" },
    referenced_works: []
  });
  const missingReference = work({
    authorships: [{ author: { display_name: "Given Turing" } }],
    display_name: "Computing Machinery and Intelligence",
    id: "W981",
    publication_year: 1950
  });
  const requested = [];
  const transport = async (url) => {
    const href = String(url);
    requested.push(href);
    const json = (value) => ({ json: async () => value, ok: true, status: 200 });
    if (href.includes("10.1000/sparse")) return json(target);
    if (new URL(href).searchParams.get("search")?.includes("Computing Machinery")) {
      return json({ results: [missingReference] });
    }
    if (href.includes("filter=openalex_id")) return json({ results: [missingReference] });
    return json({ results: [target] });
  };

  const payload = await searchExternalKnowledge({
    anchorReferences: [{
      number: 4,
      text: "Turing, A. Computing Machinery and Intelligence. Mind, 1950."
    }],
    limit: 5,
    query: "machine intelligence",
    targetPaperIdentity: { kind: "doi", value: "10.1000/sparse" },
    targetPaperTitle: "Sparse Target"
  }, {
    anchorReferenceMode: "exclusive",
    crossrefEnabled: false,
    openAlexApiKey: "test-key",
    openAlexEnabled: true,
    openAlexTransport: transport
  });

  assert.equal(payload.sources.find((source) => source.sourceId === "W981")?.relation, "cited_by_target");
  assert.ok(requested.some((href) => new URL(href).searchParams.get("search")?.includes("Computing Machinery")));
});
