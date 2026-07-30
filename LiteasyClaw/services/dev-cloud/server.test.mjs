import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createDevCloudRequestHandler } from "./server.mjs";
import { createDatabase } from "./db/database.mjs";
import {
  getRecommendationCache,
  putRecommendationCache
} from "./db/recommendationCacheRepository.mjs";
import {
  listRecommendationCandidateSources,
  listRecommendationCandidates,
  upsertRecommendationCandidates
} from "./db/recommendationCandidateRepository.mjs";
import {
  listRecommendationFeedback,
  saveRecommendationFeedback
} from "./db/recommendationFeedbackRepository.mjs";

test.beforeEach(() => {
  process.env.LITEASY_DEV_CLOUD_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "liteasy-dev-cloud-test-")
  );
});

async function invokeHandler({ body, handler, handlerOptions, headers = {}, method, url }) {
  const chunks = body ? [Buffer.from(body)] : [];
  const request = Readable.from(chunks);
  request.headers = url === "/v1/research/external-knowledge" &&
    !("x-openalex-api-key" in headers)
    ? { ...headers, "x-openalex-api-key": "test-openalex-api-key" }
    : headers;
  request.method = method;
  request.url = url;

  let endedBody = "";
  let statusCode = 200;
  let responseHeaders = {};

  const response = {
    end(payload = "") {
      endedBody += String(payload);
    },
    write(payload = "") {
      endedBody += String(payload);
      return true;
    },
    writeHead(nextStatusCode, nextHeaders) {
      statusCode = nextStatusCode;
      responseHeaders = nextHeaders;
    }
  };

  const isolatedHandlerOptions = {
    crossrefEnabled: false,
    deepseekApiKey: undefined,
    defaultProvider: "openai",
    openaiApiKey: undefined,
    recommendationMode: "demo",
    ...handlerOptions
  };

  await (handler ?? createDevCloudRequestHandler(isolatedHandlerOptions))(request, response);

  const contentType = responseHeaders["Content-Type"] ?? "";

  return {
    body: endedBody,
    headers: responseHeaders,
    json: endedBody.length > 0 && contentType.includes("application/json") ? JSON.parse(endedBody) : undefined,
    statusCode
  };
}

test("allows browser CORS preflight from the desktop dev server", async () => {
  const response = await invokeHandler({
    method: "OPTIONS",
    headers: {
      "access-control-request-headers": "content-type",
      "access-control-request-method": "POST",
      origin: "http://127.0.0.1:1420"
    },
    url: "/v1/org/summary"
  });

  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "http://127.0.0.1:1420");
  assert.equal(response.headers["Access-Control-Allow-Methods"], "DELETE,GET,POST,OPTIONS");
  assert.equal(response.headers["Access-Control-Allow-Headers"], "Content-Type,X-OpenAlex-Api-Key");
});

