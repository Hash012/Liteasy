import assert from "node:assert/strict";
import test from "node:test";
import { ExternalRetrievalError } from "./externalRetrievalConnectors.mjs";
import {
  ExternalKnowledgeService,
  PostgresExternalKnowledgeRepository
} from "./externalKnowledgeService.mjs";

const source = {
  abstract: "A reviewable abstract with enough evidence.",
  authors: [],
  fullTextUrl: "https://papers.example/paper.pdf",
  id: "crossref:10.1000/test",
  provider: "crossref",
  relation: "topic_search",
  relevance: 0.9,
  retrievalQuery: "test query",
  sourceId: "10.1000/test",
  sourceRecordUrl: "https://api.crossref.org/works/10.1000%2Ftest",
  title: "A real scholarly result",
  url: "https://doi.org/10.1000/test"
};

const relationRequest = {
  artifactId: "artifact_relations",
  papers: [
    { id: "paper-a", provider: "openalex", sourceId: "W1" },
    { id: "paper-b", provider: "openalex", sourceId: "W2" },
    { id: "paper-c", provider: "openalex", sourceId: "W3" }
  ]
};

test("relations keeps only verified edges whose endpoints are requested", async () => {
  const saved = [];
  const service = new ExternalKnowledgeService({
    connectors: {
      openalex: async (_source, input) => {
        assert.equal(input.papers.length, 3);
        return [{
          id: "openalex:W1",
          provider: "openalex",
          referencedPaperIds: ["openalex:W2", "openalex:W99"],
          evidenceRecordUrl: "https://openalex.org/W1"
        }, {
          id: "openalex:W2",
          provider: "openalex",
          referencedPaperIds: ["openalex:W9"],
          evidenceRecordUrl: "https://openalex.org/W2"
        }];
      }
    },
    downloader: {},
    repository: {
      async listEnabledSources() {
        return [{ baseUrl: "https://api.openalex.org/works", connectorType: "openalex", revision: 1, sourceId: "source_openalex" }];
      },
      async loadRetrievalCache() { return null; },
      async saveRetrievalCache(subjectId, cacheKey, value) { saved.push({ subjectId, cacheKey, value }); }
    }
  });
  const result = await service.relations({ subjectId: "user-1" }, relationRequest, new AbortController().signal);
  assert.deepEqual(result.edges.map(({ sourcePaperId, targetPaperId }) => [sourcePaperId, targetPaperId]), [["paper-a", "paper-b"]]);
  assert.equal(result.edges[0].kind, "direct_citation");
  assert.equal(result.warnings.length, 0);
  assert.equal(saved[0].subjectId, "user-1");
  assert.match(saved[0].cacheKey, /^[a-f0-9]{64}$/);
});

test("relations maps DOI-resolved graph records back onto a mixed Crossref and OpenAlex page", async () => {
  const attempted = [];
  const service = new ExternalKnowledgeService({
    connectors: {
      relations: async (configured, input) => {
        attempted.push({ connectorType: configured.connectorType, papers: input.papers });
        return configured.connectorType === "openalex" ? [{
          doi: "doi:10.1000/crossref-target",
          evidenceRecordUrl: "https://openalex.org/W20",
          id: "openalex:W20",
          provider: "openalex",
          referencedPaperIds: []
        }, {
          doi: "doi:10.1000/openalex-source",
          evidenceRecordUrl: "https://openalex.org/W10",
          id: "openalex:W10",
          provider: "openalex",
          referencedPaperIds: ["openalex:W20"]
        }] : [];
      }
    },
    downloader: {},
    repository: {
      async listEnabledSources() { return [
        { baseUrl: "https://api.openalex.org/works", connectorType: "openalex", revision: 1, sourceId: "openalex" },
        { baseUrl: "https://api.semanticscholar.org/graph/v1/paper/search", connectorType: "semantic_scholar", revision: 1, sourceId: "s2" }
      ]; },
      async loadRetrievalCache() { return null; },
      async saveRetrievalCache() {}
    }
  });

  const result = await service.relations({ subjectId: "user" }, {
    artifactId: "mixed-page",
    papers: [{
      doi: "10.1000/crossref-target",
      id: "crossref-target",
      provider: "crossref",
      sourceId: "10.1000/crossref-target"
    }, {
      doi: "10.1000/openalex-source",
      id: "openalex-source",
      provider: "openalex",
      sourceId: "W10"
    }]
  });

  assert.deepEqual(attempted.map((attempt) => attempt.connectorType), ["openalex", "semantic_scholar"]);
  assert.deepEqual(result.edges, [{
    directed: true,
    evidenceRecordUrls: ["https://openalex.org/W10"],
    kind: "direct_citation",
    provider: "openalex",
    sourcePaperId: "openalex-source",
    strength: 1,
    targetPaperId: "crossref-target"
  }]);
});

