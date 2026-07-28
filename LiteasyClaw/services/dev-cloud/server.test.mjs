import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createDevCloudRequestHandler } from "./server.mjs";
import { createDatabase } from "./db/database.mjs";

test.beforeEach(() => {
  process.env.LITEASY_DEV_CLOUD_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "liteasy-dev-cloud-test-")
  );
});

async function invokeHandler({ body, handler, handlerOptions, headers = {}, method, url }) {
  const chunks = body ? [Buffer.from(body)] : [];
  const request = Readable.from(chunks);
  request.headers = headers;
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
    deepseekApiKey: undefined,
    defaultProvider: "openai",
    openaiApiKey: undefined,
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
  assert.equal(response.headers["Access-Control-Allow-Headers"], "Content-Type");
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
    "POST /v1/research/external-knowledge",
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

test("normalizes traceable OpenAlex works for external thin-reading research", async () => {
  let requestedUrl = "";
  const response = await invokeHandler({
    body: JSON.stringify({
      limit: 2,
      query: "ColBERT late interaction retrieval",
      targetPaperTitle: "ColBERT"
    }),
    handlerOptions: {
      openAlexTransport: async (url) => {
        requestedUrl = url;
        return {
          json: async () => ({
            results: [
              {
                abstract_inverted_index: { dense: [1], retrieval: [2], "Multi-vector": [0] },
                authorships: [{ author: { display_name: "Jane Researcher" } }],
                display_name: "Multi-vector dense retrieval after ColBERT",
                doi: "https://doi.org/10.1000/example",
                id: "https://openalex.org/W123456789",
                primary_location: { landing_page_url: "https://example.org/paper" },
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
  assert.match(requestedUrl, /api\.openalex\.org\/works/);
  assert.match(requestedUrl, /search=ColBERT/);
  assert.equal(response.json.status, "available");
  assert.deepEqual(response.json.sources, [
    {
      abstract: "Multi-vector dense retrieval",
      authors: ["Jane Researcher"],
      doi: "https://doi.org/10.1000/example",
      id: "openalex:W123456789",
      provider: "openalex",
      relevance: response.json.sources[0].relevance,
      retrievalQuery: "ColBERT late interaction retrieval",
      sourceId: "W123456789",
      title: "Multi-vector dense retrieval after ColBERT",
      url: "https://example.org/paper",
      year: 2025
    }
  ]);
  assert.ok(response.json.sources[0].relevance > 0);
  assert.ok(response.json.sources[0].relevance <= 1);
});

test("returns an explicit empty external-knowledge result without synthetic sources", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({ query: "a research topic with no OpenAlex result" }),
    handlerOptions: {
      openAlexTransport: async () => ({
        json: async () => ({ results: [] }),
        ok: true,
        status: 200
      })
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.status, "empty");
  assert.deepEqual(response.json.sources, []);
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