test("requires an OpenAlex API key before external retrieval can enter the cache", async () => {
  let calls = 0;
  const response = await invokeHandler({
    body: JSON.stringify({ artifactId: "artifact-openalex-key-required", query: "ColBERT" }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: false,
      openAlexTransport: async () => {
        calls += 1;
        return { json: async () => ({ results: [] }), ok: true, status: 200 };
      }
    }),
    headers: { "content-type": "application/json", "x-openalex-api-key": "" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json.error, "openalex_api_key_required");
  assert.match(response.json.message, /OpenAlex API 密钥/);
  assert.equal(calls, 0);
});

test("uses traceable Crossref topic results when OpenAlex is not configured", async () => {
  let openAlexCalls = 0;
  const response = await invokeHandler({
    body: JSON.stringify({ artifactId: "artifact-crossref-without-openalex", query: "ColBERT retrieval" }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: true,
      crossrefTransport: async () => ({
        json: async () => ({
          message: {
            items: [{
              DOI: "10.1000/crossref-only",
              abstract: "<jats:p>ColBERT retrieval replication.</jats:p>",
              author: [{ family: "Researcher", given: "Casey" }],
              link: [{ "content-type": "application/pdf", URL: "https://example.org/crossref-only.pdf" }],
              title: ["ColBERT retrieval replication"]
            }]
          }
        }),
        ok: true,
        status: 200
      }),
      openAlexTransport: async () => {
        openAlexCalls += 1;
        throw new Error("OpenAlex should not be called without a key");
      }
    }),
    headers: { "content-type": "application/json", "x-openalex-api-key": "" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(openAlexCalls, 0);
  assert.equal(response.json.sources.length, 1);
  assert.deepEqual(response.json.sources[0], {
    abstract: "ColBERT retrieval replication.",
    authors: ["Casey Researcher"],
    doi: "https://doi.org/10.1000/crossref-only",
    fullTextUrl: "https://example.org/crossref-only.pdf",
    id: "crossref:10.1000/crossref-only",
    openAccessAvailable: true,
    provider: "crossref",
    relation: "topic_search",
    relevance: response.json.sources[0].relevance,
    retrievalQuery: "ColBERT retrieval",
    sourceRecordUrl: "https://api.crossref.org/works/10.1000%2Fcrossref-only",
    sourceId: "10.1000/crossref-only",
    title: "ColBERT retrieval replication",
    url: "https://doi.org/10.1000/crossref-only"
  });
  assert.equal(response.json.retrieval.status, "completed");
});

test("uses traceable arXiv topic results for thin-reading external knowledge", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({
      artifactId: "thin-reading-arxiv-only",
      query: "neural retrieval systems",
      targetPaperTitle: "Target Paper"
    }),
    handler: createDevCloudRequestHandler({
      arxivEnabled: true,
      arxivTransport: async () => ({
        ok: true,
        status: 200,
        text: async () => `<feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>https://arxiv.org/abs/2401.01234v2</id>
            <published>2024-01-03T00:00:00Z</published>
            <title>Efficient Neural Retrieval Systems</title>
            <summary>This preprint reports a bounded and traceable neural retrieval method.</summary>
            <author><name>Ada Researcher</name></author>
          </entry>
        </feed>`
      }),
      crossrefEnabled: false
    }),
    headers: { "content-type": "application/json", "x-openalex-api-key": "" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200, JSON.stringify(response.json));
  assert.equal(response.json.provider, "arxiv");
  assert.equal(response.json.sources[0].id, "arxiv:2401.01234");
  assert.equal(response.json.sources[0].fullTextUrl, "https://arxiv.org/pdf/2401.01234");
  assert.equal(response.json.sources[0].sourceRecordUrl, "https://arxiv.org/abs/2401.01234");
});

test("allows secondary thin-reading retrievals to opt out of the rate-limited arXiv route", async () => {
  let arxivCalls = 0;
  const response = await invokeHandler({
    body: JSON.stringify({
      artifactId: "thin-reading-secondary-no-arxiv",
      includeArxiv: false,
      query: "replication limitations"
    }),
    handler: createDevCloudRequestHandler({
      arxivEnabled: true,
      arxivTransport: async () => {
        arxivCalls += 1;
        throw new Error("arXiv should be skipped for secondary intent");
      },
      crossrefEnabled: false,
      openAlexTransport: async () => ({
        json: async () => ({ results: [] }),
        ok: true,
        status: 200
      })
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200, JSON.stringify(response.json));
  assert.equal(response.json.status, "empty");
  assert.equal(arxivCalls, 0);
});

test("returns only a validated external PDF with content-addressed provenance", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({
      sourceId: "openalex:W42",
      url: "https://papers.example.test/paper.pdf"
    }),
    handler: createDevCloudRequestHandler({
      externalPdfResolver: async () => [{ address: "93.184.216.34", family: 4 }],
      externalPdfTransport: async () => new Response(Buffer.from("%PDF-1.7\nverified"), {
        headers: { "content-type": "application/pdf" },
        status: 200
      })
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-pdf"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.sourceId, "openalex:W42");
  assert.equal(response.json.finalUrl, "https://papers.example.test/paper.pdf");
  assert.equal(response.json.byteLength, 17);
  assert.equal(response.json.contentHash.length, 64);
  assert.equal(Buffer.from(response.json.bytesBase64, "base64").toString("ascii"), "%PDF-1.7\nverified");
});

test("does not degrade to Crossref-only sources when the configured OpenAlex key is rejected", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({ artifactId: "artifact-openalex-key-invalid", query: "ColBERT" }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: true,
      crossrefTransport: async () => ({
        json: async () => ({
          message: {
            DOI: "10.1000/crossref-fallback",
            title: ["A Crossref fallback that must not be returned"]
          }
        }),
        ok: true,
        status: 200
      }),
      openAlexTransport: async () => ({
        json: async () => ({ error: "invalid_api_key" }),
        ok: false,
        status: 401
      })
    }),
    headers: { "content-type": "application/json", "x-openalex-api-key": "invalid-test-key" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json.error, "openalex_api_key_required");
  assert.match(response.json.message, /API 密钥无效或已失效/);
  assert.equal("sources" in response.json, false);
});

test("does not reflect an untrusted browser origin", async () => {
  const response = await invokeHandler({
    method: "OPTIONS",
    headers: {
      "access-control-request-method": "POST",
      origin: "https://attacker.example"
    },
    url: "/v1/account/login"
  });

  assert.equal(response.statusCode, 204);
  assert.equal("Access-Control-Allow-Origin" in response.headers, false);
});

test("returns a helpful service index from the root path", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.name, "LiteasyClaw dev cloud");
  assert.deepEqual(response.json.endpoints, [
    "GET /",
    "GET /healthz",
    "GET /admin",
    "GET /admin/",
    "GET /v1/admin/demo-state",
    "GET /v1/admin/model-policy",
    "POST /v1/admin/demo-reset",
    "POST /v1/admin/demo-reseed",
    "POST /v1/admin/recommendation-cache/clear",
    "POST /v1/admin/model-policy",
    "GET /v1/admin/governance-dashboard",
    "POST /v1/account/demo-login",
    "POST /v1/account/login",
    "POST /v1/account/logout",
    "POST /v1/account/register",
    "POST /v1/account/session",
    "POST /v1/model/generate",
    "POST /v1/model/generate-stream",
    "POST /v1/model/audit",
    "GET /v1/agent-artifacts",
    "POST /v1/agent-artifacts",
    "DELETE /v1/agent-artifacts/:artifactId",
    "POST /v1/recommendations",
    "POST /v1/recommendations/feedback",
    "POST /v1/research/external-knowledge",
    "POST /v1/research/external-pdf",
    "POST /v1/profile/get",
    "POST /v1/profile/save",
    "POST /v1/profile/clear",
    "POST /v1/personalization/signal",
    "POST /v1/recommendation-cache/get",
    "POST /v1/recommendation-cache/put",
    "POST /v1/recommendation-cache/clear",
    "POST /v1/documents/metadata-sync",
    "POST /v1/org/create",
    "POST /v1/org/join",
    "POST /v1/org/invite",
    "POST /v1/org/leave",
    "POST /v1/org/list",
    "POST /v1/org/summary",
    "POST /v1/org/shared-library/manifest",
    "POST /v1/org/governance-summary"
  ]);
});

test("persists profile signals and clears every account personalization artifact", async () => {
  const handler = createDevCloudRequestHandler();
  const sessionId = "demo-session-1";
  const discipline = {
    categoryCode: "08",
    categoryName: "工学",
    code: "0812",
    description: "自然语言处理",
    name: "计算机科学与技术"
  };
  const invokeProfile = (url, body) => invokeHandler({
    body: JSON.stringify({ sessionId, ...body }),
    handler,
    headers: { "content-type": "application/json", host: "127.0.0.1:8787" },
    method: "POST",
    url
  });

  const saveResponse = await invokeProfile("/v1/profile/save", {
    profile: { disciplines: [discipline], stage: "博士研究生" }
  });
  assert.equal(saveResponse.statusCode, 200);
  assert.deepEqual(saveResponse.json.profile.disciplines, [discipline]);
  assert.equal(saveResponse.json.profile.stage, "博士研究生");

  const getResponse = await invokeProfile("/v1/profile/get", {});
  assert.deepEqual(getResponse.json.profile, saveResponse.json.profile);

  const signalResponse = await invokeProfile("/v1/personalization/signal", {
    signal: { kind: "paper_opened", title: "神经信息检索方法" }
  });
  assert.equal(signalResponse.statusCode, 200);
  assert.match(signalResponse.json.assistantSummary, /神经/);
  assert.equal(signalResponse.json.assistantSummary.includes("神经信息检索方法"), false);

  await invokeProfile("/v1/personalization/signal", {
    signal: { kind: "recommendation_dismissed", recommendationId: "rec-hidden" }
  });
  putRecommendationCache({
    personalizationVersion: signalResponse.json.personalizationVersion,
    selectionKey: "selection-1",
    sessionId,
    sortMode: "relevance",
    workspaceKey: "workspace-1"
  }, [{ id: "cached-rec" }]);
  saveRecommendationFeedback(sessionId, {
    action: "saved",
    candidateId: "candidate-1",
    source: "OpenAlex",
    title: "Cached paper"
  });
  upsertRecommendationCandidates(sessionId, [{
    canonicalId: "https://doi.org/10.1000/profile-clear",
    id: "candidate-1",
    qualityGate: { passed: true },
    reason: "test",
    relevanceBand: "high",
    relevanceScore: 0.9,
    scoreComponents: { sourceRelevance: 0.9 },
    source: "OpenAlex",
    sourceUrl: "https://example.test/paper",
    title: "Cached paper"
  }]);

  const clearResponse = await invokeProfile("/v1/profile/clear", {});
  assert.equal(clearResponse.statusCode, 200);
  assert.deepEqual(clearResponse.json.profile.disciplines, []);
  assert.equal(clearResponse.json.assistantSummary, undefined);
  assert.deepEqual(listRecommendationFeedback(sessionId), []);
  assert.deepEqual(listRecommendationCandidates(sessionId), []);
  assert.equal(getRecommendationCache({
    personalizationVersion: signalResponse.json.personalizationVersion,
    selectionKey: "selection-1",
    sessionId,
    sortMode: "relevance",
    workspaceKey: "workspace-1"
  }).cacheHit, false);

  const database = createDatabase();
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM academic_profiles WHERE owner_key = ?")
    .get(sessionId).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM personalization_terms WHERE owner_key = ?")
    .get(sessionId).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM recommendation_suppressions WHERE owner_key = ?")
    .get(sessionId).count, 0);
  database.close();
});

test("normalizes traceable OpenAlex works for external thin-reading research", async () => {
  const requestedUrls = [];
  const response = await invokeHandler({
    body: JSON.stringify({
      limit: 2,
      query: "ColBERT late interaction retrieval",
      targetPaperTitle: "ColBERT"
    }),
    handlerOptions: {
      openAlexTransport: async (url) => {
        requestedUrls.push(url);
        return {
          json: async () => ({
            results: [
              {
                abstract_inverted_index: { dense: [1], retrieval: [2], "Multi-vector": [0] },
                authorships: [{ author: { display_name: "Jane Researcher" } }],
                display_name: "Multi-vector dense retrieval after ColBERT",
                doi: "https://doi.org/10.1000/example",
                id: "https://openalex.org/W123456789",
                primary_location: {
                  landing_page_url: "https://example.org/paper",
                  pdf_url: "https://example.org/paper.pdf"
                },
                publication_year: 2025
              },
              {
                display_name: "ColBERT",
                id: "https://openalex.org/W999999999"
              }
            ]
          }),
          ok: true,
          status: 200
        };
      }
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.ok(requestedUrls.some((url) => /api\.openalex\.org\/works/.test(url)));
  assert.ok(requestedUrls.some((url) => /search=ColBERT/.test(url)));
  assert.equal(response.json.status, "available");
  assert.deepEqual(response.json.sources, [
    {
      abstract: "Multi-vector dense retrieval",
      authors: ["Jane Researcher"],
      doi: "https://doi.org/10.1000/example",
      fullTextUrl: "https://example.org/paper.pdf",
      id: "openalex:W123456789",
      openAccessAvailable: true,
      provider: "openalex",
      relation: "topic_search",
      relevance: response.json.sources[0].relevance,
      retrievalQuery: "ColBERT late interaction retrieval",
      sourceRecordUrl: "https://openalex.org/W123456789",
      sourceId: "W123456789",
      title: "Multi-vector dense retrieval after ColBERT",
      url: "https://example.org/paper",
      year: 2025
    }
  ]);
  assert.ok(response.json.sources[0].relevance > 0);
  assert.ok(response.json.sources[0].relevance <= 1);
});

test("retrieves up to 32 external candidates before generation-side narrowing", async () => {
  const requestedUrls = [];
  const response = await invokeHandler({
    body: JSON.stringify({ limit: 100, query: "retrieval candidate" }),
    handlerOptions: {
      crossrefEnabled: false,
      openAlexTransport: async (url) => {
        requestedUrls.push(url);
        return {
          json: async () => ({
            results: Array.from({ length: 40 }, (_, index) => ({
              abstract_inverted_index: { candidate: [1], retrieval: [0] },
              display_name: `Retrieval candidate ${index}`,
              id: `https://openalex.org/W${1000 + index}`
            }))
          }),
          ok: true,
          status: 200
        };
      }
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.sources.length, 32);
  assert.equal(new URL(requestedUrls[0]).searchParams.get("per-page"), "33");
});

test("diversifies near-duplicate external candidates with an MMR-style penalty", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({ limit: 3, query: "retrieval methods" }),
    handlerOptions: {
      crossrefEnabled: false,
      openAlexTransport: async () => ({
        json: async () => ({ results: [
          {
            abstract_inverted_index: { benchmark: [2], dense: [0], methods: [4], retrieval: [1], repeated: [3] },
            display_name: "Dense retrieval benchmark repeated methods",
            id: "https://openalex.org/W8101"
          },
          {
            abstract_inverted_index: { benchmark: [2], dense: [0], methods: [4], retrieval: [1], repeated: [3] },
            display_name: "Dense retrieval benchmark repeated methods extension",
            id: "https://openalex.org/W8102"
          },
          {
            abstract_inverted_index: { compression: [2], methods: [4], multilingual: [0], retrieval: [1], survey: [3] },
            display_name: "Multilingual retrieval compression survey methods",
            id: "https://openalex.org/W8103"
          }
        ] }),
        ok: true,
        status: 200
      })
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.sources.map((source) => source.sourceId), ["W8101", "W8103", "W8102"]);
});

test("merges Crossref topic results without inventing graph relations or duplicating a DOI", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({ artifactId: "crossref-merge", limit: 5, query: "retrieval evaluation" }),
    handlerOptions: {
      crossrefEnabled: true,
      crossrefTransport: async () => ({
        json: async () => ({
          message: { items: [
            { DOI: "10.1000/shared", title: ["Retrieval evaluation from Crossref"] },
            { DOI: "10.1000/crossref-only", author: [{ family: "Author", given: "C" }], title: ["Retrieval evaluation replication"] }
          ] }
        }),
        ok: true,
        status: 200
      }),
      openAlexTransport: async () => ({
        json: async () => ({
          results: [{
            display_name: "Retrieval evaluation from OpenAlex",
            doi: "https://doi.org/10.1000/shared",
            id: "https://openalex.org/W4242"
          }]
        }),
        ok: true,
        status: 200
      })
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.provider, "openalex+crossref");
  assert.equal(response.json.sources.filter((source) => source.doi === "https://doi.org/10.1000/shared").length, 1);
  const sharedSource = response.json.sources.find((source) => source.doi === "https://doi.org/10.1000/shared");
  assert.equal(sharedSource.canonicalPaperId, "doi:10.1000/shared");
  assert.deepEqual(
    sharedSource.sourceRecords.map((record) => record.provider).sort(),
    ["crossref", "openalex"]
  );
  assert.deepEqual(response.json.sources.find((source) => source.provider === "crossref"), {
    abstract: "",
    authors: ["C Author"],
    doi: "https://doi.org/10.1000/crossref-only",
    id: "crossref:10.1000/crossref-only",
    provider: "crossref",
    relation: "topic_search",
    relevance: response.json.sources.find((source) => source.provider === "crossref").relevance,
    retrievalQuery: "retrieval evaluation",
    sourceRecordUrl: "https://api.crossref.org/works/10.1000%2Fcrossref-only",
    sourceId: "10.1000/crossref-only",
    title: "Retrieval evaluation replication",
    url: "https://doi.org/10.1000/crossref-only"
  });
});

test("links DOI and versionless arXiv aliases without asserting a version relationship", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({ artifactId: "arxiv-alias-merge", limit: 5, query: "retrieval pretraining" }),
    handlerOptions: {
      crossrefEnabled: true,
      crossrefTransport: async () => ({
        json: async () => ({
          message: { items: [{
            "alternative-id": ["arXiv:2101.01234v2"],
            DOI: "10.1000/versioned",
            issued: { "date-parts": [[2024]] },
            title: ["Retrieval pretraining methods"]
          }] }
        }),
        ok: true,
        status: 200
      }),
      openAlexTransport: async () => ({
        json: async () => ({
          results: [{
            display_name: "Retrieval pretraining methods",
            id: "https://openalex.org/W5000",
            ids: { arxiv: "https://arxiv.org/abs/2101.01234v3" },
            publication_year: 2021
          }]
        }),
        ok: true,
        status: 200
      })
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.sources.length, 1);
  const merged = response.json.sources[0];
  assert.equal(merged.canonicalPaperId, "doi:10.1000/versioned");
  assert.equal(merged.arxivId, "2101.01234");
  assert.equal(merged.doi, "https://doi.org/10.1000/versioned");
  assert.deepEqual(merged.sourceRecords.map((record) => record.provider).sort(), ["crossref", "openalex"]);
});

test("derives bounded one-hop OpenAlex relations from explicit graph fields", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({
      limit: 5,
      query: "target paper citation neighborhood",
      targetPaperIdentity: { kind: "doi", value: "10.1000/target" },
      targetPaperTitle: "A misleading local title"
    }),
    handlerOptions: {
      openAlexTransport: async () => ({
        json: async () => ({
          results: [
            {
              display_name: "Canonical Target",
              doi: "https://doi.org/10.1000/TARGET",
              id: "https://openalex.org/W100",
              referenced_works: ["https://openalex.org/W101"],
              related_works: ["https://openalex.org/W103"]
            },
            { display_name: "Prior Work", id: "https://openalex.org/W101" },
            {
              display_name: "Follow-up Work",
              id: "https://openalex.org/W102",
              referenced_works: ["https://openalex.org/W100"]
            },
            { display_name: "Related Work", id: "https://openalex.org/W103" },
            { display_name: "Citation Neighborhood Survey", id: "https://openalex.org/W104" }
          ]
        }),
        ok: true,
        status: 200
      })
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    Object.fromEntries(response.json.sources.map((source) => [source.sourceId, source.relation])),
    {
      W101: "cited_by_target",
      W102: "cites_target",
      W103: "related",
      W104: "topic_search"
    }
  );
  assert.ok(!response.json.sources.some((source) => source.sourceId === "W100"));
});

test("resolves a missing target work by DOI before deriving a one-hop relation", async () => {
  const requestedUrls = [];
  const response = await invokeHandler({
    body: JSON.stringify({
      query: "follow-up retrieval system",
      targetPaperIdentity: { kind: "doi", value: "10.1000/target" },
      targetPaperTitle: "Canonical Target"
    }),
    handlerOptions: {
      openAlexTransport: async (url) => {
        requestedUrls.push(url);
        const exactTargetRequest = url.includes("/works/https://doi.org/10.1000/target");
        return {
          json: async () => exactTargetRequest
            ? {
                display_name: "Canonical Target",
                doi: "https://doi.org/10.1000/target",
                id: "https://openalex.org/W200",
                referenced_works: ["https://openalex.org/W201"]
              }
            : {
                results: [
                  {
                    display_name: "Prior Work",
                    id: "https://openalex.org/W201"
                  },
                  {
                    display_name: "Unrelated Numerical Library",
                    id: "https://openalex.org/W202"
                  }
                ]
              },
          ok: true,
          status: 200
        };
      }
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requestedUrls.length, 4);
  assert.match(requestedUrls[1], /works\/https:\/\/doi\.org\/10\.1000\/target/);
  assert.ok(requestedUrls.some((url) => /works\/W201/.test(url)));
  assert.ok(requestedUrls.some((url) => /filter=cites%3AW200/.test(url)));
  assert.equal(response.json.sources[0].relation, "cited_by_target");
  assert.ok(!response.json.sources.some((source) => source.sourceId === "W202"));
});

test("resolves a missing target work by arXiv identity before deriving a one-hop relation", async () => {
  const requestedUrls = [];
  const response = await invokeHandler({
    body: JSON.stringify({
      query: "attention architecture follow-up",
      targetPaperIdentity: { kind: "arxiv_id", value: "1706.03762v5" },
      targetPaperTitle: "A title absent from this search page"
    }),
    handlerOptions: {
      openAlexTransport: async (url) => {
        requestedUrls.push(url);
        const exactTargetRequest = url.includes("/works/https://arxiv.org/abs/1706.03762");
        return {
          json: async () => exactTargetRequest
            ? {
                display_name: "Attention Target",
                id: "https://openalex.org/W300",
                referenced_works: ["https://openalex.org/W301"]
              }
            : {
                results: [{
                  display_name: "Attention Follow-up",
                  id: "https://openalex.org/W301"
                }]
              },
          ok: true,
          status: 200
        };
      }
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(requestedUrls.length, 4);
  assert.match(requestedUrls[1], /works\/https:\/\/arxiv\.org\/abs\/1706\.03762/);
  assert.ok(requestedUrls.some((url) => /works\/W301/.test(url)));
  assert.ok(requestedUrls.some((url) => /filter=cites%3AW300/.test(url)));
  assert.equal(response.json.sources[0].relation, "cited_by_target");
});

test("expands a bounded target citation neighborhood beyond keyword-search results", async () => {
  const requestedUrls = [];
  const response = await invokeHandler({
    body: JSON.stringify({
      limit: 5,
      query: "unrelated wording",
      targetPaperIdentity: { kind: "doi", value: "10.1000/target" },
      targetPaperTitle: "Target Paper"
    }),
    handlerOptions: {
      openAlexTransport: async (url) => {
        requestedUrls.push(url);
        if (url.includes("/works/https://doi.org/10.1000/target")) {
          return {
            json: async () => ({
              display_name: "Target Paper",
              doi: "https://doi.org/10.1000/target",
              id: "https://openalex.org/W500",
              referenced_works: ["https://openalex.org/W501"],
              related_works: ["https://openalex.org/W502"]
            }),
            ok: true,
            status: 200
          };
        }
        if (url.includes("/works/W501")) {
          return {
            json: async () => ({ display_name: "Referenced Work", id: "https://openalex.org/W501" }),
            ok: true,
            status: 200
          };
        }
        if (url.includes("/works/W502")) {
          return {
            json: async () => ({ display_name: "Related Work", id: "https://openalex.org/W502" }),
            ok: true,
            status: 200
          };
        }
        if (url.includes("filter=cites%3AW500")) {
          return {
            json: async () => ({ results: [{
              display_name: "Citing Work",
              id: "https://openalex.org/W503",
              referenced_works: ["https://openalex.org/W500"]
            }] }),
            ok: true,
            status: 200
          };
        }
        return { json: async () => ({ results: [] }), ok: true, status: 200 };
      }
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.ok(requestedUrls.some((url) => /works\/W501/.test(url)));
  assert.ok(requestedUrls.some((url) => /works\/W502/.test(url)));
  assert.ok(requestedUrls.some((url) => /filter=cites%3AW500/.test(url)));
  assert.deepEqual(
    Object.fromEntries(response.json.sources.map((source) => [source.sourceId, source.relation])),
    { W501: "cited_by_target", W502: "related", W503: "cites_target" }
  );
});

test("recovers an artifact-scoped external retrieval after failure and reuses the completed result", async () => {
  let calls = 0;
  const createHandler = () => createDevCloudRequestHandler({
    crossrefEnabled: false,
    openAlexTransport: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("temporary upstream failure");
      }
      return {
        json: async () => ({
          results: [{
            display_name: "Retrieval Follow-up",
            id: "https://openalex.org/W401"
          }]
        }),
        ok: true,
        status: 200
      };
    }
  });
  const request = {
    artifactId: "artifact-thin-recovery",
    query: "retrieval follow-up",
    targetPaperTitle: "Target Paper"
  };

  const first = await invokeHandler({
    body: JSON.stringify(request),
    handler: createHandler(),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });
  expectExternalRetrievalFailure(first);

  const second = await invokeHandler({
    body: JSON.stringify(request),
    // Recreate the handler to prove the failed state is read from SQLite,
    // rather than surviving only in a process-local request cache.
    handler: createHandler(),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json.retrieval, {
    attempts: 2,
    id: second.json.retrieval.id,
    reused: false,
    status: "completed"
  });
  assert.equal(second.json.sources[0].sourceId, "W401");

  const third = await invokeHandler({
    body: JSON.stringify(request),
    handler: createHandler(),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });
  assert.equal(third.statusCode, 200);
  assert.deepEqual(third.json.retrieval, {
    attempts: 2,
    id: second.json.retrieval.id,
    reused: true,
    status: "completed"
  });
  assert.equal(calls, 2);
});

function expectExternalRetrievalFailure(response) {
  assert.equal(response.statusCode, 502);
  assert.equal(response.json.error, "openalex_unavailable");
  assert.deepEqual(response.json.retrieval, {
    attempts: 1,
    id: response.json.retrieval.id,
    reused: false,
    status: "failed"
  });
}

test("rejects an unsafe artifact boundary before external retrieval", async () => {
  let calls = 0;
  const response = await invokeHandler({
    body: JSON.stringify({ artifactId: "../unsafe", query: "retrieval follow-up" }),
    handlerOptions: {
      openAlexTransport: async () => {
        calls += 1;
        throw new Error("should not be called");
      }
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.error, "invalid_external_knowledge_artifact_id");
  assert.equal(calls, 0);
});

test("returns an explicit empty external-knowledge result without synthetic sources", async () => {
  let calls = 0;
  const handler = createDevCloudRequestHandler({
    crossrefEnabled: false,
    openAlexTransport: async () => {
      calls += 1;
      return {
        json: async () => ({ results: [] }),
        ok: true,
        status: 200
      };
    }
  });
  const request = { artifactId: "artifact-thin-empty", query: "a research topic with no OpenAlex result" };
  const response = await invokeHandler({
    body: JSON.stringify(request),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.status, "empty");
  assert.deepEqual(response.json.sources, []);
  assert.deepEqual(response.json.retrieval, {
    attempts: 1,
    id: response.json.retrieval.id,
    reused: false,
    status: "skipped"
  });

  const reused = await invokeHandler({
    body: JSON.stringify(request),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });
  assert.equal(reused.statusCode, 200);
  assert.equal(reused.json.retrieval.status, "skipped");
  assert.equal(reused.json.retrieval.reused, true);
  assert.equal(calls, 1);
});

test("reports an OpenAlex upstream failure instead of falling back to static knowledge", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({ query: "ColBERT follow-up work" }),
    handlerOptions: {
      openAlexTransport: async () => ({
        json: async () => ({}),
        ok: false,
        status: 503
      })
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.json.error, "openalex_upstream_error");
});

test("reports an explicit timeout when OpenAlex does not respond", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({ query: "ColBERT citation network" }),
    handlerOptions: {
      openAlexTimeoutMs: 5,
      openAlexTransport: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      })
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 504);
  assert.equal(response.json.error, "openalex_timeout");
});

test("streams model deltas as NDJSON", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({ model: "gpt-5.5", prompt: "stream", provider: "openai" }),
    handlerOptions: {
      streamingProviders: {
        openai: async function* streamProvider() {
          yield "Hello ";
          yield "stream";
        }
      }
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/model/generate-stream"
  });

  const events = response.body.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "application/x-ndjson; charset=utf-8");
  assert.deepEqual(events, [
    { delta: "Hello stream", type: "delta" },
    {
      answer: "Hello stream",
      execution: { backend: "dev_cloud", mode: "live", provider: "openai" },
      type: "completed"
    }
  ]);
});

test("returns a healthy status from the health endpoint", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/healthz"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.deepEqual(response.json, {
    ok: true
  });
});

test("deletes a persisted Agent artifact by validated id", async (context) => {
  const resultDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-agent-artifacts-"));
  context.after(() => fs.rmSync(resultDirectory, { force: true, recursive: true }));
  const handlerOptions = { agentArtifactResultDirectory: resultDirectory };
  const artifact = {
    agent: {
      apiVersion: "liteasy.agent/v1",
      runId: "run-1",
      sessionId: "session-1",
      status: "completed"
    },
    answer: "analysis",
    artifactId: "artifact-delete",
    artifactType: "tree",
    citations: [],
    createdAt: "2026-07-20T00:00:00.000Z",
    papers: [],
    title: "Tree",
    uiDsl: { version: "liteasy.ui/v1" },
    version: "liteasy.agent-artifact/v1"
  };
  const created = await invokeHandler({
    body: JSON.stringify(artifact),
    handlerOptions,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/agent-artifacts"
  });
  assert.equal(created.statusCode, 201);

  const deleted = await invokeHandler({
    handlerOptions,
    method: "DELETE",
    url: "/v1/agent-artifacts/artifact-delete"
  });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.json, {
    artifactId: "artifact-delete",
    deleted: true,
    path: "project-docs/agent-results/artifact-delete.json"
  });
  assert.equal(fs.existsSync(path.join(resultDirectory, "artifact-delete.json")), false);

  const missing = await invokeHandler({
    handlerOptions,
    method: "DELETE",
    url: "/v1/agent-artifacts/artifact-delete"
  });
  assert.equal(missing.statusCode, 404);

  const unsafe = await invokeHandler({
    handlerOptions,
    method: "DELETE",
    url: "/v1/agent-artifacts/%2E%2E%2Fescape"
  });
  assert.equal(unsafe.statusCode, 400);
  assert.equal(unsafe.json.error, "invalid_agent_artifact_id");
});

test("prefers a configured public origin for deploy-facing links and policy payloads", async () => {
  const handlerOptions = {
    publicOrigin: "https://demo.liteasy.example"
  };

  const rootResponse = await invokeHandler({
    handlerOptions,
    method: "GET",
    headers: {
      host: "10.0.0.5:8787"
    },
    url: "/"
  });

  assert.equal(rootResponse.statusCode, 200);
  assert.equal(rootResponse.json.publicOrigin, "https://demo.liteasy.example");

  const policyResponse = await invokeHandler({
    handlerOptions,
    method: "GET",
    headers: {
      host: "10.0.0.5:8787"
    },
    url: "/v1/admin/model-policy"
  });

  assert.equal(policyResponse.statusCode, 200);
  assert.equal(policyResponse.json.cloudProxyEndpoint, "https://demo.liteasy.example");

  const adminResponse = await invokeHandler({
    handlerOptions,
    method: "GET",
    headers: {
      host: "10.0.0.5:8787"
    },
    url: "/admin/"
  });

  assert.equal(adminResponse.statusCode, 200);
  assert.match(adminResponse.body, /https:\/\/demo\.liteasy\.example\/admin\//);
  assert.doesNotMatch(adminResponse.body, /http:\/\/127\.0\.0\.1:8787\/admin\//);
});



test("returns the demo admin console html", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/admin/"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "text/html; charset=utf-8");
  assert.match(response.body, /LiteasyClaw Operations Console/);
  assert.match(response.body, /内部运营与运维后台/);
  assert.match(response.body, /客户桌面软件端/);
  assert.match(response.body, /客户组织资源/);
  assert.match(response.body, /API 策略/);
  assert.match(response.body, /默认 Provider/);
  assert.match(response.body, /运维下发 API 策略/);
  assert.match(response.body, /保存 API 策略/);
  assert.match(response.body, /fetch\("\/v1\/admin\/model-policy"/);
  assert.match(response.body, /用户与账号/);
  assert.match(response.body, /活跃客户用户/);
  assert.match(response.body, /活跃会话数/);
  assert.match(response.body, /收藏总数/);
  assert.match(response.body, /推荐缓存条目数/);
  assert.match(response.body, /Liteasy AI Reading Lab/);
  assert.match(response.body, /组织共享文献库索引刷新/);
  assert.match(response.body, /Admin 更新共享文献库上传权限/);
  assert.match(response.body, /重置 Demo 数据/);
  assert.match(response.body, /重新播种 Demo 数据/);
  assert.match(response.body, /\/v1\/admin\/demo-state/);
  assert.match(response.body, /42%/);
  assert.match(response.body, /38 GB \/ 100 GB/);
  assert.match(response.body, /\/v1\/admin\/governance-dashboard/);
});

test("returns the demo admin console html without a trailing slash", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/admin"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "text/html; charset=utf-8");
  assert.match(response.body, /LiteasyClaw Operations Console/);
  assert.match(response.body, /\/v1\/admin\/governance-dashboard/);
});


test("returns the demo admin governance dashboard payload", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/v1/admin/governance-dashboard"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.dashboard.name, "LiteasyClaw Operations Governance Dashboard");
  assert.equal(response.json.dashboard.environment, "local-demo");
  assert.equal(response.json.dashboard.threeEndStatus.desktop.label, "客户桌面软件端");
  assert.equal(response.json.dashboard.threeEndStatus.desktop.url, "http://127.0.0.1:1420/");
  assert.equal(response.json.dashboard.threeEndStatus.devCloud.url, "http://127.0.0.1:8787/");
  assert.equal(response.json.dashboard.threeEndStatus.adminConsole.label, "内部运营与运维后台");
  assert.equal(response.json.dashboard.threeEndStatus.adminConsole.url, "http://127.0.0.1:8787/admin/");
  assert.equal(response.json.dashboard.organizations.length, 2);
  assert.equal(response.json.dashboard.apiPolicy.defaultProvider, "openai");
  assert.equal(response.json.dashboard.apiPolicy.modelAccessMode, "cloud_proxy");
  assert.equal(response.json.dashboard.users.activeUsers, 16);
  assert.equal(response.json.dashboard.users.desktopCustomers, 2);
  assert.equal(response.json.dashboard.auditQueue.pendingReview, 3);
  assert.equal(response.json.dashboard.quota.storageUsedGb, 38);
  assert.equal(typeof response.json.dashboard.demoState.summary.activeSessionCount, "number");
  assert.equal(typeof response.json.dashboard.demoState.summary.collectionItemCount, "number");
  assert.equal(typeof response.json.dashboard.demoState.summary.recommendationCacheEntryCount, "number");
  assert.ok(Array.isArray(response.json.dashboard.demoState.activities));
});

test("returns a non-empty admin demo state summary", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/v1/admin/demo-state"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.json.summary.organizationCount, "number");
  assert.equal(typeof response.json.summary.collectionItemCount, "number");
  assert.equal(typeof response.json.summary.recommendationCacheEntryCount, "number");
  assert.equal(typeof response.json.summary.activeSessionCount, "number");
});