test("relations warns once for an unmappable paper while preserving mapped DOI relations", async () => {
  const service = new ExternalKnowledgeService({
    connectors: { relations: async () => [{
      doi: "10.1000/a",
      evidenceRecordUrl: "https://openalex.org/W1",
      id: "openalex:W1",
      provider: "openalex",
      referencedPaperIds: ["openalex:W2"]
    }, {
      doi: "10.1000/b",
      evidenceRecordUrl: "https://openalex.org/W2",
      id: "openalex:W2",
      provider: "openalex",
      referencedPaperIds: []
    }] },
    downloader: {},
    repository: {
      async listEnabledSources() { return [
        { baseUrl: "https://api.openalex.org/works", connectorType: "openalex", revision: 1, sourceId: "openalex" }
      ]; },
      async loadRetrievalCache() { return null; },
      async saveRetrievalCache() {}
    }
  });

  const result = await service.relations({ subjectId: "user" }, {
    artifactId: "partial-map",
    papers: [
      { doi: "10.1000/a", id: "paper-a", provider: "crossref", sourceId: "10.1000/a" },
      { doi: "10.1000/b", id: "paper-b", provider: "crossref", sourceId: "10.1000/b" },
      { id: "paper-local", provider: "arxiv", sourceId: "local-only" }
    ]
  });

  assert.deepEqual(result.edges.map((edge) => [edge.sourcePaperId, edge.targetPaperId]), [["paper-a", "paper-b"]]);
  assert.deepEqual(result.warnings, ["paper_relation_paper_identity_unavailable"]);
});

test("relations rejects more than 24 papers before connector retrieval", async () => {
  let called = false;
  const service = new ExternalKnowledgeService({
    connectors: { openalex: async () => { called = true; return []; } },
    downloader: {},
    repository: { async listEnabledSources() { throw new Error("must not list"); } }
  });
  await assert.rejects(() => service.relations({ subjectId: "user-1" }, {
    artifactId: "artifact_relations",
    papers: Array.from({ length: 25 }, (_, index) => ({ id: `p${index}`, provider: "openalex", sourceId: `W${index}` }))
  }), /external_retrieval_relation_limit_invalid/);
  assert.equal(called, false);
});

test("relations sanitizes poisoned cached edges against the verified contract", async () => {
  const service = new ExternalKnowledgeService({
    connectors: {},
    downloader: {},
    repository: {
      async listEnabledSources() {
        return [{ baseUrl: "https://api.openalex.org/works", connectorType: "openalex", revision: 1, sourceId: "source_openalex" }];
      },
      async loadRetrievalCache() {
        return { items: { edges: [{
          directed: true,
          evidenceRecordUrls: ["http://attacker.example/evidence"],
          kind: "semantic_similarity",
          provider: "openalex",
          sourcePaperId: "paper-a",
          strength: 4,
          targetPaperId: "paper-outside-page"
        }, {
          directed: true,
          evidenceRecordUrls: ["https://openalex.org/W1"],
          kind: "direct_citation",
          provider: "openalex",
          sourcePaperId: "paper-a",
          strength: 1,
          targetPaperId: "paper-b"
        }], warnings: [] } };
      }
    }
  });
  const result = await service.relations({ subjectId: "user-1" }, relationRequest);
  assert.deepEqual(result.edges.map((edge) => edge.kind), ["direct_citation"]);
  assert.equal(result.edges[0].targetPaperId, "paper-b");
});

