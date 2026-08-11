import assert from "node:assert/strict";
import test from "node:test";
import { loadDevelopmentLiteratureProviderConfig } from "./developmentLiteratureProviderConfig.mjs";
import { createLiteratureProviders } from "./literatureProviders.mjs";

test("projects Intuecho development provider settings from server environment only", () => {
  const config = loadDevelopmentLiteratureProviderConfig({
    INTUECHO_ARXIV_ENDPOINT: " https://catalog.example/arxiv ",
    INTUECHO_CROSSREF_ENDPOINT: " https://catalog.example/crossref ",
    INTUECHO_DBLP_RECORD_ENDPOINT: " https://catalog.example/dblp/rec ",
    INTUECHO_DBLP_SEARCH_ENDPOINT: " https://catalog.example/dblp/search ",
    INTUECHO_OPENALEX_API_KEY: " openalex-secret ",
    INTUECHO_OPENALEX_ENDPOINT: " https://catalog.example/openalex ",
    INTUECHO_OPENREVIEW_ENDPOINT: " https://catalog.example/openreview/notes ",
    INTUECHO_OPENREVIEW_SEARCH_ENDPOINT: " https://catalog.example/openreview/search ",
    INTUECHO_PMLR_ENDPOINT: " https://catalog.example/pmlr ",
    INTUECHO_SEMANTIC_SCHOLAR_API_KEY: " semantic-secret ",
    INTUECHO_SEMANTIC_SCHOLAR_ENDPOINT: " https://catalog.example/semantic ",
    VITE_INTUECHO_OPENALEX_API_KEY: "must-not-be-projected",
    UNRELATED_SECRET: "must-not-be-projected"
  });

  assert.deepEqual(config, {
    arxivEndpoint: "https://catalog.example/arxiv",
    crossrefEndpoint: "https://catalog.example/crossref",
    dblpRecordEndpoint: "https://catalog.example/dblp/rec",
    dblpSearchEndpoint: "https://catalog.example/dblp/search",
    openAlexApiKey: "openalex-secret",
    openAlexEndpoint: "https://catalog.example/openalex",
    openReviewEndpoint: "https://catalog.example/openreview/notes",
    openReviewSearchEndpoint: "https://catalog.example/openreview/search",
    pmlrEndpoint: "https://catalog.example/pmlr",
    semanticScholarApiKey: "semantic-secret",
    semanticScholarEndpoint: "https://catalog.example/semantic"
  });
  assert.ok(Object.isFrozen(config));
  assert.equal(JSON.stringify(config).includes("must-not-be-projected"), false);
});

test("keeps public providers enabled and does not enable keyed providers without keys", () => {
  const config = loadDevelopmentLiteratureProviderConfig({
    INTUECHO_OPENALEX_ENDPOINT: "https://catalog.example/openalex",
    INTUECHO_SEMANTIC_SCHOLAR_ENDPOINT: "https://catalog.example/semantic"
  });
  assert.deepEqual(config, {
    openAlexEndpoint: "https://catalog.example/openalex",
    semanticScholarEndpoint: "https://catalog.example/semantic"
  });
  assert.deepEqual(createLiteratureProviders(config, {
    fetchImpl: async () => { throw new Error("not called"); }
  }).map((provider) => provider.name), ["crossref", "arxiv", "openreview", "dblp", "pmlr"]);
});

test("enables keyed providers from the Intuecho API process environment", () => {
  const config = loadDevelopmentLiteratureProviderConfig({
    INTUECHO_OPENALEX_API_KEY: "openalex-secret",
    INTUECHO_SEMANTIC_SCHOLAR_API_KEY: "semantic-secret"
  });

  assert.deepEqual(createLiteratureProviders(config, {
    fetchImpl: async () => { throw new Error("not called"); }
  }).map((provider) => provider.name), [
    "openalex",
    "crossref",
    "arxiv",
    "openreview",
    "dblp",
    "pmlr",
    "semantic_scholar"
  ]);
});