test("resets demo state through the admin reset endpoint", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({}),
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/admin/demo-reset"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.reset, true);
});

test("explains that demo login must be called with POST", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/v1/account/demo-login"
  });

  assert.equal(response.statusCode, 405);
  assert.equal(response.json.error, "method_not_allowed");
  assert.equal(response.json.method, "POST");
  assert.equal(response.json.endpoint, "/v1/account/demo-login");
  assert.match(response.json.message, /浏览器直接打开/);
});

test("registers a personal account and rejects duplicate email addresses", async () => {
  const handler = createDevCloudRequestHandler();
  const registerBody = JSON.stringify({
    displayName: "Tian",
    email: "tian@example.com",
    password: "private-password-1"
  });

  const firstResponse = await invokeHandler({
    body: registerBody,
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/register"
  });

  assert.equal(firstResponse.statusCode, 201);
  assert.equal(firstResponse.json.session.email, "tian@example.com");
  assert.equal(firstResponse.json.session.name, "Tian");
  assert.equal(firstResponse.json.session.membershipTier, "pro");
  assert.match(firstResponse.json.session.sessionId, /^ltsy_[A-Za-z0-9_-]{43}$/);
  assert.equal(typeof firstResponse.json.session.userId, "string");

  const duplicateResponse = await invokeHandler({
    body: registerBody,
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/register"
  });

  assert.equal(duplicateResponse.statusCode, 409);
  assert.equal(duplicateResponse.json.error, "account_exists");
  assert.match(duplicateResponse.json.message, /已经注册/);
});