test("relations emits exact co_cited strength and ignores non-relation configured sources", async () => {
  const attempted = [];
  const service = new ExternalKnowledgeService({
    connectors: {
      semantic_scholar: async (configured) => {
        attempted.push(configured.connectorType);
        return [{ id: "semantic_scholar:A", provider: "semantic_scholar", referencedPaperIds: [], citingPaperIds: ["semantic_scholar:X", "semantic_scholar:Y"], evidenceRecordUrl: "https://www.semanticscholar.org/paper/A" },
          { id: "semantic_scholar:B", provider: "semantic_scholar", referencedPaperIds: [], citingPaperIds: ["semantic_scholar:X", "semantic_scholar:Z", "semantic_scholar:Q"], evidenceRecordUrl: "https://www.semanticscholar.org/paper/B" }];
      }
    },
    downloader: {},
    repository: {
      async listEnabledSources() { return [
        { baseUrl: "https://api.crossref.org/works", connectorType: "crossref", revision: 1, sourceId: "source_crossref" },
        { baseUrl: "https://api.semanticscholar.org/graph/v1/paper/search", connectorType: "semantic_scholar", revision: 1, sourceId: "source_s2" }
      ]; },
      async loadRetrievalCache() { return null; },
      async saveRetrievalCache() {}
    }
  });
  const result = await service.relations({ subjectId: "user-1" }, {
    artifactId: "artifact_relations",
    papers: [{ id: "paper-a", provider: "semantic_scholar", sourceId: "A" }, { id: "paper-b", provider: "semantic_scholar", sourceId: "B" }]
  });
  assert.deepEqual(attempted, ["semantic_scholar"]);
  assert.equal(result.edges[0].kind, "co_cited");
  assert.equal(result.edges[0].directed, false);
  assert.equal(result.edges[0].strength, 0.5);
  assert.equal(result.edges[0].evidenceRecordUrls.length, 2);
  assert.deepEqual(result.warnings, []);
});

test("relations normalizes and unions compatible identity bridges independent of input order", async () => {
  const cacheKeys = [];
  const makeService = () => new ExternalKnowledgeService({
    connectors: { relations: async () => [] }, downloader: {}, repository: {
      async listEnabledSources() { return [
        { baseUrl: "https://api.openalex.org/works", connectorType: "openalex", revision: 1, sourceId: "openalex" },
        { baseUrl: "https://api.semanticscholar.org/graph/v1/paper/search", connectorType: "semantic_scholar", revision: 1, sourceId: "s2" }
      ]; },
      async loadRetrievalCache() { return null; },
      async saveRetrievalCache(_subject, key) { cacheKeys.push(key); }
    }
  });
  const papers = [
    { id: "z", canonicalPaperId: "DOI:10.1000/TEST", doi: "https://doi.org/10.1000/test", provider: "openalex", sourceId: "https://openalex.org/w1" },
    { id: "a", doi: "10.1000/test", provider: "semantic_scholar", sourceId: "SemanticScholar:S1" }
  ];
  await makeService().relations({ subjectId: "user" }, { artifactId: "a", papers });
  await makeService().relations({ subjectId: "user" }, { artifactId: "a", papers: [...papers].reverse() });
  assert.equal(cacheKeys[0], cacheKeys[1]);
});

