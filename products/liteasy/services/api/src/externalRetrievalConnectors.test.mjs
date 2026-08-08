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