test("logs in a previously registered personal account", async () => {
  const handler = createDevCloudRequestHandler();

  await invokeHandler({
    body: JSON.stringify({
      displayName: "Tian",
      email: "tian@example.com",
      password: "private-password-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/register"
  });

  const loginResponse = await invokeHandler({
    body: JSON.stringify({
      email: "tian@example.com",
      password: "private-password-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/login"
  });

  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.json.session.email, "tian@example.com");
  assert.equal(loginResponse.json.session.name, "Tian");
});

test("persists accounts across request handler restarts and stores an Argon2id hash", async () => {
  const password = "private-password-1";
  const registrationResponse = await invokeHandler({
    body: JSON.stringify({
      displayName: "Persistent Tian",
      email: "persistent@example.com",
      password
    }),
    handler: createDevCloudRequestHandler(),
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/register"
  });

  assert.equal(registrationResponse.statusCode, 201);

  const database = createDatabase();
  const credential = database
    .prepare("SELECT password_hash FROM password_credentials")
    .get();
  assert.match(credential.password_hash, /^\$argon2id\$/);
  assert.equal(credential.password_hash.includes(password), false);
  database.close();

  const loginResponse = await invokeHandler({
    body: JSON.stringify({
      email: "persistent@example.com",
      password
    }),
    handler: createDevCloudRequestHandler(),
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/login"
  });

  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.json.session.name, "Persistent Tian");
  assert.notEqual(
    loginResponse.json.session.sessionId,
    registrationResponse.json.session.sessionId
  );
});

test("validates and revokes an opaque account session", async () => {
  const handler = createDevCloudRequestHandler();
  const registrationResponse = await invokeHandler({
    body: JSON.stringify({
      displayName: "Session User",
      email: "session@example.com",
      password: "private-password-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/register"
  });
  const sessionId = registrationResponse.json.session.sessionId;

  const validationResponse = await invokeHandler({
    body: JSON.stringify({ sessionId }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/session"
  });
  assert.equal(validationResponse.statusCode, 200);
  assert.equal(validationResponse.json.session.email, "session@example.com");

  const logoutResponse = await invokeHandler({
    body: JSON.stringify({ sessionId }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/logout"
  });
  assert.equal(logoutResponse.statusCode, 200);
  assert.deepEqual(logoutResponse.json, { loggedOut: true });

  const revokedResponse = await invokeHandler({
    body: JSON.stringify({ sessionId }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/session"
  });
  assert.equal(revokedResponse.statusCode, 401);
  assert.equal(revokedResponse.json.error, "invalid_session");
});

test("scopes private account data to the stable user identity behind session tokens", async () => {
  const handler = createDevCloudRequestHandler();
  const password = "private-password-1";
  const registrationResponse = await invokeHandler({
    body: JSON.stringify({
      displayName: "Collection User",
      email: "collection@example.com",
      password
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/register"
  });
  const firstSession = registrationResponse.json.session;
  const collectionItem = {
    id: "artifact-reference-1",
    reason: "账号级持久化测试",
    savedAt: "2026-07-03T12:00:00.000Z",
    source: "Liteasy",
    title: "Persistent private item"
  };

  const saveResponse = await invokeHandler({
    body: JSON.stringify({
      item: collectionItem,
      sessionId: firstSession.sessionId
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/collection/items"
  });
  assert.equal(saveResponse.statusCode, 200);

  const loginResponse = await invokeHandler({
    body: JSON.stringify({
      email: "collection@example.com",
      password
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/login"
  });

  const listResponse = await invokeHandler({
    body: JSON.stringify({
      sessionId: loginResponse.json.session.sessionId
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/collection/list"
  });
  assert.deepEqual(listResponse.json.items, [collectionItem]);

  const bypassResponse = await invokeHandler({
    body: JSON.stringify({
      sessionId: `user:${firstSession.userId}`
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/collection/list"
  });
  assert.equal(bypassResponse.statusCode, 401);
  assert.equal(bypassResponse.json.error, "invalid_session");
});

test("returns a generic error for an incorrect account password", async () => {
  const handler = createDevCloudRequestHandler();
  await invokeHandler({
    body: JSON.stringify({
      displayName: "Tian",
      email: "tian@example.com",
      password: "private-password-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/register"
  });

  const response = await invokeHandler({
    body: JSON.stringify({
      email: "tian@example.com",
      password: "incorrect-password"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/login"
  });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json, {
    error: "invalid_credentials",
    message: "邮箱或密码不正确。"
  });
});

test("accepts deep-analysis prompts and rejects oversized JSON bodies", async () => {
  const shortPasswordResponse = await invokeHandler({
    body: JSON.stringify({
      displayName: "Tian",
      email: "tian@example.com",
      password: "short"
    }),
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/account/register"
  });
  assert.equal(shortPasswordResponse.statusCode, 400);
  assert.equal(shortPasswordResponse.json.error, "invalid_account_registration");

  const deepAnalysisResponse = await invokeHandler({
    body: JSON.stringify({
      model: "gpt-5.5",
      prompt: "x".repeat(128 * 1024),
      provider: "openai"
    }),
    handlerOptions: {
      providers: {
        openai: async () => "deep analysis accepted"
      }
    },
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/model/generate"
  });
  assert.equal(deepAnalysisResponse.statusCode, 200);
  assert.equal(deepAnalysisResponse.json.answer, "deep analysis accepted");

  const oversizedResponse = await invokeHandler({
    body: JSON.stringify({ prompt: "x".repeat(520 * 1024) }),
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/model/generate"
  });
  assert.equal(oversizedResponse.statusCode, 413);
  assert.equal(oversizedResponse.json.error, "request_body_too_large");
});

test("stores and returns private cloud collection items for a demo session", async () => {
  const handler = createDevCloudRequestHandler();

  const saveResponse = await invokeHandler({
    body: JSON.stringify({
      item: {
        id: "rec-vdbms-1",
        reason: "同样关注向量数据库系统架构与相似度检索能力。",
        savedAt: "2026-05-14T10:30:00.000Z",
        source: "Semantic Scholar",
        title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
      },
      sessionId: "demo-session-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/collection/items"
  });

  assert.equal(saveResponse.statusCode, 200);
  assert.equal(saveResponse.json.items.length, 1);
  assert.equal(saveResponse.json.items[0].id, "rec-vdbms-1");

  const getResponse = await invokeHandler({
    body: JSON.stringify({
      sessionId: "demo-session-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/collection/list"
  });

  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.json.items.length, 1);
  assert.equal(getResponse.json.items[0].title, "VBASE: Unifying Online Vector Similarity Search and Relational Queries");
});

test("stores and reads recommendation cache separately from collection data", async () => {
  const handler = createDevCloudRequestHandler();

  const putResponse = await invokeHandler({
    body: JSON.stringify({
      recommendations: [
        {
          discoveredAt: "2026-05-14T08:15:00Z",
          id: "rec-bert-1",
          relatedDocumentTitle: "BERT",
          relevanceBand: "high",
          relevanceScore: 0.92,
          reason: "cached",
          source: "Semantic Scholar",
          sourceKind: "cache",
          title: "RoBERTa"
        }
      ],
      selectionKey: "demo-2",
      sessionId: "demo-session-1",
      sortMode: "relevance",
      workspaceKey: "local:/tmp/LiteasyLibrary"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/recommendation-cache/put"
  });

  assert.equal(putResponse.statusCode, 200);
  assert.equal(putResponse.json.ok, true);

  const getResponse = await invokeHandler({
    body: JSON.stringify({
      selectionKey: "demo-2",
      sessionId: "demo-session-1",
      sortMode: "relevance",
      workspaceKey: "local:/tmp/LiteasyLibrary"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/recommendation-cache/get"
  });

  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.json.cacheHit, true);
  assert.equal(getResponse.json.recommendations.length, 1);
  assert.equal(getResponse.json.recommendations[0].id, "rec-bert-1");
});

test("rejects recommendation cache writes without explicit source provenance", async () => {
  const handler = createDevCloudRequestHandler();

  const putResponse = await invokeHandler({
    body: JSON.stringify({
      recommendations: [
        {
          discoveredAt: "2026-05-14T08:15:00Z",
          id: "rec-bert-1",
          relatedDocumentTitle: "BERT",
          relevanceBand: "high",
          relevanceScore: 0.92,
          reason: "cached",
          source: "Semantic Scholar",
          title: "RoBERTa"
        }
      ],
      selectionKey: "demo-2",
      sessionId: "demo-session-1",
      sortMode: "relevance",
      workspaceKey: "local:/tmp/LiteasyLibrary"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/recommendation-cache/put"
  });

  assert.equal(putResponse.statusCode, 400);
  assert.equal(putResponse.json.error, "invalid_recommendation_cache_payload");
});

test("expires stale recommendation cache entries before a new online refresh", () => {
  const scope = {
    selectionKey: "paper-1",
    sessionId: "demo-session-1",
    sortMode: "relevance",
    workspaceKey: "local:/tmp/LiteasyLibrary"
  };
  putRecommendationCache(scope, [{ id: "rec-old" }]);

  const result = getRecommendationCache(scope, {
    maxAgeMs: 10,
    now: new Date(Date.now() + 11)
  });

  assert.deepEqual(result, { cacheHit: false, recommendations: [] });
});

test("clearing recommendation cache does not remove private cloud collection data", async () => {
  const handler = createDevCloudRequestHandler();

  await invokeHandler({
    body: JSON.stringify({
      item: {
        id: "rec-bert-1",
        reason: "同样关注大规模预训练语言模型的迁移能力。",
        savedAt: "2026-05-14T10:30:00.000Z",
        source: "Semantic Scholar",
        title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
      },
      sessionId: "demo-session-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/collection/items"
  });

  await invokeHandler({
    body: JSON.stringify({
      recommendations: [
        {
          discoveredAt: "2026-05-14T08:15:00Z",
          id: "rec-bert-1",
          relatedDocumentTitle: "BERT",
          relevanceBand: "high",
          relevanceScore: 0.92,
          reason: "cached",
          source: "Semantic Scholar",
          title: "RoBERTa"
        }
      ],
      selectionKey: "demo-2",
      sessionId: "demo-session-1",
      sortMode: "relevance",
      workspaceKey: "local:/tmp/LiteasyLibrary"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/recommendation-cache/put"
  });

  const clearResponse = await invokeHandler({
    body: JSON.stringify({
      selectionKey: "demo-2",
      sessionId: "demo-session-1",
      sortMode: "relevance",
      workspaceKey: "local:/tmp/LiteasyLibrary"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/recommendation-cache/clear"
  });

  assert.equal(clearResponse.statusCode, 200);
  assert.equal(clearResponse.json.cleared, true);

  const collectionResponse = await invokeHandler({
    body: JSON.stringify({
      sessionId: "demo-session-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/collection/list"
  });

  assert.equal(collectionResponse.statusCode, 200);
  assert.equal(collectionResponse.json.items.length, 1);
  assert.equal(
    collectionResponse.json.items[0].title,
    "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
  );
});

test("returns available endpoints for unknown paths", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/missing"
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json.error, "not_found");
  assert.equal(response.json.path, "/missing");
  assert.ok(response.json.availableEndpoints.includes("POST /v1/account/demo-login"));
  assert.match(response.json.message, /LiteasyClaw dev cloud/);
});


test("lets internal operations update the demo model policy", async () => {
  const handler = createDevCloudRequestHandler();
  const updateResponse = await invokeHandler({
    handler,
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      defaultProvider: "mock",
      localDirectEnabled: true,
      modelAccessMode: "local_direct"
    }),
    url: "/v1/admin/model-policy"
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.json.policy.defaultProvider, "mock");
  assert.equal(updateResponse.json.policy.localDirectEnabled, true);
  assert.equal(updateResponse.json.policy.modelAccessMode, "local_direct");
  assert.equal(updateResponse.json.policy.policyVersion, "ops-policy-v2");
  assert.equal(updateResponse.json.updatedBy, "internal-ops-demo");

  const getResponse = await invokeHandler({
    handler,
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/v1/admin/model-policy"
  });

  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.json.defaultProvider, "mock");
  assert.equal(getResponse.json.localDirectEnabled, true);
  assert.equal(getResponse.json.modelAccessMode, "local_direct");
  assert.equal(getResponse.json.policyVersion, "ops-policy-v2");
});

test("returns a policy snapshot from the control plane endpoint", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/v1/admin/model-policy"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(response.json.modelAccessMode, "cloud_proxy");
  assert.equal(response.json.defaultProvider, "openai");
  assert.equal(response.json.cloudProxyEndpoint, "http://127.0.0.1:8787");
  assert.equal(response.json.policyVersion, "dev-policy-v1");
  assert.equal(response.json.syncedAt, "2026-05-14T09:30:00Z");
});

test("returns a deterministic generated answer from the model endpoint", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      prompt: "问题：BERT 的核心方法是什么？",
      provider: "openai",
      source: "cloud_proxy"
    }),
    url: "/v1/model/generate"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    answer: "开发云回答：BERT 的核心方法是什么？",
    execution: {
      backend: "dev_cloud",
      mode: "mock_fallback",
      provider: "mock"
    }
  });
});

test("does not synthesize generated theme planner actions without an api key", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      prompt: [
        "你是 LiteasyClaw Command Mode V2 的语义动作规划器。",
        "只输出 JSON，不要输出 Markdown。",
        "用户输入：颜色变为粉色",
        "已注册动作：[]"
      ].join("\n"),
      provider: "openai",
      source: "cloud_proxy"
    }),
    url: "/v1/model/generate"
  });

  assert.equal(response.statusCode, 200);
  assert.throws(() => JSON.parse(response.json.answer));
  assert.match(response.json.answer, /^开发云回答：/);
  assert.equal(response.json.execution.mode, "mock_fallback");
});

test("uses the configured openai provider when an api key is available", async () => {
  let capturedInput;
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      model: "gpt-5-mini",
      prompt: "问题：BERT 的核心方法是什么？",
      provider: "openai",
      source: "cloud_proxy"
    }),
    url: "/v1/model/generate",
    handlerOptions: {
      openaiApiKey: "sk-test",
      providers: {
        openai: async (input) => {
          capturedInput = input;
          return "来自 OpenAI provider 的回答";
        }
      }
    }
  });

  assert.deepEqual(capturedInput, {
    model: "gpt-5-mini",
    prompt: "问题：BERT 的核心方法是什么？",
    provider: "openai",
    source: "cloud_proxy"
  });
  assert.deepEqual(response.json, {
    answer: "来自 OpenAI provider 的回答",
    execution: {
      backend: "dev_cloud",
      mode: "live",
      provider: "openai"
    }
  });
});

test("returns a demo account session from the account login endpoint", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      mode: "demo_login"
    }),
    url: "/v1/account/demo-login"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    session: {
      email: "researcher@liteasy.dev",
      expiresAt: "2026-05-15T09:30:00Z",
      membershipTier: "pro",
      name: "Liteasy Researcher",
      sessionId: "demo-session-1"
    }
  });
});

test("returns related recommendations for the selected document set", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      selectedDocuments: [
        {
          id: "demo-2",
          title: "Survey of Vector Database Management Systems"
        }
      ],
      sessionId: "demo-session-1"
    }),
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    recommendations: [
      {
        discoveredAt: "2026-05-14T08:15:00Z",
        id: "rec-vdbms-1",
        relatedDocumentTitle: "Survey of Vector Database Management Systems",
        relevanceBand: "high",
        relevanceScore: 0.92,
        reason: "同样关注向量数据库系统架构与相似度检索能力。",
        source: "Semantic Scholar",
        sourceKind: "mock",
        title: "VBASE: Unifying Online Vector Similarity Search and Relational Queries"
      },
      {
        discoveredAt: "2026-05-14T09:10:00Z",
        id: "rec-vdbms-2",
        relatedDocumentTitle: "Survey of Vector Database Management Systems",
        relevanceBand: "medium",
        relevanceScore: 0.78,
        reason: "补充开源向量数据库系统实现，便于和综述框架对照。",
        source: "arXiv Watch",
        sourceKind: "mock",
        title: "Milvus: A Purpose-Built Vector Data Management System"
      }
    ]
  });
});

test("rejects malformed recommendation research profiles before retrieval", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      researchProfile: {
        datasets: [],
        languages: [],
        methods: [],
        topics: Array.from({ length: 13 }, (_, index) => `topic-${index}`)
      },
      selectedDocuments: [{ id: "paper-1", title: "Target Retrieval Paper" }],
      sessionId: "demo-session-1"
    }),
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.error, "research_profile_topics_invalid");
});

test("returns provenance-bearing live reading candidates instead of demo recommendations", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-1", title: "Target Retrieval Paper" }],
      sessionId: "demo-session-1"
    }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: false,
      openAlexTransport: async () => ({
        json: async () => ({
          results: [
            {
              abstract_inverted_index: { Candidate: [0], retrieval: [1], methods: [2] },
              authorships: [],
              id: "https://openalex.org/W200",
              primary_location: { landing_page_url: "https://example.org/candidate" },
              publication_year: 2025,
              referenced_works: [],
              related_works: [],
              display_name: "Candidate Retrieval Methods"
            },
            {
              abstract_inverted_index: {},
              authorships: [],
              id: "https://openalex.org/W100",
              primary_location: { landing_page_url: "https://example.org/target" },
              publication_year: 2024,
              referenced_works: [],
              related_works: [],
              display_name: "Target Retrieval Paper"
            }
          ]
        }),
        ok: true,
        status: 200
      }),
      recommendationMode: "live"
    }),
    headers: { "content-type": "application/json", "x-openalex-api-key": "test-openalex-api-key" },
    method: "POST",
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.recommendations.length, 1);
  assert.deepEqual(response.json.qualityGate, {
    accepted: 1,
    evaluated: 1,
    rejected: 0,
    version: "recommendation-quality/v1"
  });
  assert.deepEqual(response.json.rankingFusion, {
    absoluteRelevanceFloorWeight: 0.3,
    candidateCount: 1,
    fusionWeight: 0.7,
    k: 10,
    routes: [
      { id: "provider", weight: 0.35 },
      { id: "lexical_bm25", weight: 0.3 }
    ],
    version: "recommendation-ranking-fusion/v1"
  });
  assert.deepEqual(response.json.externalReranker, {
    status: "disabled",
    version: "recommendation-external-reranker/v1"
  });
  assert.deepEqual(response.json.recommendations[0], {
    abstract: "Candidate retrieval methods",
    authors: [],
    canonicalId: "openalex:W200",
    discoveredAt: response.json.recommendations[0].discoveredAt,
    id: "reading-candidate:openalex:W200",
    identityResolution: {
      aliases: ["openalex:W200"],
      canonicalId: "openalex:W200",
      consistent: true,
      lineageStatus: "single_record",
      providers: ["openalex"],
      records: [{
        id: "openalex:W200",
        provider: "openalex",
        recordUrl: "https://openalex.org/W200",
        title: "Candidate Retrieval Methods",
        url: "https://example.org/candidate",
        year: 2025
      }],
      version: "recommendation-identity/v2"
    },
    publishedYear: 2025,
    qualityGate: {
      checks: {
        canonicalIdentity: true,
        crossProviderConsistent: true,
        notKnownRetracted: true,
        plausiblePublicationYear: true,
        supportedProvider: true,
        traceableHttpsSource: true,
        usableTitle: true
      },
      passed: true,
      reasons: [],
      version: "recommendation-quality/v1"
    },
    primaryProvider: "openalex",
    rankingFusion: {
      calibratedScore: 0.775,
      fusionScore: 1,
      k: 10,
      routes: [
        { contribution: 0.031818, id: "provider", rank: 1, score: 0.775, weight: 0.35 },
        { contribution: 0.027273, id: "lexical_bm25", rank: 1, score: 1, weight: 0.3 }
      ],
      version: "recommendation-ranking-fusion/v1"
    },
    relatedDocumentTitle: "Target Retrieval Paper",
    relatedDocumentTitles: ["Target Retrieval Paper"],
    relation: "topic_search",
    relevanceBand: "high",
    relevanceScore: 0.775,
    reason: "该条目来自主题检索，建议作为候选阅读线索而非论文结论的证据。 已通过 provider / lexical_bm25 多路排名的 RRF 融合校准顺序。",
    scoreComponents: {
      baseRelevance: 0.775,
      diversityPenalty: 0,
      finalScore: 0.775,
      fusionScore: 1,
      lexicalRelevance: 1,
      preference: 0,
      preFusionRelevance: 0.775,
      profileRelevance: 0,
      providerRelevance: 0.775,
      sourceRelevance: 0.775
    },
    source: "OpenAlex",
    sourceKind: "live",
    sourceUrl: "https://example.org/candidate",
    title: "Candidate Retrieval Methods"
  });
  assert.match(response.json.recommendations[0].discoveredAt, /^\d{4}-\d{2}-\d{2}T/);
  const candidatePool = listRecommendationCandidates("demo-session-1");
  assert.equal(candidatePool.length, 1);
  assert.equal(candidatePool[0].canonicalId, "openalex:W200");
  assert.equal(candidatePool[0].discoveryCount, 1);
  assert.equal(candidatePool[0].rankingFusion.version, "recommendation-ranking-fusion/v1");
  assert.equal(candidatePool[0].status, "candidate");
  assert.deepEqual(response.json.semanticRetrieval, {
    status: "disabled",
    version: "recommendation-semantic-retrieval/v1"
  });
});

