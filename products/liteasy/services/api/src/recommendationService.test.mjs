import assert from "node:assert/strict";
import test from "node:test";
import { RecommendationService } from "./recommendationService.mjs";

function source(title = "Hybrid Retrieval for Scientific Literature", withPdf = false) {
  return {
    authors: ["Jane Doe"],
    canonicalId: "doi:10.1000/hybrid",
    id: "reading-candidate:doi:10.1000/hybrid",
    ...(withPdf ? { fullTextUrl: "https://publisher.example/hybrid.pdf" } : {}),
    openAccessAvailable: withPdf,
    providerRank: 1,
    providerScore: 10,
    publishedYear: 2025,
    source: "Crossref",
    sourceUrl: "https://doi.org/10.1000/hybrid",
    title
  };
}

test("generates traceable candidates and persists only retrieved results", async () => {
  const queries = [];
  let persisted;
  const service = new RecommendationService({
    async context() {
      return { enabled: true, feedback: [], suppressions: [], terms: [{ term: "hybrid retrieval", weight: 2 }], version: 4 };
    },
    async saveCandidates(subject, items, traceId) {
      persisted = { items, subject, traceId };
    }
  }, {
    async search(query) {
      queries.push(query);
      return [source()];
    }
  });
  const result = await service.generate("user_1", {
    researchProfile: { datasets: [], languages: [], methods: [], topics: [] },
    selectedDocuments: [{ id: "document_1", title: "Neural search systems" }],
    traceId: "trace_1"
  });

  assert.deepEqual(queries, ["Neural search systems", "hybrid retrieval"]);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].sourceKind, "live");
  assert.equal(result.recommendations[0].sourceUrl, "https://doi.org/10.1000/hybrid");
  assert.equal("fullTextUrl" in result.recommendations[0], false);
  assert.equal(persisted.subject, "user_1");
  assert.equal(persisted.traceId, "trace_1");
});

test("reissues a subject-bound PDF grant from a persisted recommendation candidate", async () => {
  const issued = [];
  const candidate = {
    ...source("Hybrid Retrieval for Scientific Literature", true),
    discoveredAt: "2026-08-07T00:00:00.000Z",
    reason: "Retrieved from Crossref",
    relatedDocumentTitle: "Target paper",
    relevanceBand: "high",
    relevanceScore: 0.9,
    sourceKind: "live"
  };
  const service = new RecommendationService({
    async loadCandidate(subject, candidateId) {
      assert.equal(subject, "user_1");
      assert.equal(candidateId, candidate.id);
      return candidate;
    }
  }, {}, {
    async issueRecommendationPdfGrant(subject, input) {
      issued.push({ input, subject });
      return "pdfgrant_12345678-abcd";
    }
  });

  assert.deepEqual(await service.issuePdfGrant("user_1", { candidateId: candidate.id }), {
    fullTextGrantId: "pdfgrant_12345678-abcd",
    fullTextUrl: "https://publisher.example/hybrid.pdf",
    sourceId: candidate.id
  });
  assert.deepEqual(issued[0], {
    input: {
      connectorType: "crossref",
      sourceId: candidate.id,
      sourceRecordId: candidate.canonicalId,
      sourceUrl: "https://publisher.example/hybrid.pdf"
    },
    subject: "user_1"
  });
  await assert.rejects(() => service.issuePdfGrant("user_1", {
    candidateId: candidate.id,
    sourceUrl: "https://attacker.example/private.pdf"
  }), /recommendation_candidate_invalid/);
});

test("does not consult historical terms when personalization is disabled", async () => {
  let providerCalled = false;
  let persisted = false;
  const service = new RecommendationService({
    async context() {
      return {
        enabled: false,
        feedback: [{ action: "saved", title: "private history" }],
        suppressions: ["reading-candidate:doi:10.1000/private"],
        terms: [{ term: "private history", weight: 9 }],
        version: 5
      };
    },
    async saveCandidates() { persisted = true; }
  }, {
    async search() { providerCalled = true; return [source()]; }
  });

  assert.deepEqual(await service.generate("user_1", {
    researchProfile: {
      datasets: [], languages: [], methods: ["private method"], topics: ["private history"]
    },
    selectedDocuments: [],
    traceId: "trace_2"
  }), {
    recommendations: []
  });
  assert.equal(providerCalled, false);
  assert.equal(persisted, false);
});

