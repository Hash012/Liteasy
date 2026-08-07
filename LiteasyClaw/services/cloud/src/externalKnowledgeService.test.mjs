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