test("applies a configured real embedding provider to recommendation ranking", async () => {
  let embeddingRequest;
  const response = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-semantic", title: "Target Semantic Retrieval" }],
      sessionId: "semantic-retrieval-user"
    }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: false,
      openAlexTransport: async () => ({
        json: async () => ({
          results: [{
            abstract_inverted_index: { Candidate: [0], semantic: [1], retrieval: [2] },
            authorships: [],
            id: "https://openalex.org/W299",
            primary_location: { landing_page_url: "https://openalex.org/W299" },
            publication_year: 2025,
            referenced_works: [],
            related_works: [],
            display_name: "Target Semantic Retrieval Candidate"
          }]
        }),
        ok: true,
        status: 200
      }),
      recommendationEmbeddingApiKey: "semantic-secret",
      recommendationEmbeddingBaseUrl: "https://embedding.example.com/v1",
      recommendationEmbeddingModel: "research-embedding-v1",
      recommendationEmbeddingTransport: async (url, options) => {
        embeddingRequest = { body: JSON.parse(options.body), headers: options.headers, url };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: [
              { embedding: [1, 0, 0, 0, 0, 0, 0, 0], index: 0 },
              { embedding: [0.6, 0.8, 0, 0, 0, 0, 0, 0], index: 1 }
            ]
          })
        };
      },
      recommendationMode: "live"
    }),
    headers: {
      "content-type": "application/json",
      "x-openalex-api-key": "test-openalex-api-key"
    },
    method: "POST",
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.recommendations.length, 1);
  const candidate = response.json.recommendations[0];
  assert.equal(candidate.scoreComponents.providerRelevance, 1);
  assert.equal(candidate.scoreComponents.semanticRelevance, 0.6);
  assert.equal(candidate.scoreComponents.sourceRelevance, 0.86);
  assert.deepEqual(
    candidate.rankingFusion.routes.map((route) => route.id),
    ["provider", "lexical_bm25", "semantic"]
  );
  assert.match(candidate.reason, /真实 embedding provider/);
  assert.deepEqual(response.json.semanticRetrieval, {
    candidateCount: 1,
    dimension: 8,
    inputCount: 2,
    model: "research-embedding-v1",
    provider: "openai_compatible",
    status: "completed",
    version: "recommendation-semantic-retrieval/v1"
  });
  assert.equal(embeddingRequest.url, "https://embedding.example.com/v1/embeddings");
  assert.equal(embeddingRequest.headers.Authorization, "Bearer semantic-secret");
  assert.equal(embeddingRequest.body.input.length, 2);
  assert.equal(JSON.stringify(response.json).includes("semantic-secret"), false);
});

