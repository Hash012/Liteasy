import assert from "node:assert/strict";
import test from "node:test";
import {
  createExternalRetrievalConnectors,
  retrievalConnectorEndpoints
} from "./externalRetrievalConnectors.mjs";

const config = {
  contactEmail: "research@example.test",
  semanticScholarApiKey: "deployment-secret",
  timeoutMs: 1000
};

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200
  });
}

test("maps fixed Crossref, OpenAlex, and Semantic Scholar contracts", async () => {
  const calls = [];
  const payloads = [
    { message: { items: [{
      DOI: "10.1000/Test",
      abstract: "A sufficiently detailed Crossref abstract for review.",
      author: [{ family: "Lovelace", given: "Ada" }],
      link: [{ "content-type": "application/pdf", URL: "https://publisher.example/paper.pdf" }],
      title: ["Crossref result"]
    }] } },
    { results: [{
      abstract_inverted_index: { A: [0], result: [1], with: [2], evidence: [3] },
      authorships: [{ author: { display_name: "Grace Hopper" } }],
      best_oa_location: { pdf_url: "https://repository.example/openalex.pdf" },
      display_name: "OpenAlex result",
      id: "https://openalex.org/W123456789"
    }] },
    { data: [{
      abstract: "A sufficiently detailed Semantic Scholar abstract.",
      authors: [{ name: "Katherine Johnson" }],
      openAccessPdf: { url: "https://archive.example/semantic.pdf" },
      paperId: "abcdef1234567890",
      title: "Semantic Scholar result"
    }] }
  ];
  const connectors = createExternalRetrievalConnectors(config, {
    fetchImpl: async (url, init) => {
      calls.push({ init, url: String(url) });
      return jsonResponse(payloads.shift());
    }
  });
  const source = (connectorType) => ({
    baseUrl: retrievalConnectorEndpoints[connectorType],
    connectorType,
    sourceId: `source_${connectorType}`
  });
  const input = { limit: 3, query: "retrieval evidence" };

  const [crossref] = await connectors.crossref(source("crossref"), input);
  const [openalex] = await connectors.openalex(source("openalex"), input);
  const [semantic] = await connectors.semantic_scholar(source("semantic_scholar"), input);

  assert.equal(crossref.id, "crossref:10.1000/test");
  assert.equal(crossref.sourceRecordUrl, "https://api.crossref.org/works/10.1000%2Ftest");
  assert.equal(openalex.id, "openalex:W123456789");
  assert.equal(openalex.sourceRecordUrl, "https://openalex.org/W123456789");
  assert.equal(semantic.id, "semantic_scholar:abcdef1234567890");
  assert.equal(calls[2].init.headers["x-api-key"], "deployment-secret");
  assert.equal(JSON.stringify([crossref, openalex, semantic]).includes("deployment-secret"), false);
  assert.equal(calls.every((call) => call.init.redirect === "error"), true);
});

test("rejects a connector whose stored endpoint does not match its fixed protocol", async () => {
  const connectors = createExternalRetrievalConnectors(config, {
    fetchImpl: async () => { throw new Error("must not fetch"); }
  });
  await assert.rejects(() => connectors.openalex({
    baseUrl: "https://attacker.example/works",
    sourceId: "source_bad"
  }, { limit: 1, query: "test" }), /external_retrieval_source_invalid/);
});

test("relation connectors resolve a pure Crossref paper through its DOI", async () => {
  const calls = [];
  const connectors = createExternalRetrievalConnectors(config, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      return String(url).includes("openalex.org")
        ? jsonResponse({ results: [{
            doi: "https://doi.org/10.1000/CROSSREF",
            id: "https://openalex.org/W900",
            referenced_works: []
          }] })
        : jsonResponse({
            externalIds: { DOI: "10.1000/CROSSREF" },
            paperId: "S900",
            references: []
          });
    }
  });
  const paper = {
    aliases: ["doi:10.1000/crossref", "crossref:10.1000/crossref"],
    doi: "10.1000/crossref",
    id: "crossref-row",
    provider: "crossref",
    sourceId: "10.1000/crossref"
  };

  const openAlex = await connectors.relations({
    baseUrl: retrievalConnectorEndpoints.openalex,
    connectorType: "openalex"
  }, { papers: [paper] });
  const semanticScholar = await connectors.relations({
    baseUrl: retrievalConnectorEndpoints.semantic_scholar,
    connectorType: "semantic_scholar"
  }, { papers: [paper] });

  assert.match(calls[0], /filter=doi%3A10\.1000%2Fcrossref/u);
  assert.match(calls[1], /paper\/DOI%3A10\.1000%2Fcrossref/u);
  assert.equal(openAlex.records[0].id, "openalex:W900");
  assert.equal(openAlex.records[0].doi, "doi:10.1000/crossref");
  assert.equal(semanticScholar[0].id, "semantic_scholar:S900");
  assert.equal(semanticScholar[0].doi, "doi:10.1000/crossref");
});

test("Semantic Scholar relations resolve a DOI present only in canonical aliases", async () => {
  const calls = [];
  const connectors = createExternalRetrievalConnectors(config, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      return jsonResponse({
        externalIds: { DOI: "10.1000/CANONICAL-ONLY" },
        paperId: "S-CANONICAL",
        references: []
      });
    }
  });

  const result = await connectors.relations({
    baseUrl: retrievalConnectorEndpoints.semantic_scholar,
    connectorType: "semantic_scholar"
  }, { papers: [{
    aliases: ["crossref:10.1000/canonical-only", "doi:10.1000/canonical-only"],
    id: "paper-canonical",
    provider: "crossref",
    sourceId: "10.1000/canonical-only"
  }] });

  assert.match(calls[0], /paper\/DOI%3A10\.1000%2Fcanonical-only/u);
  assert.equal(result[0].id, "semantic_scholar:S-CANONICAL");
});

test("OpenAlex relations retain graph-ID records when the DOI filter fails", async () => {
  const connectors = createExternalRetrievalConnectors(config, {
    fetchImpl: async (url) => {
      if (String(url).includes("filter=doi%3A")) throw new Error("DOI filter unavailable");
      return jsonResponse({ results: [{
        doi: "https://doi.org/10.1000/PARTIAL",
        id: "https://openalex.org/W901",
        referenced_works: []
      }] });
    }
  });

  const result = await connectors.relations({
    baseUrl: retrievalConnectorEndpoints.openalex,
    connectorType: "openalex"
  }, { papers: [{
    aliases: ["openalex:W901", "doi:10.1000/partial"],
    doi: "10.1000/partial",
    id: "openalex-row",
    provider: "openalex",
    sourceId: "W901"
  }] });

  assert.deepEqual(result.records.map((record) => record.id), ["openalex:W901"]);
  assert.deepEqual(result.warnings, [
    "openalex_co_cited_unavailable",
    "openalex_paper_relations_partial"
  ]);
});
