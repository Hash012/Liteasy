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