test("applies a configured external reranker only to the quality-gated shortlist", async () => {
  let rerankerRequest;
  const response = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-reranker", title: "Target Reranker Paper" }],
      sessionId: "external-reranker-user"
    }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: false,
      openAlexTransport: async () => ({
        json: async () => ({
          results: [
            {
              abstract_inverted_index: { dense: [0], language: [1], retrieval: [2] },
              authorships: [{ author: { display_name: "Ada Author" } }],
              display_name: "Target Reranker Dense Language Retrieval",
              id: "https://openalex.org/W301",
              primary_location: { landing_page_url: "https://openalex.org/W301" },
              referenced_works: [],
              related_works: []
            },
            {
              abstract_inverted_index: { graph: [0], protein: [1], retrieval: [2] },
              authorships: [{ author: { display_name: "Ben Author" } }],
              display_name: "Target Reranker Graph Protein Retrieval",
              id: "https://openalex.org/W302",
              primary_location: { landing_page_url: "https://openalex.org/W302" },
              referenced_works: [],
              related_works: []
            },
            {
              abstract_inverted_index: {},
              authorships: [],
              display_name: "Target Reranker Paper",
              id: "https://openalex.org/W300",
              primary_location: { landing_page_url: "https://openalex.org/W300" },
              referenced_works: [],
              related_works: []
            }
          ]
        }),
        ok: true,
        status: 200
      }),
      recommendationMode: "live",
      recommendationRerankerApiKey: "reranker-secret",
      recommendationRerankerBaseUrl: "https://reranker.example.com/v2",
      recommendationRerankerModel: "research-reranker-v1",
      recommendationRerankerTransport: async (url, options) => {
        rerankerRequest = { body: JSON.parse(options.body), headers: options.headers, url };
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            results: [
              { index: 1, relevance_score: 0.99 },
              { index: 0, relevance_score: 0.1 }
            ]
          })
        };
      }
    }),
    headers: {
      "content-type": "application/json",
      "x-openalex-api-key": "test-openalex-api-key"
    },
    method: "POST",
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(rerankerRequest.url, "https://reranker.example.com/v2/rerank");
  assert.equal(rerankerRequest.headers.Authorization, "Bearer reranker-secret");
  assert.equal(rerankerRequest.body.query, "Target Reranker Paper");
  assert.equal(rerankerRequest.body.documents.length, 2);
  assert.equal(response.json.recommendations[0].canonicalId, "openalex:W302");
  assert.equal(response.json.recommendations[0].externalReranker.rank, 1);
  assert.equal(response.json.recommendations[0].scoreComponents.externalRerankerRelevance, 0.99);
  assert.deepEqual(response.json.externalReranker, {
    candidateCount: 2,
    model: "research-reranker-v1",
    provider: "rerank_api",
    queryLength: 21,
    status: "completed",
    version: "recommendation-external-reranker/v1",
    weight: 0.65
  });
  assert.equal(
    listRecommendationCandidates("external-reranker-user")[0].externalReranker.version,
    "recommendation-external-reranker/v1"
  );
  assert.equal(JSON.stringify(response.json).includes("reranker-secret"), false);
});

test("returns bounded traceable arXiv recommendations without an OpenAlex key", async () => {
  let requestedUrl = "";
  let requestedAccept = "";
  const response = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-arxiv", title: "Neural Retrieval Systems" }],
      sessionId: "arxiv-only-user"
    }),
    handler: createDevCloudRequestHandler({
      arxivEnabled: true,
      arxivTransport: async (url, options) => {
        requestedUrl = url;
        requestedAccept = options.headers.Accept;
        return {
          ok: true,
          status: 200,
          text: async () => `<?xml version="1.0" encoding="UTF-8"?>
            <feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
              <entry>
                <id>http://arxiv.org/abs/2401.01234v3</id>
                <published>2024-01-03T00:00:00Z</published>
                <title>Efficient Neural Retrieval Systems</title>
                <summary>Neural retrieval systems with bounded late interaction.</summary>
                <author><name>Ada Researcher</name></author>
              </entry>
            </feed>`
        };
      },
      crossrefEnabled: false,
      recommendationMode: "live"
    }),
    headers: { "content-type": "application/json", "x-openalex-api-key": "" },
    method: "POST",
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.recommendations.length, 1);
  const candidate = response.json.recommendations[0];
  assert.equal(candidate.canonicalId, "arxiv:2401.01234");
  assert.equal(candidate.primaryProvider, "arxiv");
  assert.equal(candidate.source, "arXiv");
  assert.equal(candidate.sourceUrl, "https://arxiv.org/abs/2401.01234");
  assert.equal(candidate.openAccessAvailable, true);
  assert.equal(candidate.qualityGate.checks.supportedProvider, true);
  assert.deepEqual(candidate.identityResolution.records, [{
    arxivId: "2401.01234",
    id: "arxiv:2401.01234",
    provider: "arxiv",
    recordUrl: "https://arxiv.org/abs/2401.01234",
    title: "Efficient Neural Retrieval Systems",
    url: "https://arxiv.org/abs/2401.01234",
    year: 2024
  }]);
  const query = new URL(requestedUrl);
  assert.equal(query.origin + query.pathname, "https://export.arxiv.org/api/query");
  assert.equal(query.searchParams.get("max_results"), "6");
  assert.match(query.searchParams.get("search_query"), /^all:Neural Retrieval Systems$/);
  assert.equal(requestedAccept, "application/atom+xml");
});