test("relations rejects identity conflicts and applies the limit after final component union", async () => {
  const baseRepository = {
    async listEnabledSources() { return [
      { baseUrl: "https://api.openalex.org/works", connectorType: "openalex", revision: 1, sourceId: "openalex" },
      { baseUrl: "https://api.semanticscholar.org/graph/v1/paper/search", connectorType: "semantic_scholar", revision: 1, sourceId: "s2" }
    ]; }, async loadRetrievalCache() { return null; }, async saveRetrievalCache() {}
  };
  const service = new ExternalKnowledgeService({ connectors: { relations: async () => [] }, downloader: {}, repository: baseRepository });
  await assert.rejects(() => service.relations({ subjectId: "user" }, { artifactId: "a", papers: [
    { id: "a", canonicalPaperId: "openalex:W1", provider: "openalex", sourceId: "W2" }
  ] }), /external_retrieval_relation_identity_conflict/);
  const twentyFourComponents = [
    { id: "bridge-a", doi: "10.1000/bridge", provider: "openalex", sourceId: "W100" },
    { id: "bridge-b", doi: "https://doi.org/10.1000/BRIDGE", provider: "semantic_scholar", sourceId: "S100" },
    ...Array.from({ length: 23 }, (_, index) => ({ id: `p${index}`, provider: "openalex", sourceId: `W${index + 200}` }))
  ];
  await service.relations({ subjectId: "user" }, { artifactId: "a", papers: twentyFourComponents });
  await assert.rejects(() => service.relations({ subjectId: "user" }, { artifactId: "a", papers: [
    ...twentyFourComponents, { id: "extra", provider: "openalex", sourceId: "W999" }
  ] }), /external_retrieval_relation_limit_invalid/);
});

test("relations propagates aborts and never caches partial connector results", async () => {
  let listed = 0; let cached = 0;
  const repository = {
    async listEnabledSources() { listed += 1; return [{ baseUrl: "https://api.openalex.org/works", connectorType: "openalex", revision: 1, sourceId: "openalex" }]; },
    async loadRetrievalCache() { return null; }, async saveRetrievalCache() { cached += 1; }
  };
  const pre = new AbortController(); pre.abort();
  await assert.rejects(() => new ExternalKnowledgeService({ connectors: {}, downloader: {}, repository }).relations({ subjectId: "user" }, relationRequest, pre.signal), (error) => error.name === "AbortError");
  assert.equal(listed, 0);
  await assert.rejects(() => new ExternalKnowledgeService({
    connectors: { openalex: async () => { throw new DOMException("aborted", "AbortError"); } }, downloader: {}, repository
  }).relations({ subjectId: "user" }, relationRequest, new AbortController().signal), (error) => error.name === "AbortError");
  assert.equal(cached, 0);
});

test("relations selects evidence deterministically across connector record order", async () => {
  const records = [{ id: "openalex:W1", provider: "openalex", referencedPaperIds: ["openalex:W2"], evidenceRecordUrl: "https://openalex.org/z" },
    { id: "openalex:W1", provider: "openalex", referencedPaperIds: ["openalex:W2"], evidenceRecordUrl: "https://openalex.org/a" }];
  const run = async (values) => new ExternalKnowledgeService({ connectors: { openalex: async () => values }, downloader: {}, repository: {
    async listEnabledSources() { return [{ baseUrl: "https://api.openalex.org/works", connectorType: "openalex", revision: 1, sourceId: "openalex" }]; }, async loadRetrievalCache() { return null; }, async saveRetrievalCache() {}
  } }).relations({ subjectId: "user" }, relationRequest);
  assert.deepEqual(await run(records), await run([...records].reverse()));
});