test("does not turn a complete provider outage into an empty success", async () => {
  const service = new RecommendationService({
    async context() { return { enabled: true, feedback: [], suppressions: [], terms: [], version: 0 }; },
    async saveCandidates() { throw new Error("must not persist"); }
  }, {
    async search() { throw new Error("provider offline"); }
  });
  await assert.rejects(() => service.generate("user_1", {
    selectedDocuments: [{ id: "document_1", title: "Target paper" }],
    traceId: "trace_3"
  }), /provider offline/);
});

const fixedNow = () => new Date("2026-09-21T12:00:00Z");
const selectedDocuments = [{ id: "seed", title: "Neural information retrieval" }];

function candidate(id, title, metadata = {}) {
  return {
    ...source(title), canonicalId: `doi:10.1000/${id}`, id: `reading-candidate:doi:10.1000/${id}`,
    sourceUrl: `https://doi.org/10.1000/${id}`, ...metadata
  };
}

function rankingService(candidates, context = {}) {
  return new RecommendationService({
    async context() { return { enabled: true, feedback: [], suppressions: [], terms: [], version: 0, ...context }; },
    async saveCandidates() {}
  }, { async search() { return candidates; } }, undefined, { now: fixedNow });
}

test("frontier and classic styles reorder the same relevant candidates without changing topical relevance", async () => {
  const service = rankingService([
    candidate("recent", "Neural information retrieval advances", { publishedAt: "2026-09-01", publishedYear: 2026, citationCount: 1 }),
    candidate("classic", "Neural information retrieval foundations", { publishedAt: "2001-01-01", publishedYear: 2001, citationCount: 3000 }),
    candidate("irrelevant", "Cardiac surgery guidelines", { publishedYear: 2000, citationCount: 100000 })
  ]);
  const frontier = (await service.generate("user_1", { selectedDocuments, style: "frontier" })).recommendations;
  const classic = (await service.generate("user_1", { selectedDocuments, style: "classic" })).recommendations;
  assert.equal(frontier[0].id, "reading-candidate:doi:10.1000/recent");
  assert.equal(classic[0].id, "reading-candidate:doi:10.1000/classic");
  assert.equal(frontier.length, 2);
  assert.equal(classic.length, 2);
  assert.equal(frontier[0].relevanceScore, classic[1].relevanceScore);
  assert.equal(frontier[0].rankingStyle, "frontier");
  assert.equal(classic[0].rankingStyle, "classic");
  assert.match(classic[0].reason, /Crossref 收录引用 3000 次/);
  assert.match(classic[0].reason, /非完整引用统计/);
  assert.equal(frontier[0].publishedAt, "2026-09-01");
});

test("unknown metadata stays neutral and future publication dates do not get a frontier bonus", async () => {
  const service = rankingService([
    candidate("unknown", "Neural information retrieval evaluation", { publishedYear: undefined }),
    candidate("future", "Neural information retrieval prospects", { publishedAt: "2026-12-01", publishedYear: 2026 })
  ]);
  for (const style of ["balanced", "frontier", "classic"]) {
    const result = await service.generate("user_1", { selectedDocuments, style });
    assert.equal(result.recommendations.every((item) => item.styleScore === 0.5), true);
    assert.equal(result.recommendations.every((item) => item.citationCount === undefined), true);
    assert.match(result.recommendations[0].reason, /发表时间未知/);
    assert.match(result.recommendations[0].reason, /引用数据缺失/);
  }
});

test("style evidence cannot promote a weak single-word match above strongly topical work", async () => {
  for (const style of ["classic", "frontier"]) {
    const service = rankingService([
      candidate("relevant", "Neural information retrieval experiments", {
        providerRank: 12, retrievalLane: "relevance", publishedYear: style === "classic" ? 2026 : 2000, citationCount: 0
      }),
      candidate("tangential", "Information about medieval literature", {
        providerRank: 1, retrievalLane: style === "classic" ? "classic" : "frontier",
        publishedYear: style === "classic" ? 1850 : 2026, citationCount: 100000
      })
    ]);
    const { recommendations } = await service.generate("user_1", { selectedDocuments, style });
    assert.equal(recommendations[0].id, "reading-candidate:doi:10.1000/relevant");
    assert.equal(recommendations.length, 2);
    assert.ok(recommendations[1].styleScore > recommendations[0].styleScore);
    assert.ok(recommendations[0].scoreComponents.finalScore > recommendations[1].scoreComponents.finalScore);
  }
});

test("retains relevant narrower queries with a single informative title term", async () => {
  const service = rankingService([candidate("related", "Neural information retrieval experiments", {
    citationCount: 100, publishedYear: 2010, retrievalLane: "classic"
  })]);
  const { recommendations } = await service.generate("user_1", {
    selectedDocuments: [{ id: "seed", title: "Retrieval" }], style: "classic"
  });
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].id, "reading-candidate:doi:10.1000/related");
});