test("merges OpenAlex and arXiv records by versionless arXiv identity", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-arxiv-merge", title: "Target Retrieval Architecture" }],
      sessionId: "arxiv-merge-user"
    }),
    handler: createDevCloudRequestHandler({
      arxivEnabled: true,
      arxivTransport: async () => ({
        ok: true,
        status: 200,
        text: async () => `<feed xmlns="http://www.w3.org/2005/Atom">
          <entry>
            <id>https://arxiv.org/abs/2101.01234v2</id>
            <published>2021-01-04T00:00:00Z</published>
            <title>Traceable Retrieval Architecture</title>
            <summary>Traceable retrieval architecture for research systems.</summary>
            <author><name>Alex Author</name></author>
          </entry>
        </feed>`
      }),
      crossrefEnabled: false,
      openAlexTransport: async () => ({
        json: async () => ({
          results: [{
            abstract_inverted_index: { Traceable: [0], retrieval: [1], architecture: [2] },
            authorships: [],
            id: "https://openalex.org/W81234",
            ids: { arxiv: "https://arxiv.org/abs/2101.01234v1" },
            primary_location: { landing_page_url: "https://openalex.org/W81234" },
            publication_year: 2021,
            referenced_works: [],
            related_works: [],
            display_name: "Traceable Retrieval Architecture"
          }]
        }),
        ok: true,
        status: 200
      }),
      recommendationMode: "live"
    }),
    headers: {
      "content-type": "application/json",
      "x-openalex-api-key": "test-openalex-api-key"
    },
    method: "POST",
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.recommendations.length, 1);
  const candidate = response.json.recommendations[0];
  assert.equal(candidate.canonicalId, "arxiv:2101.01234");
  assert.deepEqual(candidate.identityResolution.providers, ["openalex", "arxiv"]);
  assert.equal(candidate.identityResolution.lineageStatus, "same_identifier");
  assert.deepEqual(
    candidate.identityResolution.records.map((record) => record.id),
    ["openalex:W81234", "arxiv:2101.01234"]
  );
  assert.equal(candidate.source, "OpenAlex + arXiv");
  assert.match(candidate.reason, /按 arXiv ID 合并/);
});

test("preserves an arXiv-declared DOI as bounded publication-link evidence", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-publication-link", title: "Target Published Retrieval" }],
      sessionId: "publication-link-user"
    }),
    handler: createDevCloudRequestHandler({
      arxivEnabled: true,
      arxivTransport: async () => ({
        ok: true,
        status: 200,
        text: async () => `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
          <entry>
            <id>https://arxiv.org/abs/2301.01234v2</id>
            <published>2023-01-04T00:00:00Z</published>
            <title>Published Retrieval Candidate</title>
            <summary>Published retrieval candidate with a declared journal DOI.</summary>
            <author><name>Alex Author</name></author>
            <arxiv:doi>10.1000/arxiv-published</arxiv:doi>
          </entry>
        </feed>`
      }),
      crossrefEnabled: true,
      crossrefTransport: async () => ({
        json: async () => ({
          message: {
            items: [{
              DOI: "10.1000/arxiv-published",
              author: [{ family: "Author", given: "Alex" }],
              issued: { "date-parts": [[2024]] },
              title: ["Published retrieval candidate"]
            }]
          }
        }),
        ok: true,
        status: 200
      }),
      recommendationMode: "live"
    }),
    headers: { "content-type": "application/json", "x-openalex-api-key": "" },
    method: "POST",
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.recommendations.length, 1);
  const candidate = response.json.recommendations[0];
  assert.equal(candidate.canonicalId, "doi:10.1000/arxiv-published");
  assert.equal(
    candidate.identityResolution.lineageStatus,
    "provider_declared_publication_link"
  );
  assert.deepEqual(candidate.identityResolution.providers, ["crossref", "arxiv"]);
  assert.deepEqual(candidate.identityResolution.lineageEvidence, {
    declaredBy: "arxiv",
    relation: "arxiv_declared_doi",
    sourceId: "arxiv:2301.01234",
    sourceRecordUrl: "https://arxiv.org/abs/2301.01234",
    targetId: "doi:10.1000/arxiv-published"
  });
  assert.match(candidate.reason, /记录级出版关联/);
  assert.match(candidate.reason, /尚未核验两版全文内容等价/);
  const persisted = listRecommendationCandidates("publication-link-user");
  assert.equal(persisted.length, 1);
  assert.deepEqual(
    persisted[0].identityResolution.lineageEvidence,
    candidate.identityResolution.lineageEvidence
  );
});

test("keeps OpenAlex recommendations when the optional arXiv feed is invalid", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-arxiv-failure", title: "Target Retrieval Evaluation" }],
      sessionId: "arxiv-failure-user"
    }),
    handler: createDevCloudRequestHandler({
      arxivEnabled: true,
      arxivTransport: async () => ({
        ok: true,
        status: 200,
        text: async () => "<!DOCTYPE feed><feed></feed>"
      }),
      crossrefEnabled: false,
      openAlexTransport: async () => ({
        json: async () => ({
          results: [{
            abstract_inverted_index: { Retrieval: [0], evaluation: [1] },
            authorships: [],
            id: "https://openalex.org/W84567",
            primary_location: { landing_page_url: "https://openalex.org/W84567" },
            publication_year: 2025,
            referenced_works: [],
            related_works: [],
            display_name: "Traceable Retrieval Evaluation"
          }]
        }),
        ok: true,
        status: 200
      }),
      recommendationMode: "live"
    }),
    headers: {
      "content-type": "application/json",
      "x-openalex-api-key": "test-openalex-api-key"
    },
    method: "POST",
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.recommendations.length, 1);
  assert.equal(response.json.recommendations[0].canonicalId, "openalex:W84567");
  assert.deepEqual(response.json.recommendations[0].identityResolution.providers, ["openalex"]);
});

test("migrates provider and arXiv candidate keys to DOI without duplicating history", () => {
  const qualityGate = { passed: true, checks: {}, reasons: [], version: "recommendation-quality/v1" };
  const baseCandidate = {
    canonicalId: "openalex:W900",
    discoveredAt: "2026-07-28T00:00:00.000Z",
    id: "reading-candidate:openalex:W900",
    primaryProvider: "openalex",
    qualityGate,
    reason: "candidate",
    relevanceBand: "high",
    relevanceScore: 0.8,
    relatedDocumentTitle: "Target",
    scoreComponents: { sourceRelevance: 0.8 },
    source: "OpenAlex",
    sourceUrl: "https://openalex.org/W900",
    title: "Canonical Identity Paper"
  };
  upsertRecommendationCandidates("identity-user", [baseCandidate], new Date("2026-07-28T00:00:00.000Z"));
  upsertRecommendationCandidates("identity-user", [{
    ...baseCandidate,
    canonicalId: "arxiv:2101.01234",
    discoveredAt: "2026-07-28T12:00:00.000Z",
    id: "reading-candidate:arxiv:2101.01234",
    identityResolution: {
      aliases: ["openalex:W900", "arxiv:2101.01234"],
      arxivId: "2101.01234",
      canonicalId: "arxiv:2101.01234",
      consistent: true,
      lineageStatus: "single_record",
      providers: ["openalex"],
      records: [{
        arxivId: "2101.01234",
        id: "openalex:W900",
        provider: "openalex",
        title: "Canonical Identity Paper",
        url: "https://arxiv.org/abs/2101.01234"
      }],
      version: "recommendation-identity/v1"
    }
  }], new Date("2026-07-28T12:00:00.000Z"));
  upsertRecommendationCandidates("identity-user", [{
    ...baseCandidate,
    canonicalId: "doi:10.1000/canonical",
    discoveredAt: "2026-07-29T00:00:00.000Z",
    id: "reading-candidate:doi:10.1000/canonical",
    identityResolution: {
      aliases: ["openalex:W900", "arxiv:2101.01234", "crossref:10.1000/canonical"],
      arxivId: "2101.01234",
      canonicalId: "doi:10.1000/canonical",
      consistent: true,
      doi: "https://doi.org/10.1000/canonical",
      lineageStatus: "possible_version_family",
      providers: ["openalex", "crossref"],
      records: [{
        arxivId: "2101.01234",
        doi: "https://doi.org/10.1000/canonical",
        id: "openalex:W900",
        provider: "openalex",
        title: "Canonical Identity Paper",
        url: "https://openalex.org/W900"
      }],
      version: "recommendation-identity/v1"
    },
    source: "OpenAlex + Crossref",
    sourceUrl: "https://doi.org/10.1000/canonical"
  }], new Date("2026-07-29T00:00:00.000Z"));

  const candidates = listRecommendationCandidates("identity-user");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].canonicalId, "doi:10.1000/canonical");
  assert.equal(candidates[0].discoveryCount, 3);
  assert.equal(candidates[0].firstDiscoveredAt, "2026-07-28T00:00:00.000Z");
  assert.deepEqual(listRecommendationCandidateSources("identity-user", "Target")[0], {
    canonicalPaperId: "doi:10.1000/canonical",
    arxivId: "2101.01234",
    discoveredAt: "2026-07-29T00:00:00.000Z",
    doi: "https://doi.org/10.1000/canonical",
    fromCandidatePool: true,
    id: "doi:10.1000/canonical",
    provider: "openalex",
    relevance: 0.8,
    sourceRecords: candidates[0].identityResolution.records,
    title: "Canonical Identity Paper",
    url: "https://doi.org/10.1000/canonical"
  });
});

test("persists negative recommendation feedback, invalidates cache, and lowers similar candidates", async () => {
  const handler = createDevCloudRequestHandler({
    crossrefEnabled: false,
    openAlexTransport: async () => ({
      json: async () => ({
        results: [
          {
            abstract_inverted_index: { Candidate: [0], retrieval: [1], methods: [2] },
            authorships: [],
            display_name: "Candidate Retrieval Methods",
            id: "https://openalex.org/W200",
            primary_location: { landing_page_url: "https://example.org/candidate" },
            referenced_works: [],
            related_works: []
          },
          {
            abstract_inverted_index: { Candidate: [0], retrieval: [1], extensions: [2] },
            authorships: [],
            display_name: "Candidate Retrieval Extensions",
            id: "https://openalex.org/W201",
            primary_location: { landing_page_url: "https://example.org/extensions" },
            referenced_works: [],
            related_works: []
          },
          {
            abstract_inverted_index: {},
            authorships: [],
            display_name: "Target Retrieval Paper",
            id: "https://openalex.org/W100",
            primary_location: { landing_page_url: "https://example.org/target" },
            referenced_works: [],
            related_works: []
          }
        ]
      }),
      ok: true,
      status: 200
    }),
    recommendationMode: "live"
  });
  const scope = {
    selectionKey: "paper-1",
    sessionId: "demo-session-1",
    sortMode: "relevance",
    workspaceKey: "local:/tmp/LiteasyLibrary"
  };
  const initialRecommendationResponse = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-1", title: "Target Retrieval Paper" }],
      sessionId: "demo-session-1"
    }),
    handler,
    headers: { "content-type": "application/json", "x-openalex-api-key": "test-openalex-api-key" },
    method: "POST",
    url: "/v1/recommendations"
  });
  assert.equal(initialRecommendationResponse.statusCode, 200);
  assert.equal(
    listRecommendationCandidates("demo-session-1")
      .find((candidate) => candidate.canonicalId === "openalex:W200")?.status,
    "candidate"
  );
  putRecommendationCache(scope, [{ id: "cached" }]);

  const feedbackResponse = await invokeHandler({
    body: JSON.stringify({
      action: "dismissed",
      candidate: {
        canonicalId: "openalex:W200",
        id: "reading-candidate:openalex:W200",
        source: "OpenAlex",
        title: "Candidate Retrieval Methods"
      },
      sessionId: "demo-session-1"
    }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/recommendations/feedback"
  });

  assert.equal(feedbackResponse.statusCode, 200);
  assert.equal(feedbackResponse.json.feedback.action, "dismissed");
  assert.equal(feedbackResponse.json.invalidatedCacheEntries, 1);
  assert.deepEqual(getRecommendationCache(scope), { cacheHit: false, recommendations: [] });
  assert.equal(
    listRecommendationCandidates("demo-session-1")
      .find((candidate) => candidate.canonicalId === "openalex:W200")?.status,
    "dismissed"
  );

  const recommendationResponse = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-1", title: "Target Retrieval Paper" }],
      sessionId: "demo-session-1"
    }),
    handler,
    headers: { "content-type": "application/json", "x-openalex-api-key": "test-openalex-api-key" },
    method: "POST",
    url: "/v1/recommendations"
  });

  assert.equal(recommendationResponse.statusCode, 200);
  assert.equal(recommendationResponse.json.recommendations.some((item) => item.canonicalId === "openalex:W200"), false);
  const similar = recommendationResponse.json.recommendations.find((item) => item.canonicalId === "openalex:W201");
  assert.ok(similar);
  assert.ok(similar.scoreComponents.preference < 0);
  assert.match(similar.reason, /曾忽略的主题相近/);
  assert.ok(
    listRecommendationCandidates("demo-session-1")
      .find((candidate) => candidate.canonicalId === "openalex:W201")?.discoveryCount >= 2
  );
});