test("uses enabled connectors and returns only server-issued PDF grants", async () => {
  const issued = [];
  const saved = [];
  const service = new ExternalKnowledgeService({
    connectors: {
      crossref: async () => [source],
      openalex: async () => { throw new ExternalRetrievalError("provider_down", 502); }
    },
    downloader: {},
    repository: {
      async issuePdfGrants(subjectId, values) {
        issued.push({ subjectId, values });
        return new Map([[source.id, "pdfgrant_12345678-abcd"]]);
      },
      async loadRetrievalCache() {
        return null;
      },
      async listEnabledSources() {
        return [
          { baseUrl: "https://api.crossref.org/works", connectorType: "crossref", revision: 1, sourceId: "source_crossref" },
          { baseUrl: "https://api.openalex.org/works", connectorType: "openalex", revision: 2, sourceId: "source_openalex" }
        ];
      },
      async saveRetrievalCache(subjectId, cacheKey, values) {
        saved.push({ cacheKey, subjectId, values });
      }
    }
  });
  const result = await service.search({ subjectId: "user_1" }, {
    artifactId: "artifact_1",
    limit: 10,
    query: "test query"
  });
  assert.equal(result.sources[0].fullTextGrantId, "pdfgrant_12345678-abcd");
  assert.equal(result.retrieval.attempts, 2);
  assert.equal(issued[0].subjectId, "user_1");
  assert.equal(issued[0].values[0].connectorSourceId, "source_crossref");
  assert.equal(saved[0].subjectId, "user_1");
  assert.match(saved[0].cacheKey, /^[a-f0-9]{64}$/);
  assert.equal(saved[0].values[0].source.id, source.id);
});

test("uses a query variant only when a connector returns no primary results", async () => {
  const calls = [];
  const service = new ExternalKnowledgeService({
    connectors: {
      crossref: async (_configured, input) => {
        calls.push(["crossref", input.query]);
        return [source];
      },
      openalex: async (_configured, input) => {
        calls.push(["openalex", input.query]);
        return input.query === "multi-agent scientific workflow" ? [{
          ...source,
          id: "openalex:W123",
          provider: "openalex",
          sourceId: "W123",
          sourceRecordUrl: "https://openalex.org/W123",
          url: "https://openalex.org/W123"
        }] : [];
      }
    },
    downloader: {},
    repository: {
      async issuePdfGrants() { return new Map(); },
      async listEnabledSources() { return [
        { baseUrl: "https://api.crossref.org/works", connectorType: "crossref", revision: 1, sourceId: "crossref" },
        { baseUrl: "https://api.openalex.org/works", connectorType: "openalex", revision: 1, sourceId: "openalex" }
      ]; },
      async loadRetrievalCache() { return null; },
      async saveRetrievalCache(_subjectId, key) { assert.match(key, /^[a-f0-9]{64}$/); }
    }
  });
  const result = await service.search({ subjectId: "user" }, {
    artifactId: "artifact",
    limit: 8,
    query: "BrainPilot multi-agent scientific workflow",
    queryVariants: ["BrainPilot multi-agent scientific workflow", "multi-agent scientific workflow"]
  });
  assert.deepEqual(calls, [
    ["crossref", "BrainPilot multi-agent scientific workflow"],
    ["openalex", "BrainPilot multi-agent scientific workflow"],
    ["openalex", "multi-agent scientific workflow"]
  ]);
  assert.deepEqual(result.sources.map(({ provider }) => provider), ["crossref", "openalex"]);
});

test("reuses only the current subject cache and issues fresh PDF grants", async () => {
  let connectorCalls = 0;
  let grantSequence = 0;
  const cache = new Map();
  const configuredSources = [{
    baseUrl: "https://api.crossref.org/works",
    connectorType: "crossref",
    revision: 4,
    sourceId: "source_crossref"
  }];
  const service = new ExternalKnowledgeService({
    connectors: {
      crossref: async () => {
        connectorCalls += 1;
        return [source];
      }
    },
    downloader: {},
    repository: {
      async issuePdfGrants(subjectId) {
        grantSequence += 1;
        return new Map([[source.id, `pdfgrant_${subjectId}-${grantSequence}`]]);
      },
      async listEnabledSources() {
        return configuredSources;
      },
      async loadRetrievalCache(subjectId, cacheKey) {
        return cache.get(`${subjectId}:${cacheKey}`) ?? null;
      },
      async saveRetrievalCache(subjectId, cacheKey, values) {
        cache.set(`${subjectId}:${cacheKey}`, { items: values });
      }
    }
  });
  const request = { artifactId: "artifact_1", limit: 10, query: "test query" };

  const first = await service.search({ subjectId: "user_1" }, request);
  const second = await service.search({ subjectId: "user_1" }, request);
  const otherSubject = await service.search({ subjectId: "user_2" }, request);

  assert.equal(first.retrieval.reused, false);
  assert.equal(second.retrieval.reused, true);
  assert.equal(otherSubject.retrieval.reused, false);
  assert.equal(connectorCalls, 2);
  assert.notEqual(first.sources[0].fullTextGrantId, second.sources[0].fullTextGrantId);
  assert.match(second.sources[0].fullTextGrantId, /^pdfgrant_user_1-/);
});

