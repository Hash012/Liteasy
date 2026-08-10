import assert from "node:assert/strict";
import test from "node:test";
import { loadDevelopmentLiteratureProviderConfig } from "./developmentLiteratureProviderConfig.mjs";
import { createLiteratureProviders } from "./literatureProviders.mjs";

test("projects Intuecho development provider settings from server environment only", () => {
  const config = loadDevelopmentLiteratureProviderConfig({
    INTUECHO_ARXIV_ENDPOINT: " https://catalog.example/arxiv ",
    INTUECHO_CROSSREF_ENDPOINT: " https://catalog.example/crossref ",
    INTUECHO_OPENALEX_API_KEY: " openalex-secret ",
    INTUECHO_OPENALEX_ENDPOINT: " https://catalog.example/openalex ",
    INTUECHO_SEMANTIC_SCHOLAR_API_KEY: " semantic-secret ",
    INTUECHO_SEMANTIC_SCHOLAR_ENDPOINT: " https://catalog.example/semantic ",
    VITE_INTUECHO_OPENALEX_API_KEY: "must-not-be-projected",
    UNRELATED_SECRET: "must-not-be-projected"
  });

  assert.deepEqual(config, {
    arxivEndpoint: "https://catalog.example/arxiv",
    crossrefEndpoint: "https://catalog.example/crossref",
    openAlexApiKey: "openalex-secret",
    openAlexEndpoint: "https://catalog.example/openalex",
    semanticScholarApiKey: "semantic-secret",
    semanticScholarEndpoint: "https://catalog.example/semantic"
  });
  assert.ok(Object.isFrozen(config));
  assert.equal(JSON.stringify(config).includes("must-not-be-projected"), false);
});

test("leaves Crossref and arXiv on provider defaults and does not enable keyed providers without keys", () => {
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
  }).map((provider) => provider.name), ["crossref", "arxiv"]);
});

test("enables keyed providers from the Intuecho API process environment", () => {
  const config = loadDevelopmentLiteratureProviderConfig({
    INTUECHO_OPENALEX_API_KEY: "openalex-secret",
    INTUECHO_SEMANTIC_SCHOLAR_API_KEY: "semantic-secret"
  });

  assert.deepEqual(createLiteratureProviders(config, {
    fetchImpl: async () => { throw new Error("not called"); }
  }).map((provider) => provider.name), ["openalex", "crossref", "arxiv", "semantic_scholar"]);
});