test("reuses a recent persistent candidate without presenting it as a new live discovery", async () => {
  let retrievalCount = 0;
  const handler = createDevCloudRequestHandler({
    crossrefEnabled: false,
    openAlexTransport: async () => {
      retrievalCount += 1;
      return {
        json: async () => ({
          results: [
            ...(retrievalCount === 1 ? [{
              authorships: [],
              display_name: "Persistent Candidate Methods",
              id: "https://openalex.org/W700",
              primary_location: { landing_page_url: "https://example.org/durable" },
              referenced_works: [],
              related_works: []
            }] : []),
            {
              authorships: [],
              display_name: "Persistent Pool Target",
              id: "https://openalex.org/W701",
              primary_location: { landing_page_url: "https://example.org/target" },
              referenced_works: [],
              related_works: []
            }
          ]
        }),
        ok: true,
        status: 200
      };
    },
    recommendationMode: "live"
  });
  const request = () => invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-1", title: "Persistent Pool Target" }],
      sessionId: "demo-session-1"
    }),
    handler,
    headers: { "content-type": "application/json", "x-openalex-api-key": "test-openalex-api-key" },
    method: "POST",
    url: "/v1/recommendations"
  });

  const first = await request();
  const originalDiscoveredAt = first.json.recommendations[0].discoveredAt;
  assert.equal(first.json.recommendations[0].sourceKind, "live");

  const second = await request();
  assert.equal(second.statusCode, 200);
  assert.equal(second.json.recommendations[0].canonicalId, "openalex:W700");
  assert.equal(second.json.recommendations[0].sourceKind, "cache");
  assert.equal(second.json.recommendations[0].discoveredAt, originalDiscoveredAt);
  assert.match(second.json.recommendations[0].reason, /持久候选池/);
  assert.equal(
    listRecommendationCandidates("demo-session-1")
      .find((candidate) => candidate.canonicalId === "openalex:W700")?.discoveryCount,
    1
  );
});

test("accepts document metadata sync snapshots", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      documents: [
        {
          id: "demo-1",
          sourcePath: "/papers/colbert-late-interaction.pdf",
          title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
        },
        {
          id: "demo-2",
          sourcePath: "/papers/survey-vector-database-management-systems.pdf",
          title: "Survey of Vector Database Management Systems"
        },
        {
          id: "demo-3",
          sourcePath: "/papers/acorn-vector-search.pdf",
          title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
        }
      ],
      sessionId: "demo-session-1",
      workspaceRevision: 0
    }),
    url: "/v1/documents/metadata-sync"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    result: {
      acceptedCount: 3,
      rejectedCount: 0,
      syncId: "metadata-demo-session-1-r0",
      syncedAt: "2026-05-14T10:20:00Z"
    }
  });
});


test("returns the demo organization list", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      sessionId: "demo-session-1"
    }),
    url: "/v1/org/list"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    activeOrganizationId: "org-demo-1",
    organizations: [
      {
        canCreateOrganization: true,
        memberCount: 12,
        myRole: "member",
        name: "Liteasy AI Reading Lab",
        organizationId: "org-demo-1",
        ownerUserId: "demo-session-owner",
        sharedLibraryName: "组织共享文献库"
      },
      {
        canCreateOrganization: true,
        memberCount: 4,
        myRole: "member",
        name: "Liteasy Literature Ops",
        organizationId: "org-demo-2",
        ownerUserId: "member-ops-1",
        sharedLibraryName: "文献运营共享库"
      }
    ]
  });
});

test("creates an organization and assigns the creator as owner", async () => {
  const handler = createDevCloudRequestHandler();

  const response = await invokeHandler({
    body: JSON.stringify({
      name: "Liteasy F3 Lab",
      sessionId: "demo-session-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/org/create"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.organization.ownerUserId, "demo-session-1");
  assert.equal(response.json.organization.myRole, "owner");
});

test("joins an organization as member", async () => {
  const handler = createDevCloudRequestHandler();

  const response = await invokeHandler({
    body: JSON.stringify({
      organizationId: "org-demo-1",
      sessionId: "demo-session-joiner"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/org/join"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.membership.role, "member");
});

test("rejects organization invites from members", async () => {
  const handler = createDevCloudRequestHandler();

  const response = await invokeHandler({
    body: JSON.stringify({
      organizationId: "org-demo-1",
      role: "member",
      sessionId: "demo-session-1",
      targetUserId: "demo-invitee-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/org/invite"
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json.error, "organization_role_forbidden");
});

test("allows organization invites from admins", async () => {
  const handler = createDevCloudRequestHandler();

  const response = await invokeHandler({
    body: JSON.stringify({
      organizationId: "org-demo-1",
      role: "admin",
      sessionId: "demo-session-admin",
      targetUserId: "demo-invitee-1"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/org/invite"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.invite.role, "admin");
});

test("blocks owner leave when owner transfer is not available", async () => {
  const handler = createDevCloudRequestHandler();

  const response = await invokeHandler({
    body: JSON.stringify({
      organizationId: "org-demo-1",
      role: "owner",
      sessionId: "demo-session-owner"
    }),
    handler,
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    method: "POST",
    url: "/v1/org/leave"
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json.error, "organization_owner_leave_blocked");
});

test("returns a demo organization summary", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      sessionId: "demo-session-1"
    }),
    url: "/v1/org/summary"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    summary: {
      auditEvents: [
        {
          actor: "Admin",
          description: "更新共享文献库上传权限",
          id: "audit-1",
          occurredAt: "2026-05-14T10:30:00Z"
        }
      ],
      canCreateOrganization: true,
      memberCount: 12,
      members: [
        {
          id: "demo-session-owner",
          name: "Owner",
          role: "owner"
        },
        {
          id: "demo-session-1",
          name: "Liteasy Researcher",
          role: "member"
        },
        {
          id: "member-2",
          name: "Admin",
          role: "admin"
        }
      ],
      myRole: "member",
      name: "Liteasy AI Reading Lab",
      notifications: [
        {
          id: "notice-1",
          message: "管理员发布了本周阅读主题。",
          type: "announcement"
        },
        {
          id: "notice-2",
          message: "成员上传了 Graph Neural Networks 综述。",
          type: "document_upload"
        },
        {
          id: "notice-3",
          message: "共享文献库结构新增 RAG 目录。",
          type: "library_change"
        }
      ],
      organizationId: "org-demo-1",
      ownerUserId: "demo-session-owner",
      quota: {
        periodEndsAt: "2026-06-01T00:00:00Z",
        storageLimitGb: 100,
        storageUsedGb: 38
      },
      sharedLibrary: {
        documentCount: 48,
        documents: [
          {
            id: "org-doc-1",
            sourcePath: "org://org-demo-1/shared-library/org-doc-1.pdf",
            title: "Organization Reading List: Retrieval-Augmented Generation"
          },
          {
            id: "org-doc-2",
            sourcePath: "org://org-demo-1/shared-library/org-doc-2.pdf",
            title: "Team Notes on Long-Context Evaluation"
          }
        ],
        name: "组织共享文献库",
        ownerUserId: "demo-session-owner",
        status: "available"
      },
      taskSummary: {
        failed: 1,
        running: 2
      }
    }
  });
});

test("returns a demo organization shared library manifest", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      organizationId: "org-demo-1",
      sessionId: "demo-session-1"
    }),
    url: "/v1/org/shared-library/manifest"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.manifest.organizationId, "org-demo-1");
  assert.equal(response.json.manifest.name, "组织共享文献库");
  assert.equal(response.json.manifest.status, "available");
  assert.equal(response.json.manifest.rootFolderId, "org-demo-1-root");
  assert.deepEqual(response.json.manifest.folders, [
    {
      id: "org-demo-1-root",
      name: "组织共享文献库",
      parentId: null,
      path: "org://org-demo-1/shared-library"
    },
    {
      id: "org-demo-1-rag",
      name: "RAG",
      parentId: "org-demo-1-root",
      path: "org://org-demo-1/shared-library/RAG"
    },
    {
      id: "org-demo-1-eval",
      name: "Evaluation",
      parentId: "org-demo-1-root",
      path: "org://org-demo-1/shared-library/Evaluation"
    }
  ]);
  assert.deepEqual(response.json.manifest.documents, [
    {
      folderId: "org-demo-1-rag",
      id: "org-doc-1",
      sourcePath: "org://org-demo-1/shared-library/RAG/org-doc-1.pdf",
      title: "Organization Reading List: Retrieval-Augmented Generation"
    },
    {
      folderId: "org-demo-1-eval",
      id: "org-doc-2",
      sourcePath: "org://org-demo-1/shared-library/Evaluation/org-doc-2.pdf",
      title: "Team Notes on Long-Context Evaluation"
    }
  ]);
});


test("returns a demo organization governance summary", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      organizationId: "org-demo-1",
      sessionId: "demo-session-1"
    }),
    url: "/v1/org/governance-summary"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    summary: {
      auditQueue: {
        highRisk: 1,
        pendingReview: 3
      },
      quota: {
        modelCallsLimit: 10000,
        modelCallsUsed: 4200,
        storageLimitGb: 100,
        storageUsedGb: 38
      },
      recentAuditEvents: [
        {
          id: "audit-1",
          label: "Admin 更新共享文献库上传权限",
          risk: "medium"
        }
      ],
      runningTasks: [
        {
          id: "task-1",
          label: "组织共享文献库索引刷新",
          status: "running"
        }
      ]
    }
  });
});


test("returns organization-specific governance summary", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      organizationId: "org-demo-2",
      sessionId: "demo-session-1"
    }),
    url: "/v1/org/governance-summary"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    summary: {
      auditQueue: {
        highRisk: 0,
        pendingReview: 1
      },
      quota: {
        modelCallsLimit: 5000,
        modelCallsUsed: 900,
        storageLimitGb: 50,
        storageUsedGb: 12
      },
      recentAuditEvents: [
        {
          id: "audit-ops-1",
          label: "Ops Admin 新增 QA 目录",
          risk: "low"
        }
      ],
      runningTasks: [
        {
          id: "task-ops-1",
          label: "文献运营共享库目录同步",
          status: "running"
        }
      ]
    }
  });
});

test("returns an audit score from the model audit endpoint", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      answer: "开发云回答：BERT 的核心方法是什么？",
      citations: [
        {
          page: 7,
          paperId: "demo-2",
          snippet: "deep bidirectional representations are pre-trained"
        }
      ],
      model: "gpt-5-mini-auditor",
      provider: "openai",
      question: "BERT 的核心方法是什么？",
      retrievalConfidence: 0.86,
      source: "cloud_proxy"
    }),
    url: "/v1/model/audit"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json, {
    audit: {
      model: "gpt-5-mini-auditor",
      rationale: "开发云审计确认回答包含可追溯引用。",
      score: 0.86,
      verdict: "pass"
    }
  });
});