test("fails closed for unknown request fields and a complete provider outage", async () => {
  let listed = false;
  const service = new ExternalKnowledgeService({
    connectors: { crossref: async () => { throw new Error("raw upstream body"); } },
    downloader: {},
    repository: {
      async issuePdfGrants() { throw new Error("must not issue"); },
      async loadRetrievalCache() { return null; },
      async listEnabledSources() {
        listed = true;
        return [{
          baseUrl: "https://api.crossref.org/works",
          connectorType: "crossref",
          revision: 1,
          sourceId: "source_crossref"
        }];
      },
      async saveRetrievalCache() { throw new Error("must not cache"); }
    }
  });
  await assert.rejects(() => service.search({ subjectId: "user_1" }, {
    artifactId: "artifact_1",
    query: "test query",
    url: "http://127.0.0.1/private"
  }), /external_retrieval_request_invalid/);
  assert.equal(listed, false);
  await assert.rejects(() => service.search({ subjectId: "user_1" }, {
    artifactId: "artifact_1",
    query: "test query"
  }), (error) => error.code === "external_retrieval_unavailable" && !error.message.includes("raw upstream"));
});

test("downloads only a subject-bound grant and never accepts a client URL", async () => {
  const service = new ExternalKnowledgeService({
    connectors: {},
    downloader: {
      async download(url) {
        assert.equal(url, "https://papers.example/paper.pdf");
        return {
          byteLength: 9,
          bytes: Buffer.from("%PDF-test"),
          contentHash: "a".repeat(64),
          contentType: "application/pdf",
          finalUrl: url
        };
      }
    },
    repository: {
      async loadPdfGrant(subjectId, input) {
        assert.equal(subjectId, "user_1");
        assert.equal(input.grantId, "pdfgrant_12345678-abcd");
        return { sourceId: source.id, url: source.fullTextUrl };
      }
    }
  });
  const result = await service.download({ subjectId: "user_1" }, {
    grantId: "pdfgrant_12345678-abcd",
    sourceId: source.id
  });
  assert.equal(result.bytesBase64, Buffer.from("%PDF-test").toString("base64"));
  await assert.rejects(() => service.download({ subjectId: "user_1" }, {
    grantId: "pdfgrant_12345678-abcd",
    sourceId: source.id,
    url: "https://attacker.example/private"
  }), /external_pdf_request_invalid/);
});

test("binds recommendation PDF grants to an enabled managed connector", async () => {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.startsWith("BEGIN") || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM platform_retrieval_sources")) {
        return { rows: [{ source_id: "source_crossref" }] };
      }
      if (sql.includes("INSERT INTO external_retrieval_pdf_grants")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
    release() {}
  };
  const repository = new PostgresExternalKnowledgeRepository({
    async connect() { return client; }
  });

  const grantId = await repository.issueRecommendationPdfGrant("user_1", {
    connectorType: "crossref",
    sourceId: "reading-candidate:doi:10.1000/test",
    sourceRecordId: "doi:10.1000/test",
    sourceUrl: "https://publisher.example/paper.pdf"
  });

  assert.match(grantId, /^pdfgrant_/);
  const insert = queries.find((query) => query.sql.includes("INSERT INTO external_retrieval_pdf_grants"));
  assert.equal(insert.values[1], "user_1");
  assert.equal(insert.values[4], "source_crossref");
  assert.equal(insert.values[5], "crossref");
  assert.equal(insert.values[6], "https://publisher.example/paper.pdf");
  assert.equal(queries.some((query) => query.sql === "COMMIT"), true);
});