test("exploratory selection increases diversity while keeping related papers", async () => {
  const service = rankingService([
    candidate("a", "Neural retrieval systems scientific discovery"),
    candidate("b", "Neural retrieval systems scientific exploration"),
    candidate("c", "Neural retrieval systems graph networks", { providerRank: 4 }),
    candidate("d", "Chemotherapy patient survival statistics", { citationCount: 100000 })
  ]);
  const input = { selectedDocuments: [{ id: "seed", title: "Neural retrieval systems" }] };
  const balanced = (await service.generate("user_1", { ...input, style: "balanced" })).recommendations;
  const exploratory = (await service.generate("user_1", { ...input, style: "exploratory" })).recommendations;
  assert.deepEqual(balanced.slice(0, 2).map((item) => item.id), ["reading-candidate:doi:10.1000/a", "reading-candidate:doi:10.1000/b"]);
  assert.deepEqual(exploratory.slice(0, 2).map((item) => item.id), ["reading-candidate:doi:10.1000/a", "reading-candidate:doi:10.1000/c"]);
  assert.equal(exploratory.length, 3);
  assert.ok(exploratory[1].scoreComponents.diversityPenalty > balanced[1].scoreComponents.diversityPenalty);
  assert.match(exploratory[1].reason, /主题多样性/);
});

test("deduplicates selected papers and DOI/title aliases without dropping title extensions", async () => {
  const service = rankingService([
    candidate("seed", "Neural information retrieval alternative title"),
    candidate("same-title", "Neural Information Retrieval!"),
    candidate("extension", "Neural information retrieval with graph embeddings"),
    candidate("extension-copy", "Neural information retrieval with graph embeddings"),
    candidate("different-id", "Neural information retrieval with graph embeddings", { canonicalId: "doi:10.1000/extension" })
  ]);
  for (const id of ["https://doi.org/10.1000/seed", "10.1000/seed", "DOI:10.1000/SEED"]) {
    const result = await service.generate("user_1", {
      selectedDocuments: [{ id, title: "Neural information retrieval" }]
    });
    assert.equal(result.recommendations.length, 1);
    assert.equal(result.recommendations[0].id, "reading-candidate:doi:10.1000/extension");
    assert.equal(result.recommendations[0].rankingStyle, "balanced");
  }
});

test("rejects invalid styles before looking up user context or calling the provider", async () => {
  const service = new RecommendationService({ async context() { throw new Error("must not read context"); } }, {});
  for (const style of [null, "freshest", {}, 1]) {
    await assert.rejects(() => service.generate("user_1", { selectedDocuments, style }), /recommendation_style_invalid/);
  }
});

test("style selection does not reenable disabled personalization", async () => {
  const calls = [];
  const service = new RecommendationService({
    async context() {
      return { enabled: false, feedback: [{ action: "saved", title: "secret history" }], terms: [{ term: "secret history", weight: 9 }], suppressions: [], version: 0 };
    },
    async saveCandidates() {}
  }, {
    async search(query, limit, options) {
      calls.push({ limit, options, query });
      return [candidate("recent", "Neural information retrieval advances")];
    }
  }, undefined, { now: fixedNow });
  const result = await service.generate("user_1", {
    selectedDocuments, style: "frontier",
    researchProfile: { topics: ["secret history"], methods: [], datasets: [], languages: [] }
  });
  assert.deepEqual(calls, [{ limit: 12, options: { style: "frontier" }, query: selectedDocuments[0].title }]);
  assert.equal(result.recommendations[0].scoreComponents.preference, 0);
});

test("bounds and deduplicates personalized query fanout with at most two active searches", async () => {
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  const service = new RecommendationService({
    async context() {
      return { enabled: true, feedback: [], suppressions: [], version: 0,
        terms: [{ term: "Neural information retrieval", weight: 3 }, { term: "Information ranking", weight: 2 }, { term: "Citation networks", weight: 1 }] };
    },
    async saveCandidates() {}
  }, {
    async search(query) {
      calls.push(query);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return [];
    }
  });
  await service.generate("user_1", {
    selectedDocuments: [...selectedDocuments, { id: "two", title: "Graph retrieval" }, { id: "three", title: "Document ranking" }],
    researchProfile: { topics: ["Scientific search"], methods: [], datasets: [], languages: [] }
  });
  assert.equal(calls.length, 5);
  assert.equal(new Set(calls).size, calls.length);
  assert.equal(maximumActive, 2);
});
