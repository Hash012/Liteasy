import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createDevCloudRequestHandler } from "./server.mjs";
import { createDatabase } from "./db/database.mjs";
import { hashSessionToken } from "./auth/sessionTokens.mjs";
import { hashPassword } from "./auth/passwords.mjs";
import { createAccountRepository } from "./db/accountRepository.mjs";
import { createPlatformAdminRepository } from "./db/platformAdminRepository.mjs";
import {
  createRecommendationCacheRepository,
  getRecommendationCache,
  putRecommendationCache
} from "./db/recommendationCacheRepository.mjs";
import {
  createRecommendationCandidateRepository,
  listRecommendationCandidateSources,
  listRecommendationCandidates,
  setRecommendationCandidateRepository,
  upsertRecommendationCandidates,
  __resetRecommendationCandidateRepository
} from "./db/recommendationCandidateRepository.mjs";
import {
  createRecommendationFeedbackRepository,
  listRecommendationFeedback,
  saveRecommendationFeedback,
  setRecommendationFeedbackRepository,
  __resetRecommendationFeedbackRepository
} from "./db/recommendationFeedbackRepository.mjs";

test.beforeEach(() => {
  process.env.LITEASY_DEV_CLOUD_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "liteasy-dev-cloud-test-")
  );
  __resetRecommendationCandidateRepository();
  __resetRecommendationFeedbackRepository();
});

const authenticatedJsonPaths = new Set([
  "/v1/collection/items",
  "/v1/collection/list",
  "/v1/documents/metadata-sync",
  "/v1/literature:confirm",
  "/v1/literature:resolve",
  "/v1/literature:verify",
  "/v1/org/create",
  "/v1/org/governance-summary",
  "/v1/org/invite",
  "/v1/org/join",
  "/v1/org/leave",
  "/v1/org/list",
  "/v1/org/shared-library/manifest",
  "/v1/org/summary",
  "/v1/personalization/signal",
  "/v1/profile/clear",
  "/v1/profile/get",
  "/v1/profile/save",
  "/v1/recommendation-cache/clear",
  "/v1/recommendation-cache/get",
  "/v1/recommendation-cache/put",
  "/v1/recommendations",
  "/v1/recommendations/feedback",
  "/v1/recommendations/pdf-grant",
  "/v1/research/external-knowledge",
  "/v1/research/paper-relations",
  "/v1/research/external-pdf",
  "/v1/works/resolve"
]);

function isTestSessionAlias(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.startsWith("ltsy_") &&
    !value.startsWith("user:")
  );
}

const testOwnerKey = (alias) => `user:${alias}`;

function ensureTestSession(alias = "test-session-1") {
  const token = `ltsy_${createHash("sha256").update(alias).digest("base64url")}`;
  const database = createDatabase();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  database.prepare(`
    INSERT OR IGNORE INTO users (
      id, email, display_name, membership_tier, status, created_at, updated_at
    ) VALUES (?, ?, ?, 'pro', 'active', ?, ?)
  `).run(alias, `${alias}@test.liteasy.invalid`, alias, now, now);
  database.prepare(`
    INSERT OR IGNORE INTO auth_sessions (
      id, user_id, token_hash, created_at, expires_at, last_seen_at, client_label,
      audience, mfa_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'server.test.mjs', 'liteasy-desktop', NULL)
  `).run(`session-${alias}`, alias, hashSessionToken(token), now, expiresAt, now);
  database.close();
  return token;
}

function authenticatedTestRequest({ body, headers, method, url }) {
  const nextHeaders = { ...headers };
  const bearerAlias = typeof nextHeaders.authorization === "string" &&
    nextHeaders.authorization.startsWith("Bearer ")
    ? nextHeaders.authorization.slice("Bearer ".length).trim()
    : "";
  if (isTestSessionAlias(bearerAlias)) {
    nextHeaders.authorization = `Bearer ${ensureTestSession(bearerAlias)}`;
  }
  if (isTestSessionAlias(nextHeaders["x-liteasy-session-id"])) {
    nextHeaders["x-liteasy-session-id"] = ensureTestSession(nextHeaders["x-liteasy-session-id"]);
  }
  if (
    method !== "POST" ||
    typeof body !== "string"
  ) {
    return { body, headers: nextHeaders };
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { body, headers: nextHeaders };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { body, headers: nextHeaders };
  }
  if (isTestSessionAlias(parsed.sessionId)) {
    parsed.sessionId = ensureTestSession(parsed.sessionId);
  } else if (!("sessionId" in parsed) && authenticatedJsonPaths.has(new URL(url, "http://localhost").pathname)) {
    parsed.sessionId = ensureTestSession();
  }
  return { body: JSON.stringify(parsed), headers: nextHeaders };
}

async function invokeHandler({ body, handler, handlerOptions, headers = {}, method, url }) {
  const authenticated = authenticatedTestRequest({ body, headers, method, url });
  const chunks = authenticated.body ? [Buffer.from(authenticated.body)] : [];
  const request = Readable.from(chunks);
  request.headers = authenticated.headers;
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
    expandedSourcesEnabled: false,
    openAlexApiKey: "test-openalex-api-key",
    openaiApiKey: undefined,
    recommendationMode: "live",
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

async function enablePersonalization(handler, sessionId = "test-session-1") {
  const response = await invokeHandler({
    body: JSON.stringify({ enabled: true, sessionId }),
    handler,
    headers: { "content-type": "application/json", host: "127.0.0.1:8787" },
    method: "POST",
    url: "/v1/personalization/settings/update"
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.enabled, true);
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
  assert.equal(response.headers["Access-Control-Allow-Methods"], "DELETE,GET,PATCH,POST,OPTIONS");
  assert.match(response.headers["Access-Control-Allow-Headers"], /^Authorization, Content-Type,/);
  assert.match(response.headers["Access-Control-Allow-Headers"], /X-Liteasy-Session-Id/);
});

test("allows CORS preflight from packaged and legacy Tauri desktop origins", async () => {
  for (const origin of ["http://tauri.localhost", "tauri://localhost"]) {
    const response = await invokeHandler({
      method: "OPTIONS",
      headers: {
        "access-control-request-headers": "content-type",
        "access-control-request-method": "POST",
        origin
      },
      url: "/v1/research/external-knowledge"
    });

    assert.equal(response.statusCode, 204);
    assert.equal(response.headers["Access-Control-Allow-Origin"], origin);
  }
});

test("derives page-wide verified paper relations behind the account security boundary", async () => {
  let receivedPapers;
  const response = await invokeHandler({
    body: JSON.stringify({
      artifactId: "artifact-page-relations",
      papers: [
        { id: "paper-a", provider: "openalex", sourceId: "W1" },
        { id: "paper-b", provider: "openalex", sourceId: "W2" }
      ]
    }),
    handlerOptions: {
      fetchPaperGraphRecords: async (papers) => {
        receivedPapers = papers;
        return [
          {
            evidenceRecordUrl: "https://openalex.org/W1",
            id: "openalex:W1",
            provider: "openalex",
            referencedPaperIds: ["openalex:W2"]
          },
          {
            evidenceRecordUrl: "https://openalex.org/W2",
            id: "openalex:W2",
            provider: "openalex",
            referencedPaperIds: []
          }
        ];
      }
    },
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/paper-relations"
  });

  assert.equal(response.statusCode, 200, JSON.stringify(response.json));
  assert.equal(receivedPapers.length, 2);
  assert.deepEqual(response.json, {
    edges: [{
      directed: true,
      evidenceRecordUrls: ["https://openalex.org/W1"],
      kind: "direct_citation",
      provider: "openalex",
      sourcePaperId: "paper-a",
      strength: 1,
      targetPaperId: "paper-b"
    }],
    warnings: []
  });
});

test("rejects anonymous and over-limit paper relation requests before provider retrieval", async () => {
  let calls = 0;
  const handler = createDevCloudRequestHandler({
    fetchPaperGraphRecords: async () => {
      calls += 1;
      return [];
    }
  });
  const anonymous = await invokeHandler({
    body: JSON.stringify({
      artifactId: "artifact-anonymous-relations",
      papers: [{ id: "paper-a", provider: "openalex", sourceId: "W1" }],
      sessionId: "ltsy_invalid"
    }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/paper-relations"
  });
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json.code, "invalid_session");

  const overLimit = await invokeHandler({
    body: JSON.stringify({
      artifactId: "artifact-over-limit-relations",
      papers: Array.from({ length: 25 }, (_, index) => ({
        id: `paper-${index}`,
        provider: "openalex",
        sourceId: `W${index}`
      }))
    }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/paper-relations"
  });
  assert.equal(overLimit.statusCode, 400);
  assert.equal(overLimit.json.code, "paper_relation_paper_limit_exceeded");
  assert.equal(calls, 0);
});

test("streams library PDFs through private staging and applies the security scanner", async () => {
  const objectDirectory = path.join(process.env.LITEASY_DEV_CLOUD_DATA_DIR, "streamed-objects");
  let scanned;
  const response = await invokeHandler({
    body: Buffer.from("%PDF-1.7\nStreamed library body\n%%EOF"),
    handlerOptions: {
      libraryStorageObjectDirectory: objectDirectory,
      scanLibraryPdf: async (input) => {
        scanned = input;
        assert.equal(fs.readFileSync(input.stagedPath, "utf8").startsWith("%PDF-"), true);
        return { clean: true };
      }
    },
    headers: {
      "content-type": "application/pdf",
      "x-idempotency-key": "streamed-upload-1",
      "x-liteasy-expected-revision": "0",
      "x-liteasy-file-name": encodeURIComponent("Streamed.pdf"),
      "x-liteasy-scope-id": "user:stream-upload-user",
      "x-liteasy-scope-type": "user",
      "x-liteasy-session-id": "stream-upload-user"
    },
    method: "POST",
    url: "/v1/library/documents/upload"
  });

  assert.equal(response.statusCode, 200, JSON.stringify(response.json));
  assert.equal(scanned.mediaType, "application/pdf");
  assert.equal(scanned.byteLength, Buffer.byteLength("%PDF-1.7\nStreamed library body\n%%EOF"));
  assert.match(scanned.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(fs.readdirSync(path.join(objectDirectory, ".staging")), []);
});

test("rejects a reused upload idempotency key when PDF content changes", async () => {
  const handler = createDevCloudRequestHandler();
  const sessionId = "changed-upload-user";
  const scopeId = `user:${sessionId}`;
  const headers = {
    "content-type": "application/pdf",
    "x-idempotency-key": "changed-upload-content-1",
    "x-liteasy-expected-revision": "0",
    "x-liteasy-file-name": encodeURIComponent("Changed upload.pdf"),
    "x-liteasy-scope-id": scopeId,
    "x-liteasy-scope-type": "user",
    "x-liteasy-session-id": sessionId
  };
  const first = await invokeHandler({
    body: Buffer.from("%PDF-1.7\nFirst upload body\n%%EOF"),
    handler,
    headers,
    method: "POST",
    url: "/v1/library/documents/upload"
  });
  const conflictingReplay = await invokeHandler({
    body: Buffer.from("%PDF-1.7\nChanged upload body\n%%EOF"),
    handler,
    headers,
    method: "POST",
    url: "/v1/library/documents/upload"
  });

  assert.equal(first.statusCode, 200, JSON.stringify(first.json));
  assert.equal(conflictingReplay.statusCode, 409, JSON.stringify(conflictingReplay.json));
  assert.equal(conflictingReplay.json.code, "idempotency_key_reused");

  const tree = await invokeHandler({
    body: JSON.stringify({ scopeId, scopeType: "user", sessionId }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/tree"
  });
  assert.equal(tree.statusCode, 200, JSON.stringify(tree.json));
  assert.equal(tree.json.tree.entries.length, 1);
  assert.equal(tree.json.tree.entries[0].contentHash, first.json.document.contentHash);
  assert.equal(tree.json.tree.revision, 1);
});

test("rejects a reused attachment idempotency key when PDF content changes", async () => {
  const handler = createDevCloudRequestHandler();
  const sessionId = "changed-attachment-user";
  const scopeId = `user:${sessionId}`;
  const created = await invokeHandler({
    body: JSON.stringify({
      expectedRevision: 0,
      idempotencyKey: "changed-attachment-metadata-1",
      scopeId,
      scopeType: "user",
      sessionId,
      title: "Attachment target"
    }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/entries/metadata"
  });
  assert.equal(created.statusCode, 200, JSON.stringify(created.json));

  const headers = {
    "content-type": "application/pdf",
    "x-idempotency-key": "changed-attachment-content-1",
    "x-liteasy-document-id": created.json.entry.documentId,
    "x-liteasy-expected-revision": String(created.json.revision),
    "x-liteasy-file-name": encodeURIComponent("Attachment target.pdf"),
    "x-liteasy-scope-id": scopeId,
    "x-liteasy-scope-type": "user",
    "x-liteasy-session-id": sessionId
  };
  const first = await invokeHandler({
    body: Buffer.from("%PDF-1.7\nFirst attachment body\n%%EOF"),
    handler,
    headers,
    method: "POST",
    url: "/v1/library/entries/attach-pdf"
  });
  const conflictingReplay = await invokeHandler({
    body: Buffer.from("%PDF-1.7\nChanged attachment body\n%%EOF"),
    handler,
    headers,
    method: "POST",
    url: "/v1/library/entries/attach-pdf"
  });

  assert.equal(first.statusCode, 200, JSON.stringify(first.json));
  assert.equal(conflictingReplay.statusCode, 409, JSON.stringify(conflictingReplay.json));
  assert.equal(conflictingReplay.json.code, "idempotency_key_reused");

  const tree = await invokeHandler({
    body: JSON.stringify({ scopeId, scopeType: "user", sessionId }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/tree"
  });
  assert.equal(tree.statusCode, 200, JSON.stringify(tree.json));
  assert.equal(tree.json.tree.entries.length, 1);
  assert.equal(tree.json.tree.entries[0].contentHash, first.json.entry.contentHash);
  assert.equal(tree.json.tree.revision, 2);
});

test("rejects unsafe PDF markers before committing a library object", async () => {
  const objectDirectory = path.join(process.env.LITEASY_DEV_CLOUD_DATA_DIR, "unsafe-objects");
  const response = await invokeHandler({
    body: Buffer.from("%PDF-1.7\n1 0 obj << /JavaScript 2 0 R >>\n%%EOF"),
    handlerOptions: { libraryStorageObjectDirectory: objectDirectory },
    headers: {
      "content-type": "application/pdf",
      "x-idempotency-key": "unsafe-upload-1",
      "x-liteasy-expected-revision": "0",
      "x-liteasy-file-name": encodeURIComponent("Unsafe.pdf"),
      "x-liteasy-scope-id": "user:unsafe-upload-user",
      "x-liteasy-scope-type": "user",
      "x-liteasy-session-id": "unsafe-upload-user"
    },
    method: "POST",
    url: "/v1/library/documents/upload"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.code, "unsafe_pdf_content");
  assert.deepEqual(fs.readdirSync(path.join(objectDirectory, ".staging")), []);
});

test("renames a metadata-only library entry through the versioned mutation API", async () => {
  const handler = createDevCloudRequestHandler();
  const sessionId = "metadata-route-user";
  const scope = { scopeId: "user:metadata-route-user", scopeType: "user", sessionId };
  const created = await invokeHandler({
    body: JSON.stringify({
      ...scope,
      expectedRevision: 0,
      idempotencyKey: "metadata-create-1",
      title: "Before rename"
    }),
    handler,
    headers: {
      authorization: `Bearer ${sessionId}`,
      "content-type": "application/json"
    },
    method: "POST",
    url: "/v1/library/entries/metadata"
  });
  assert.equal(created.statusCode, 200, JSON.stringify(created.json));

  const updated = await invokeHandler({
    body: JSON.stringify({
      ...scope,
      documentId: created.json.entry.documentId,
      expectedRevision: created.json.revision,
      idempotencyKey: "metadata-rename-1",
      title: "After rename"
    }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/documents/update"
  });

  assert.equal(updated.statusCode, 200, JSON.stringify(updated.json));
  assert.equal(updated.json.document.entryKind, "metadata_only");
  assert.equal(updated.json.document.title, "After rename");
  assert.ok(updated.json.revision > created.json.revision);
});

test("replays a normalized library request across authentication and key transports", async () => {
  const handler = createDevCloudRequestHandler();
  const sessionId = "normalized-mutation-user";
  const requestBody = {
    expectedRevision: 0,
    name: "Research",
    scopeId: `user:${sessionId}`,
    scopeType: "user"
  };
  const first = await invokeHandler({
    body: JSON.stringify({
      ...requestBody,
      idempotencyKey: "folder-normalized-1",
      sessionId
    }),
    handler,
    headers: {
      authorization: `Bearer ${sessionId}`,
      "content-type": "application/json"
    },
    method: "POST",
    url: "/v1/library/folders/create"
  });
  const replay = await invokeHandler({
    body: JSON.stringify(requestBody),
    handler,
    headers: {
      authorization: `Bearer ${sessionId}`,
      "content-type": "application/json",
      "x-idempotency-key": "folder-normalized-1"
    },
    method: "POST",
    url: "/v1/library/folders/create"
  });

  assert.equal(first.statusCode, 200, JSON.stringify(first.json));
  assert.equal(first.json.replayed, false);
  assert.equal(replay.statusCode, 200, JSON.stringify(replay.json));
  assert.equal(replay.json.replayed, true);
  assert.equal(replay.json.folder.folderId, first.json.folder.folderId);
  assert.equal(replay.json.revision, first.json.revision);
});

for (const [label, expectedRevision] of [
  ["boolean", false],
  ["array", []],
  ["whitespace string", " "],
  ["noncanonical decimal string", "00"]
]) {
  test(`rejects ${label} library revisions at the HTTP boundary`, async () => {
    const sessionId = `invalid-revision-${label.replaceAll(" ", "-")}`;
    const response = await invokeHandler({
      body: JSON.stringify({
        expectedRevision,
        idempotencyKey: `invalid-revision-${label.replaceAll(" ", "-")}-1`,
        name: "Must not be created",
        scopeId: `user:${sessionId}`,
        scopeType: "user",
        sessionId
      }),
      handler: createDevCloudRequestHandler(),
      headers: { "content-type": "application/json" },
      method: "POST",
      url: "/v1/library/folders/create"
    });

    assert.equal(response.statusCode, 400, JSON.stringify(response.json));
    assert.equal(response.json.code, "invalid_library_revision");
  });
}

test("persists literature through an idempotent library metadata update", async () => {
  const verifiedReferences = [];
  const literature = {
    authors: ["Ada Lovelace"],
    identifiers: [{ kind: "doi", role: "confirmable", source: "public_registry", value: "10.1000/liteasy" }],
    literatureId: "literature_confirmed_liteasy",
    provenance: {
      confirmedAt: "2026-08-09T00:00:00.000Z",
      mode: "public_registry",
      provider: "crossref"
    },
    revision: 1,
    status: "confirmed",
    title: "Cloud Literature Metadata",
    year: 2026
  };
  const handler = createDevCloudRequestHandler({
    literatureProjectionVerifier: {
      async verifyProjection(reference) {
        verifiedReferences.push(reference);
        return {
          ...literature,
          revision: reference.revision,
          title: reference.revision === 1 ? literature.title : "Different literature"
        };
      }
    }
  });
  const sessionId = "literature-route-user";
  const scope = { scopeId: `user:${sessionId}`, scopeType: "user", sessionId };
  const created = await invokeHandler({
    body: JSON.stringify({
      ...scope,
      expectedRevision: 0,
      idempotencyKey: "literature-create-1",
      title: "Cloud Literature Metadata"
    }),
    handler,
    headers: { authorization: `Bearer ${sessionId}`, "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/entries/metadata"
  });
  const updateBody = {
    ...scope,
    documentId: created.json.entry.documentId,
    expectedRevision: created.json.revision,
    idempotencyKey: "literature-update-1",
    literature: {
      literatureId: literature.literatureId,
      revision: literature.revision,
      title: "Client-forged title"
    }
  };

  const updated = await invokeHandler({
    body: JSON.stringify(updateBody),
    handler,
    headers: { authorization: `Bearer ${sessionId}`, "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/documents/update"
  });
  const replay = await invokeHandler({
    body: JSON.stringify(updateBody),
    handler,
    headers: { authorization: `Bearer ${sessionId}`, "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/documents/update"
  });

  assert.equal(updated.statusCode, 200, JSON.stringify(updated.json));
  assert.deepEqual(updated.json.document.metadata.literature, literature);
  assert.equal(replay.statusCode, 200, JSON.stringify(replay.json));
  assert.equal(replay.json.replayed, true);
  assert.equal(replay.json.revision, updated.json.revision);
  const conflictingReplay = await invokeHandler({
    body: JSON.stringify({
      ...updateBody,
      literature: { literatureId: literature.literatureId, revision: 2 }
    }),
    handler,
    headers: { authorization: `Bearer ${sessionId}`, "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/documents/update"
  });
  assert.equal(conflictingReplay.statusCode, 409);
  assert.equal(conflictingReplay.json.code, "idempotency_key_reused");
  assert.equal(conflictingReplay.json.revision, undefined);
  assert.deepEqual(verifiedReferences, [
    { literatureId: literature.literatureId, revision: 1 },
    { literatureId: literature.literatureId, revision: 1 },
    { literatureId: literature.literatureId, revision: 2 }
  ]);
});

test("proxies private literature identity without forwarding the local account session", async () => {
  const calls = [];
  const authority = {
    async confirm(input) {
      calls.push({ confirm: input });
      return { literature: { literatureId: "literature-private", revision: 1, status: "confirmed" } };
    },
    async relations(literatureId) {
      calls.push({ relations: literatureId });
      return { literatureId, versions: [] };
    },
    async resolve(input) {
      calls.push({ resolve: input });
      return { candidates: [], status: "not_found", unavailableProviders: [] };
    },
    async verifyProjection(input) {
      calls.push({ verify: input });
      return { literatureId: input.literatureId, revision: input.revision, status: "confirmed" };
    }
  };
  const handler = createDevCloudRequestHandler({ literatureProjectionVerifier: authority });
  const headers = { authorization: "Bearer literature-private-user", "content-type": "application/json" };

  for (const [method, url, body] of [
    ["POST", "/v1/literature:resolve", { purpose: "liteasy_pdf_annotation", query: "Private paper" }],
    ["POST", "/v1/literature:confirm", { candidateKey: "crossref:doi:10.1000/private", mode: "candidate" }],
    ["POST", "/v1/literature:verify", { literatureId: "literature-private", revision: 1 }],
    ["GET", "/v1/literature/literature-private/relations", undefined]
  ]) {
    const result = await invokeHandler({
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      handler,
      headers,
      method,
      url
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.json));
  }

  assert.equal(calls.length, 4);
  assert.equal(JSON.stringify(calls).includes("sessionId"), false);
  assert.equal(JSON.stringify(calls).includes("literature-private-user"), false);
});

test("fails closed when literature projection verification is unavailable", async () => {
  const handler = createDevCloudRequestHandler({ intuechoLiteratureProjection: {} });
  const sessionId = "literature-verifier-unavailable";
  const scope = { scopeId: `user:${sessionId}`, scopeType: "user", sessionId };
  const created = await invokeHandler({
    body: JSON.stringify({
      ...scope,
      expectedRevision: 0,
      idempotencyKey: "literature-unavailable-create",
      title: "Unverified projection"
    }),
    handler,
    headers: { authorization: `Bearer ${sessionId}`, "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/entries/metadata"
  });

  const response = await invokeHandler({
    body: JSON.stringify({
      ...scope,
      documentId: created.json.entry.documentId,
      expectedRevision: created.json.revision,
      idempotencyKey: "literature-unavailable-update",
      literature: { literatureId: "literature_confirmed", revision: 1 }
    }),
    handler,
    headers: { authorization: `Bearer ${sessionId}`, "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/documents/update"
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json.code, "literature_projection_verifier_unavailable");
  assert.equal(response.json.revision, undefined);
});

test("fails closed when an organization member attempts a literature update", async () => {
  const alias = "literature-member";
  const token = ensureTestSession(alias);
  const actorId = `user:${alias}`;
  const database = createDatabase();
  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO organizations(
      organization_id, name, normalized_name, owner_key, shared_library_name,
      status, created_at, updated_at
    ) VALUES (?, 'Literature Org', 'literature org', 'user:owner', 'Library', 'active', ?, ?)
  `).run("organization-literature", timestamp, timestamp);
  database.prepare(`
    INSERT INTO organization_members(
      organization_id, owner_key, display_name, role, status, created_at, updated_at
    ) VALUES (?, ?, 'Member', 'member', 'active', ?, ?)
  `).run("organization-literature", actorId, timestamp, timestamp);
  database.close();
  const handler = createDevCloudRequestHandler();

  const response = await invokeHandler({
    body: JSON.stringify({
      documentId: "document-missing",
      expectedRevision: 0,
      idempotencyKey: "literature-org-member-1",
      literature: { literatureId: "literature_confirmed_liteasy", revision: 1 },
      scopeId: "organization-literature",
      scopeType: "organization"
    }),
    handler,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
    url: "/v1/library/documents/update"
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json.code, "organization_library_manage_forbidden");
});

test("never accepts a browser-owned OpenAlex key at the cloud boundary", async () => {
  let requestedUrl = "";
  const response = await invokeHandler({
    body: JSON.stringify({ artifactId: "artifact-user-openalex-key", query: "anchor retrieval" }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: false,
      openAlexApiKey: "service-fallback-key",
      openAlexTransport: async (url) => {
        requestedUrl = String(url);
        return { json: async () => ({ results: [] }), ok: true, status: 200 };
      }
    }),
    headers: {
      "content-type": "application/json",
      "x-openalex-api-key": "user-owned-key"
    },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200, JSON.stringify(response.json));
  assert.equal(new URL(requestedUrl).searchParams.get("api_key"), "service-fallback-key");
});

test("lets the desktop exclude server-side OpenAlex while retaining cached public providers", async () => {
  let openAlexCalls = 0;
  const response = await invokeHandler({
    body: JSON.stringify({
      artifactId: "artifact-client-direct-openalex",
      includeOpenAlex: false,
      query: "anchor retrieval"
    }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: true,
      crossrefTransport: async () => ({
        json: async () => ({ message: { items: [] } }),
        ok: true,
        status: 200
      }),
      openAlexApiKey: "service-fallback-key",
      openAlexTransport: async () => {
        openAlexCalls += 1;
        return { json: async () => ({ results: [] }), ok: true, status: 200 };
      }
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200, JSON.stringify(response.json));
  assert.equal(openAlexCalls, 0);
});

test("parses a PDF with GROBID once and reuses only the fingerprinted TEI", async () => {
  let grobidCalls = 0;
  const handler = createDevCloudRequestHandler({
    grobidTransport: async (_url, options) => {
      grobidCalls += 1;
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("consolidateCitations"), "1");
      assert.deepEqual(options.body.getAll("teiCoordinates"), ["ref", "biblStruct", "note"]);
      return {
        ok: true,
        status: 200,
        text: async () => "<TEI><text><body><p>Parsed structure</p></body></text></TEI>"
      };
    }
  });
  const request = {
    body: Buffer.from("%PDF-1.7\nfixture body"),
    handler,
    headers: { "content-type": "application/pdf" },
    method: "POST",
    url: "/v1/research/parse-pdf"
  };

  const first = await invokeHandler(request);
  const second = await invokeHandler(request);

  assert.equal(first.statusCode, 200, JSON.stringify(first.json));
  assert.equal(first.json.parser, "grobid");
  assert.equal(first.json.reused, false);
  assert.match(first.json.contentFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(second.statusCode, 200, JSON.stringify(second.json));
  assert.equal(second.json.reused, true);
  assert.equal(second.json.contentFingerprint, first.json.contentFingerprint);
  assert.equal(grobidCalls, 1);
});

test("rejects a non-PDF before contacting GROBID", async () => {
  let grobidCalls = 0;
  const response = await invokeHandler({
    body: Buffer.from("not a pdf"),
    handler: createDevCloudRequestHandler({
      grobidTransport: async () => {
        grobidCalls += 1;
        throw new Error("should not run");
      }
    }),
    headers: { "content-type": "application/pdf" },
    method: "POST",
    url: "/v1/research/parse-pdf"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.code, "invalid_pdf");
  assert.equal(grobidCalls, 0);
});

test("accepts a bounded local PDF for MinerU extraction", async (context) => {
  let extractionCalls = 0;
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-mineru-route-"));
  context.after(() => fs.rmSync(cacheDirectory, { force: true, recursive: true }));
  const response = await invokeHandler({
    body: JSON.stringify({
      bytesBase64: Buffer.from("%PDF-1.7\nmineru fixture").toString("base64"),
      filename: "paper.pdf"
    }),
    handler: createDevCloudRequestHandler({
      extractPdfWithMineru: async ({ bytes, filename }) => {
        extractionCalls += 1;
        assert.equal(bytes.toString("ascii"), "%PDF-1.7\nmineru fixture");
        assert.equal(filename, "paper.pdf");
        return {
          figureAnalysis: { status: "skipped" },
          figures: [],
          markdown: "# Parsed paper",
          pages: [{ page: 1, text: "Parsed paper", textExtraction: "mineru" }]
        };
      },
      mineruExtractionCacheDirectory: cacheDirectory
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/pdf/mineru-extract"
  });

  assert.equal(response.statusCode, 200, JSON.stringify(response.json));
  assert.equal(response.json.cache, "miss");
  assert.equal(response.json.markdown, "# Parsed paper");
  assert.equal(extractionCalls, 1);
});

test("does not expose MinerU exception details in an ordinary response", async (context) => {
  const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-mineru-error-"));
  context.after(() => fs.rmSync(cacheDirectory, { force: true, recursive: true }));
  context.mock.method(console, "error", () => {});
  const response = await invokeHandler({
    body: JSON.stringify({
      bytesBase64: Buffer.from("%PDF-1.7\nmineru failure").toString("base64"),
      filename: "paper.pdf"
    }),
    handler: createDevCloudRequestHandler({
      extractPdfWithMineru: async () => {
        throw new Error("scanner key sk-secret at /srv/private/parser.sql");
      },
      mineruExtractionCacheDirectory: cacheDirectory
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/pdf/mineru-extract"
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.json.code, "mineru_extraction_failed");
  assert.equal(response.json.message, "PDF 解析服务暂时不可用，请稍后重试。");
  assert.match(response.json.traceId, /^trace_/);
  assert.doesNotMatch(JSON.stringify(response.json), /sk-secret|\/srv\/private|parser\.sql/);
});

test("reports unavailable only when the unified retrieval service has no enabled source", async () => {
  let calls = 0;
  const response = await invokeHandler({
    body: JSON.stringify({ artifactId: "artifact-openalex-key-required", query: "ColBERT" }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: false,
      openAlexEnabled: false,
      openAlexApiKey: undefined,
      openAlexTransport: async () => {
        calls += 1;
        return { json: async () => ({ results: [] }), ok: true, status: 200 };
      }
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json.code, "external_knowledge_unavailable");
  assert.match(response.json.message, /统一联网服务/);
  assert.equal(calls, 0);
});

test("uses traceable Crossref topic results when OpenAlex is not configured", async () => {
  let openAlexCalls = 0;
  const response = await invokeHandler({
    body: JSON.stringify({ artifactId: "artifact-crossref-without-openalex", query: "ColBERT retrieval" }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: true,
      openAlexEnabled: false,
      openAlexApiKey: undefined,
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
    headers: { "content-type": "application/json" },
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
    fullTextGrantId: response.json.sources[0].fullTextGrantId,
    fullTextUrl: "https://example.org/crossref-only.pdf",
    id: "crossref:10.1000/crossref-only",
    openAccessAvailable: true,
    provider: "crossref",
    confidence: 0.3,
    confidenceBasis: "algorithmic_retrieval",
    relation: "topic_search",
    relevance: response.json.sources[0].relevance,
    retrievalQuery: "ColBERT retrieval",
    sourceRecordUrl: "https://api.crossref.org/works/10.1000%2Fcrossref-only",
    sourceId: "10.1000/crossref-only",
    title: "ColBERT retrieval replication",
    url: "https://doi.org/10.1000/crossref-only"
  });
  assert.match(response.json.sources[0].fullTextGrantId, /^pdfgrant_[A-Za-z0-9-]+$/);
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
      crossrefEnabled: false,
      openAlexEnabled: false,
      openAlexApiKey: undefined
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

test("returns only a server-granted validated external PDF with content-addressed provenance", async () => {
  const handler = createDevCloudRequestHandler({
    crossrefEnabled: true,
    expandedSourcesEnabled: false,
    openAlexEnabled: false,
    openAlexApiKey: undefined,
    crossrefTransport: async () => ({
      json: async () => ({
        message: {
          items: [{
            DOI: "10.1000/granted-pdf",
            abstract: "A server-granted PDF candidate.",
            link: [{
              "content-type": "application/pdf",
              URL: "https://papers.example.test/paper.pdf"
            }],
            title: ["Server granted PDF candidate"]
          }]
        }
      }),
      ok: true,
      status: 200
    }),
      externalPdfResolver: async () => [{ address: "93.184.216.34", family: 4 }],
      externalPdfTransport: async () => new Response(Buffer.from("%PDF-1.7\nverified"), {
        headers: { "content-type": "application/pdf" },
        status: 200
      })
  });
  const recommendation = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-1", title: "Server granted PDF" }],
      sessionId: "pdf-owner"
    }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/recommendations"
  });
  assert.equal(recommendation.statusCode, 200, JSON.stringify(recommendation.json));
  assert.equal(recommendation.json.recommendations.length, 1);
  assert.equal(recommendation.json.recommendations[0].openAccessAvailable, true);
  assert.equal("fullTextUrl" in recommendation.json.recommendations[0], false);

  const candidateId = recommendation.json.recommendations[0].id;
  const granted = await invokeHandler({
    body: JSON.stringify({ candidateId, sessionId: "pdf-owner" }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/recommendations/pdf-grant"
  });
  assert.equal(granted.statusCode, 200, JSON.stringify(granted.json));
  assert.equal(granted.json.sourceId, candidateId);
  assert.equal(granted.json.fullTextUrl, "https://papers.example.test/paper.pdf");

  const response = await invokeHandler({
    body: JSON.stringify({
      grantId: granted.json.fullTextGrantId,
      sessionId: "pdf-owner",
      sourceId: candidateId
    }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-pdf"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.sourceId, candidateId);
  assert.equal(response.json.finalUrl, "https://papers.example.test/paper.pdf");
  assert.equal(response.json.byteLength, 17);
  assert.equal(response.json.contentHash.length, 64);
  assert.equal(Buffer.from(response.json.bytesBase64, "base64").toString("ascii"), "%PDF-1.7\nverified");
});

test("rejects client PDF URLs and grants owned by another account", async () => {
  const handler = createDevCloudRequestHandler();
  const injected = await invokeHandler({
    body: JSON.stringify({
      sessionId: "alice",
      sourceId: "crossref:10.1000/injected",
      url: "https://papers.example.test/injected.pdf"
    }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-pdf"
  });
  assert.equal(injected.statusCode, 400);
  assert.equal(injected.json.code, "invalid_external_pdf_request");

  const aliceDatabase = createDatabase();
  const grantId = `pdfgrant_${randomUUID()}`;
  const now = new Date();
  aliceDatabase.prepare(`
    INSERT INTO external_pdf_grants(
      grant_id, owner_key, source_id, source_url, created_at, expires_at
    ) VALUES (?, 'user:alice', 'source-1', 'https://papers.example.test/paper.pdf', ?, ?)
  `).run(grantId, now.toISOString(), new Date(now.getTime() + 60_000).toISOString());
  aliceDatabase.close();
  const foreign = await invokeHandler({
    body: JSON.stringify({ grantId, sessionId: "bob", sourceId: "source-1" }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-pdf"
  });
  assert.equal(foreign.statusCode, 404);
  assert.equal(foreign.json.code, "external_pdf_grant_not_found");
});

test("returns a stable not-found response when a recommendation has no PDF", async () => {
  const handler = createDevCloudRequestHandler({
    crossrefEnabled: true,
    expandedSourcesEnabled: false,
    openAlexEnabled: false,
    openAlexApiKey: undefined,
    crossrefTransport: async () => ({
      json: async () => ({
        message: { items: [{ DOI: "10.1000/metadata-only", title: ["Metadata only candidate"] }] }
      }),
      ok: true,
      status: 200
    })
  });
  const recommendation = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-1", title: "Metadata only" }],
      sessionId: "metadata-owner"
    }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/recommendations"
  });
  assert.equal(recommendation.statusCode, 200, JSON.stringify(recommendation.json));
  assert.equal(recommendation.json.recommendations.length, 1);
  const response = await invokeHandler({
    body: JSON.stringify({
      candidateId: recommendation.json.recommendations[0].id,
      sessionId: "metadata-owner"
    }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/recommendations/pdf-grant"
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json.code, "recommendation_pdf_unavailable");
});

test("continues with verified fallback sources when the service's graph connector is unavailable", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({ artifactId: "artifact-openalex-key-invalid", query: "ColBERT" }),
    handler: createDevCloudRequestHandler({
      crossrefEnabled: true,
      crossrefTransport: async () => ({
        json: async () => ({
          message: {
            items: [{
              abstract: "<jats:p>ColBERT remains a verified fallback source.</jats:p>",
              DOI: "10.1000/crossref-fallback",
              title: ["ColBERT fallback source"]
            }]
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
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.sources.length, 1);
  assert.equal(response.json.sources[0].id, "crossref:10.1000/crossref-fallback");
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
  assert.ok(response.json.endpoints.includes("POST /v1/library/tree"));
  assert.ok(response.json.endpoints.includes("POST /v1/library/entries/metadata"));
  assert.ok(response.json.endpoints.includes("POST /v1/personalization/settings/update"));
  assert.equal(response.json.endpoints.some((endpoint) => endpoint.includes("demo")), false);
  assert.equal(response.json.endpoints.includes("GET /v1/local-library/pdf"), false);
});

test("persists profile signals and clears every account personalization artifact", async () => {
  const handler = createDevCloudRequestHandler();
  const sessionId = "test-session-1";
  const ownerKey = testOwnerKey(sessionId);
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

  await enablePersonalization(handler, sessionId);
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
    sessionId: ownerKey,
    sortMode: "relevance",
    workspaceKey: "workspace-1"
  }, [{ id: "cached-rec" }]);
  saveRecommendationFeedback(ownerKey, {
    action: "saved",
    candidateId: "candidate-1",
    source: "OpenAlex",
    title: "Cached paper"
  });
  upsertRecommendationCandidates(ownerKey, [{
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
  assert.deepEqual(listRecommendationFeedback(ownerKey), []);
  assert.deepEqual(listRecommendationCandidates(ownerKey), []);
  assert.equal(getRecommendationCache({
    personalizationVersion: signalResponse.json.personalizationVersion,
    selectionKey: "selection-1",
    sessionId: ownerKey,
    sortMode: "relevance",
    workspaceKey: "workspace-1"
  }).cacheHit, false);

  const database = createDatabase();
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM academic_profiles WHERE owner_key = ?")
    .get(ownerKey).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM personalization_terms WHERE owner_key = ?")
    .get(ownerKey).count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM recommendation_suppressions WHERE owner_key = ?")
    .get(ownerKey).count, 0);
  database.close();
});

test("requires an explicit settings update before collecting personalization signals", async () => {
  const handler = createDevCloudRequestHandler();
  const sessionId = "test-session-opt-in";
  const ownerKey = testOwnerKey(sessionId);
  const cacheScope = {
    personalizationVersion: 0,
    selectionKey: "selection-before-opt-in",
    sessionId: ownerKey,
    sortMode: "relevance",
    workspaceKey: "workspace-before-opt-in"
  };
  const invokeProfile = (url, body) => invokeHandler({
    body: JSON.stringify({ sessionId, ...body }),
    handler,
    headers: { "content-type": "application/json", host: "127.0.0.1:8787" },
    method: "POST",
    url
  });

  const initial = await invokeProfile("/v1/personalization/settings", {});
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json.enabled, false);

  putRecommendationCache(cacheScope, [{ id: "cached-before-opt-in" }]);
  const ignored = await invokeProfile("/v1/personalization/signal", {
    signal: { kind: "paper_opened", title: "Private retrieval topic" }
  });
  assert.equal(ignored.statusCode, 200);
  assert.deepEqual(ignored.json.tags, []);
  assert.equal(getRecommendationCache(cacheScope).cacheHit, true);

  const enabled = await invokeProfile("/v1/personalization/settings/update", { enabled: true });
  assert.equal(enabled.statusCode, 200);
  assert.equal(enabled.json.enabled, true);

  const collected = await invokeProfile("/v1/personalization/signal", {
    signal: { kind: "paper_opened", title: "Private retrieval topic" }
  });
  assert.equal(collected.statusCode, 200);
  assert.ok(collected.json.tags.length > 0);
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
      fullTextGrantId: response.json.sources[0].fullTextGrantId,
      fullTextUrl: "https://example.org/paper.pdf",
      id: "openalex:W123456789",
      openAccessAvailable: true,
      provider: "openalex",
      confidence: 0.3,
    confidenceBasis: "algorithmic_retrieval",
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
  assert.match(response.json.sources[0].fullTextGrantId, /^pdfgrant_[A-Za-z0-9-]+$/);
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
    confidence: 0.3,
    confidenceBasis: "algorithmic_retrieval",
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
  assert.equal(second.json.retrieval.attempts, 2);
  assert.equal(second.json.retrieval.reused, false);
  assert.equal(second.json.retrieval.status, "completed");
  assert.ok(Date.parse(second.json.retrieval.expiresAt) > Date.parse(second.json.retrieval.serverNow));
  assert.equal(second.json.sources[0].sourceId, "W401");

  const third = await invokeHandler({
    body: JSON.stringify(request),
    handler: createHandler(),
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/research/external-knowledge"
  });
  assert.equal(third.statusCode, 200);
  assert.equal(third.json.retrieval.attempts, 2);
  assert.equal(third.json.retrieval.id, second.json.retrieval.id);
  assert.equal(third.json.retrieval.reused, true);
  assert.equal(third.json.retrieval.status, "completed");
  assert.equal(calls, 2);
});

function expectExternalRetrievalFailure(response) {
  assert.equal(response.statusCode, 502);
  assert.equal(response.json.code, "openalex_unavailable");
  assert.equal(typeof response.json.message, "string");
  assert.match(response.json.traceId, /^trace_/);
  assert.equal("retrieval" in response.json, false);
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
  assert.equal(response.json.code, "invalid_external_knowledge_artifact_id");
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
  assert.equal(response.json.retrieval.attempts, 1);
  assert.equal(response.json.retrieval.reused, false);
  assert.equal(response.json.retrieval.status, "skipped");
  assert.ok(Date.parse(response.json.retrieval.expiresAt) > Date.parse(response.json.retrieval.serverNow));

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
  assert.equal(response.json.code, "openalex_upstream_error");
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
  assert.equal(response.json.code, "openalex_timeout");
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
    handlerOptions: {
      defaultProvider: "openai",
      openaiApiBaseUrl: "https://user:password@nowcoding.ai/v1?token=secret",
      openaiApiKey: "sk-health-secret",
      openaiModel: "gpt-5.6-terra",
      runtimePid: 4242,
      runtimeStartedAt: "2026-08-01T00:00:00.000Z"
    },
    method: "GET",
    headers: {
      host: "127.0.0.1:8787"
    },
    url: "/healthz"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.deepEqual(response.json, {
    ok: true,
    runtime: {
      provider: "openai",
      upstreamBaseUrl: "https://nowcoding.ai/v1",
      hasApiKey: true,
      selectedModel: "gpt-5.6-terra",
      pid: 4242,
      startedAt: "2026-08-01T00:00:00.000Z"
    }
  });
  assert.doesNotMatch(response.body, /password|secret|sk-health-secret/);
});

test("stores and deletes an Agent artifact only for its authenticated owner", async () => {
  const handler = createDevCloudRequestHandler();
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
    handler,
    headers: { authorization: "Bearer artifact-owner", "content-type": "application/json" },
    method: "POST",
    url: "/v1/agent-artifacts"
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json.path, "liteasy://agent-artifacts/artifact-delete");

  const otherOwnerList = await invokeHandler({
    handler,
    headers: { authorization: "Bearer artifact-other" },
    method: "GET",
    url: "/v1/agent-artifacts"
  });
  assert.equal(otherOwnerList.statusCode, 200);
  assert.deepEqual(otherOwnerList.json.artifacts, []);

  const otherOwnerDelete = await invokeHandler({
    handler,
    headers: { authorization: "Bearer artifact-other" },
    method: "DELETE",
    url: "/v1/agent-artifacts/artifact-delete"
  });
  assert.equal(otherOwnerDelete.statusCode, 404);

  const deleted = await invokeHandler({
    handler,
    headers: { authorization: "Bearer artifact-owner" },
    method: "DELETE",
    url: "/v1/agent-artifacts/artifact-delete"
  });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.json, {
    artifactId: "artifact-delete",
    deleted: true,
    path: "liteasy://agent-artifacts/artifact-delete"
  });

  const missing = await invokeHandler({
    handler,
    headers: { authorization: "Bearer artifact-owner" },
    method: "DELETE",
    url: "/v1/agent-artifacts/artifact-delete"
  });
  assert.equal(missing.statusCode, 404);

  const unsafe = await invokeHandler({
    handler,
    headers: { authorization: "Bearer artifact-owner" },
    method: "DELETE",
    url: "/v1/agent-artifacts/%2E%2E%2Fescape"
  });
  assert.equal(unsafe.statusCode, 400);
  assert.equal(unsafe.json.code, "invalid_agent_artifact_id");
});

test("renames a persisted Agent artifact without changing its id", async () => {
  const handler = createDevCloudRequestHandler();
  const artifact = {
    agent: { apiVersion: "liteasy.agent/v1", runId: "run-1", sessionId: "session-1", status: "completed" },
    answer: "analysis",
    artifactId: "artifact-rename",
    artifactType: "tree",
    citations: [],
    createdAt: "2026-07-20T00:00:00.000Z",
    papers: [],
    title: "Before",
    uiDsl: { version: "liteasy.ui/v1" },
    version: "liteasy.agent-artifact/v1"
  };
  await invokeHandler({
    body: JSON.stringify(artifact),
    handler,
    headers: { authorization: "Bearer artifact-rename-owner", "content-type": "application/json" },
    method: "POST",
    url: "/v1/agent-artifacts"
  });

  const renamed = await invokeHandler({
    body: JSON.stringify({ title: "  After   rename " }),
    handler,
    headers: { authorization: "Bearer artifact-rename-owner", "content-type": "application/json" },
    method: "PATCH",
    url: "/v1/agent-artifacts/artifact-rename"
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json.artifact.artifactId, "artifact-rename");
  assert.equal(renamed.json.artifact.title, "After rename");
});

test("rejects unauthenticated Agent artifact access", async () => {
  const response = await invokeHandler({
    handler: createDevCloudRequestHandler(),
    method: "GET",
    url: "/v1/agent-artifacts"
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json.code, "invalid_session");
});

test("serves the RBAC and MFA admin console without demo controls", async () => {
  for (const url of ["/admin", "/admin/"]) {
    const response = await invokeHandler({
      method: "GET",
      headers: { host: "127.0.0.1:8787" },
      url
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["Content-Type"], "text/html; charset=utf-8");
    assert.match(response.body, /Liteasy 管理后台/);
    assert.match(response.body, /动态验证码/);
    assert.match(response.body, /audience: "liteasy-admin"/);
    assert.match(response.body, /\/v1\/admin\/governance-dashboard/);
    assert.doesNotMatch(response.body, /demo|fixture|重新播种|重置数据/i);
    const script = response.body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    assert.doesNotThrow(() => new Function(script));
  }
});

test("rejects anonymous access to the governance dashboard", async () => {
  const response = await invokeHandler({
    method: "GET",
    headers: { host: "127.0.0.1:8787" },
    url: "/v1/admin/governance-dashboard"
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json.code, "invalid_session");
  assert.match(response.json.traceId, /^trace_/);
});

test("returns developer diagnostics only for an authenticated desktop role grant", async () => {
  const database = createDatabase();
  const accounts = createAccountRepository(database);
  const diagnosticAccount = accounts.create({
    displayName: "Diagnostic Developer",
    email: "diagnostic-developer@example.com",
    passwordHash: await hashPassword("diagnostic-password-1")
  });
  const regularAccount = accounts.create({
    displayName: "Regular Researcher",
    email: "regular-researcher@example.com",
    passwordHash: await hashPassword("regular-password-1")
  });
  createPlatformAdminRepository(database, { environment: "development" }).grantRole(
    `user:${diagnosticAccount.id}`,
    "developer_diagnostics",
    "test-bootstrap"
  );
  const handler = createDevCloudRequestHandler({ database, environment: "development" });
  const login = (email, password, audience = "liteasy-desktop") => invokeHandler({
    body: JSON.stringify({ audience, email, password }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/account/login"
  });
  const diagnosticLogin = await login(
    diagnosticAccount.email,
    "diagnostic-password-1"
  );
  const regularLogin = await login(regularAccount.email, "regular-password-1");
  const forumLogin = await login(
    diagnosticAccount.email,
    "diagnostic-password-1",
    "intuecho-web"
  );
  const capabilities = (token) => invokeHandler({
    handler,
    headers: { authorization: `Bearer ${token}` },
    method: "GET",
    url: "/v1/account/capabilities"
  });

  assert.deepEqual(
    (await capabilities(diagnosticLogin.json.session.sessionId)).json,
    { developerDiagnostics: true }
  );
  assert.deepEqual(
    (await capabilities(regularLogin.json.session.sessionId)).json,
    { developerDiagnostics: false }
  );
  const wrongAudience = await capabilities(forumLogin.json.session.sessionId);
  assert.equal(wrongAudience.statusCode, 403);
  assert.equal(wrongAudience.json.code, "invalid_session_audience");
  const anonymous = await capabilities("");
  assert.equal(anonymous.statusCode, 401);
  assert.equal(anonymous.json.code, "invalid_session");
});

test("enforces admin audience, MFA, RBAC, support grants, and all-audience revocation", async () => {
  const database = createDatabase();
  const accounts = createAccountRepository(database);
  const adminAccount = accounts.create({
    displayName: "Platform Admin",
    email: "platform-admin@example.com",
    passwordHash: await hashPassword("admin-password-1")
  });
  const targetAccount = accounts.create({
    displayName: "Target User",
    email: "target-user@example.com",
    passwordHash: await hashPassword("target-password-1")
  });
  const platform = createPlatformAdminRepository(database, { environment: "development" });
  platform.grantRole(`user:${adminAccount.id}`, "platform_admin", "test-bootstrap");
  const handler = createDevCloudRequestHandler({
    database,
    environment: "development",
    mfaService: {
      isEnabled: () => true,
      verify: (_userId, code) => code === "123456"
    }
  });
  const login = (email, password, audience, mfaCode) => invokeHandler({
    body: JSON.stringify({ audience, email, mfaCode, password }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url: "/v1/account/login"
  });
  const adminLogin = await login(
    adminAccount.email,
    "admin-password-1",
    "liteasy-admin",
    "123456"
  );
  assert.equal(adminLogin.statusCode, 200);
  const adminToken = adminLogin.json.session.sessionId;
  for (const request of [
    {
      body: { defaultProvider: "openai" },
      url: "/v1/admin/model-policy"
    },
    {
      body: { limitBytes: 1024, scopeId: `user:${targetAccount.id}`, scopeType: "user" },
      url: "/v1/admin/storage-quota"
    },
    {
      body: { status: "disabled", userId: targetAccount.id },
      url: "/v1/admin/accounts/status"
    }
  ]) {
    const response = await invokeHandler({
      body: JSON.stringify(request.body),
      handler,
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json"
      },
      method: "POST",
      url: request.url
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json.code, "admin_reason_required");
  }
  const desktopAdmin = await login(
    adminAccount.email,
    "admin-password-1",
    "liteasy-desktop"
  );
  const desktopPolicy = await invokeHandler({
    handler,
    headers: {
      authorization: `Bearer ${desktopAdmin.json.session.sessionId}`
    },
    method: "GET",
    url: "/v1/model-policy"
  });
  assert.equal(desktopPolicy.statusCode, 200);
  assert.equal(typeof desktopPolicy.json.defaultProvider, "string");
  const wrongAudience = await invokeHandler({
    body: JSON.stringify({
      reason: "Must not accept a desktop token",
      status: "disabled",
      userId: targetAccount.id
    }),
    handler,
    headers: {
      authorization: `Bearer ${desktopAdmin.json.session.sessionId}`,
      "content-type": "application/json"
    },
    method: "POST",
    url: "/v1/admin/accounts/status"
  });
  assert.equal(wrongAudience.statusCode, 403);
  assert.equal(wrongAudience.json.code, "invalid_session_audience");

  const targetDesktop = await login(
    targetAccount.email,
    "target-password-1",
    "liteasy-desktop"
  );
  const targetForum = await login(
    targetAccount.email,
    "target-password-1",
    "intuecho-web"
  );
  const targetAdminAudience = await login(
    targetAccount.email,
    "target-password-1",
    "liteasy-admin",
    "123456"
  );
  const targetArtifact = await invokeHandler({
    body: JSON.stringify({
      agent: {
        apiVersion: "liteasy.agent/v1",
        runId: "target-account-run",
        sessionId: "target-account-session",
        status: "completed"
      },
      answer: "Private account analysis",
      artifactId: "target-account-artifact",
      artifactType: "tree",
      citations: [],
      createdAt: "2026-08-07T00:00:00.000Z",
      papers: [],
      title: "Target account artifact",
      uiDsl: { version: "liteasy.ui/v1" },
      version: "liteasy.agent-artifact/v1"
    }),
    handler,
    headers: {
      authorization: `Bearer ${targetDesktop.json.session.sessionId}`,
      "content-type": "application/json"
    },
    method: "POST",
    url: "/v1/agent-artifacts"
  });
  assert.equal(targetArtifact.statusCode, 201, JSON.stringify(targetArtifact.json));
  const targetScopeId = `user:${targetAccount.id}`;
  const uploaded = await invokeHandler({
    body: Buffer.from("%PDF-1.7\nPrivate support document\n%%EOF"),
    handler,
    headers: {
      "content-type": "application/pdf",
      "x-idempotency-key": "support-document-upload",
      "x-liteasy-expected-revision": "0",
      "x-liteasy-file-name": encodeURIComponent("Private.pdf"),
      "x-liteasy-scope-id": targetScopeId,
      "x-liteasy-scope-type": "user",
      "x-liteasy-session-id": targetDesktop.json.session.sessionId
    },
    method: "POST",
    url: "/v1/library/documents/upload"
  });
  assert.equal(uploaded.statusCode, 200, JSON.stringify(uploaded.json));
  const supportBody = {
    documentId: uploaded.json.document.documentId,
    scopeId: targetScopeId,
    scopeType: "user"
  };
  const supportRequest = (body) => invokeHandler({
    body: JSON.stringify(body),
    handler,
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json"
    },
    method: "POST",
    url: "/v1/admin/support-access/document"
  });
  const beforeGrant = await supportRequest(supportBody);
  assert.equal(beforeGrant.statusCode, 403);
  assert.equal(beforeGrant.json.code, "support_access_required");

  const grant = await invokeHandler({
    body: JSON.stringify({
      durationMinutes: 15,
      reason: "Investigate a user-reported corrupt PDF",
      scopeId: targetScopeId,
      scopeType: "user"
    }),
    handler,
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json"
    },
    method: "POST",
    url: "/v1/admin/support-access/grant"
  });
  assert.equal(grant.statusCode, 201, JSON.stringify(grant.json));
  const afterGrant = await supportRequest(supportBody);
  assert.equal(afterGrant.statusCode, 200);
  assert.match(afterGrant.body, /^%PDF-/);
  const revokeWithoutReason = await invokeHandler({
    body: JSON.stringify({ grantId: grant.json.grant.grantId }),
    handler,
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json"
    },
    method: "POST",
    url: "/v1/admin/support-access/revoke"
  });
  assert.equal(revokeWithoutReason.statusCode, 400);
  assert.equal(revokeWithoutReason.json.code, "admin_reason_required");
  const revoke = await invokeHandler({
    body: JSON.stringify({
      grantId: grant.json.grant.grantId,
      reason: "Support investigation complete"
    }),
    handler,
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json"
    },
    method: "POST",
    url: "/v1/admin/support-access/revoke"
  });
  assert.equal(revoke.statusCode, 200);
  assert.equal((await supportRequest(supportBody)).statusCode, 403);

  const disabled = await invokeHandler({
    body: JSON.stringify({
      reason: "Security response",
      status: "disabled",
      userId: targetAccount.id
    }),
    handler,
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json"
    },
    method: "POST",
    url: "/v1/admin/accounts/status"
  });
  assert.equal(disabled.statusCode, 200, JSON.stringify(disabled.json));
  for (const session of [targetDesktop, targetForum, targetAdminAudience]) {
    const validation = await invokeHandler({
      body: JSON.stringify({
        audience: session.json.session.audience,
        sessionId: session.json.session.sessionId
      }),
      handler,
      headers: { "content-type": "application/json" },
      method: "POST",
      url: "/v1/account/session"
    });
    assert.equal(validation.statusCode, 401);
    assert.equal(validation.json.code, "invalid_session");
  }
  const adminAccountStatus = (status, reason) => invokeHandler({
    body: JSON.stringify({ reason, status, userId: targetAccount.id }),
    handler,
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json"
    },
    method: "POST",
    url: "/v1/admin/accounts/status"
  });
  assert.equal((await adminAccountStatus("active", "Deletion lifecycle test")).statusCode, 200);
  database.prepare(`
    INSERT INTO local_library_manifest_entries (
      owner_key, sync_document_id, title, updated_at
    ) VALUES (?, 'local-1', 'Private paper', ?)
  `).run(targetScopeId, new Date().toISOString());
  const deleted = await adminAccountStatus("deleted", "Approved account deletion request");
  assert.equal(deleted.statusCode, 200, JSON.stringify(deleted.json));
  assert.equal(deleted.json.account.status, "deleted");
  assert.deepEqual(deleted.json.deletion.agentArtifacts, { artifacts: 1, generationRuns: 1 });
  assert.equal(deleted.json.deletion.library.documents, 1);
  assert.equal(database.prepare(
    "SELECT count(*) AS count FROM artifacts WHERE owner_user_id = ?"
  ).get(targetAccount.id).count, 0);
  assert.equal(database.prepare(
    "SELECT count(*) AS count FROM generation_runs WHERE owner_user_id = ?"
  ).get(targetAccount.id).count, 0);
  assert.equal(database.prepare(
    "SELECT count(*) AS count FROM artifact_versions"
  ).get().count, 0);
  assert.equal(database.prepare(
    "SELECT count(*) AS count FROM library_documents WHERE scope_type = 'user' AND scope_id = ?"
  ).get(targetScopeId).count, 0);
  assert.equal(database.prepare(
    "SELECT count(*) AS count FROM storage_objects"
  ).get().count, 0);
  assert.equal(database.prepare(
    "SELECT count(*) AS count FROM local_library_manifest_entries WHERE owner_key = ?"
  ).get(targetScopeId).count, 0);
  assert.equal(database.prepare(
    "SELECT count(*) AS count FROM password_credentials WHERE user_id = ?"
  ).get(targetAccount.id).count, 0);
  assert.match(accounts.findPublicById(targetAccount.id).email, /^deleted\+/);
  assert.deepEqual(
    database.prepare(`
      SELECT status, error_code, completed_at IS NOT NULL AS completed
      FROM account_deletion_jobs WHERE user_id = ?
    `).get(targetAccount.id),
    { completed: 1, error_code: null, status: "completed" }
  );
  const auditActions = database.prepare(
    "SELECT action FROM platform_audit_events ORDER BY occurred_at, event_id"
  ).all().map((row) => row.action);
  assert.equal(auditActions.includes("support_document_accessed"), true);
  assert.equal(auditActions.includes("account_status_updated"), true);
  database.close();
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
  assert.equal(duplicateResponse.json.code, "account_exists");
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
  assert.equal(revokedResponse.json.code, "invalid_session");
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
  assert.deepEqual(listResponse.json.items, [{ ...collectionItem, status: "active" }]);

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
  assert.equal(bypassResponse.json.code, "invalid_session");
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
  assert.equal(response.json.code, "invalid_credentials");
  assert.equal(response.json.message, "邮箱或密码不正确。");
  assert.match(response.json.traceId, /^trace_/);
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
  assert.equal(shortPasswordResponse.json.code, "invalid_account_registration");

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
  assert.equal(oversizedResponse.json.code, "request_body_too_large");
});

test("stores and returns private cloud collection items for an authenticated test session", async () => {
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
      sessionId: "test-session-1"
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
      sessionId: "test-session-1"
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
      sessionId: "test-session-1",
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
      sessionId: "test-session-1",
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
      sessionId: "test-session-1",
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
  assert.equal(putResponse.json.code, "invalid_recommendation_cache_payload");
});

test("expires stale recommendation cache entries before a new online refresh", () => {
  const database = createDatabase();
  let now = new Date("2026-08-06T00:00:00.000Z");
  const repository = createRecommendationCacheRepository(database, { now: () => now });
  const scope = {
    selectionKey: "paper-1",
    sessionId: "test-session-1",
    sortMode: "relevance",
    workspaceKey: "local:/tmp/LiteasyLibrary"
  };
  repository.put(scope, [{ id: "rec-old" }]);
  now = new Date("2026-08-07T00:00:00.001Z");
  const result = repository.get(scope);

  assert.deepEqual(result, { cacheHit: false, recommendations: [] });
  database.close();
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
      sessionId: "test-session-1"
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
      sessionId: "test-session-1",
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
      sessionId: "test-session-1",
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
      sessionId: "test-session-1"
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
  assert.equal(response.json.code, "not_found");
  assert.match(response.json.message, /LiteasyClaw dev cloud/);
  assert.match(response.json.traceId, /^trace_/);
  assert.equal("path" in response.json, false);
  assert.equal("availableEndpoints" in response.json, false);
});


test("reports model unavailability when no provider credential is configured", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Generate a summary.", provider: "openai" }),
    url: "/v1/model/generate"
  });
  assert.equal(response.statusCode, 502);
  assert.equal(typeof response.json.code, "string");
  assert.match(response.json.traceId, /^trace_/);
  assert.equal("answer" in response.json, false);
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

test("supplies the configured OpenAI model when a browser request omits it", async () => {
  let capturedInput;
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      prompt: "生成一条简短说明。",
      provider: "openai"
    }),
    url: "/v1/model/generate",
    handlerOptions: {
      openaiApiKey: "sk-test",
      openaiModel: "gpt-5.6-terra",
      providers: {
        openai: async (input) => {
          capturedInput = input;
          return "已生成";
        }
      }
    }
  });

  assert.equal(capturedInput.model, "gpt-5.6-terra");
  assert.equal(response.json.answer, "已生成");
});

test("does not expose a demo login route", async () => {
  const response = await invokeHandler({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "demo_login" }),
    url: "/v1/account/demo-login"
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json.code, "not_found");
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
      sessionId: "test-session-1"
    }),
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json.code, "research_profile_topics_invalid");
});

test("completes an implicit recommendation profile after behavior personalization", async () => {
  const handler = createDevCloudRequestHandler({
    crossrefEnabled: false,
    expandedSourcesEnabled: false,
    openAlexApiKey: "service-owned-key",
    openAlexTransport: async () => ({
      json: async () => ({ results: [] }),
      ok: true,
      status: 200
    })
  });
  await enablePersonalization(handler);
  const signalResponse = await invokeHandler({
    body: JSON.stringify({
      sessionId: "test-session-1",
      signal: { kind: "paper_opened", title: "Neural information retrieval" }
    }),
    handler,
    headers: { "content-type": "application/json", host: "127.0.0.1:8787" },
    method: "POST",
    url: "/v1/personalization/signal"
  });
  assert.equal(signalResponse.statusCode, 200);

  const response = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-1", title: "Target Retrieval Paper" }],
      sessionId: "test-session-1"
    }),
    handler,
    headers: { "content-type": "application/json", host: "127.0.0.1:8787" },
    method: "POST",
    url: "/v1/recommendations"
  });

  assert.equal(response.statusCode, 200, JSON.stringify(response.json));
  assert.deepEqual(response.json.recommendations, []);
});

test("returns provenance-bearing live reading candidates instead of demo recommendations", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-1", title: "Target Retrieval Paper" }],
      sessionId: "test-session-1"
    }),
    handler: createDevCloudRequestHandler({
      // These predate the DOAJ/OpenAIRE/OAPEN/Semantic Scholar sources and stub only
      // OpenAlex, arXiv and Crossref. Leaving the expanded ones on sends real network
      // requests that time out after 8s.
      expandedSourcesEnabled: false,
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
    surfacingTags: [],
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
  const candidatePool = listRecommendationCandidates(testOwnerKey("test-session-1"));
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
      // These predate the DOAJ/OpenAIRE/OAPEN/Semantic Scholar sources and stub only
      // OpenAlex, arXiv and Crossref. Leaving the expanded ones on sends real network
      // requests that time out after 8s.
      expandedSourcesEnabled: false,
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
    listRecommendationCandidates(testOwnerKey("external-reranker-user"))[0].externalReranker.version,
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
  const persisted = listRecommendationCandidates(testOwnerKey("publication-link-user"));
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
      // These predate the DOAJ/OpenAIRE/OAPEN/Semantic Scholar sources and stub only
      // OpenAlex, arXiv and Crossref. Leaving the expanded ones on sends real network
      // requests that time out after 8s.
      expandedSourcesEnabled: false,
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
  const database = createDatabase({ databasePath: ":memory:" });
  setRecommendationCandidateRepository(createRecommendationCandidateRepository(database));
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
      // These predate the DOAJ/OpenAIRE/OAPEN/Semantic Scholar sources and stub only
      // OpenAlex, arXiv and Crossref. Leaving the expanded ones on sends real network
      // requests that time out after 8s.
      expandedSourcesEnabled: false,
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
    sessionId: testOwnerKey("test-session-1"),
    sortMode: "relevance",
    workspaceKey: "local:/tmp/LiteasyLibrary"
  };
  const initialRecommendationResponse = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-1", title: "Target Retrieval Paper" }],
      sessionId: "test-session-1"
    }),
    handler,
    headers: { "content-type": "application/json", "x-openalex-api-key": "test-openalex-api-key" },
    method: "POST",
    url: "/v1/recommendations"
  });
  assert.equal(initialRecommendationResponse.statusCode, 200);
  assert.equal(
    listRecommendationCandidates(testOwnerKey("test-session-1"))
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
      sessionId: "test-session-1"
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
    listRecommendationCandidates(testOwnerKey("test-session-1"))
      .find((candidate) => candidate.canonicalId === "openalex:W200")?.status,
    "dismissed"
  );

  const recommendationResponse = await invokeHandler({
    body: JSON.stringify({
      selectedDocuments: [{ id: "paper-1", title: "Target Retrieval Paper" }],
      sessionId: "test-session-1"
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
    listRecommendationCandidates(testOwnerKey("test-session-1"))
      .find((candidate) => candidate.canonicalId === "openalex:W201")?.discoveryCount >= 2
  );
});

test("reuses a recent persistent candidate without presenting it as a new live discovery", async () => {
  let retrievalCount = 0;
  const handler = createDevCloudRequestHandler({
      // These predate the DOAJ/OpenAIRE/OAPEN/Semantic Scholar sources and stub only
      // OpenAlex, arXiv and Crossref. Leaving the expanded ones on sends real network
      // requests that time out after 8s.
      expandedSourcesEnabled: false,
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
      sessionId: "test-session-1"
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
    listRecommendationCandidates(testOwnerKey("test-session-1"))
      .find((candidate) => candidate.canonicalId === "openalex:W700")?.discoveryCount,
    1
  );
});

test("accepts privacy-safe metadata sync and rejects local paths", async () => {
  const handler = createDevCloudRequestHandler();
  await enablePersonalization(handler);
  const response = await invokeHandler({
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "127.0.0.1:8787"
    },
    body: JSON.stringify({
      documents: [
        {
          contentHash: "a".repeat(64),
          id: "local-1",
          title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
        },
        {
          id: "local-2",
          title: "Survey of Vector Database Management Systems"
        },
        {
          id: "local-3",
          sourcePath: "C:/Users/researcher/private/acorn.pdf",
          title: "ACORN: Performant and Predicate-Agnostic Search Over Vector Embeddings and Structured Data"
        }
      ],
      sessionId: "test-session-1",
      workspaceRevision: 0
    }),
    handler,
    url: "/v1/documents/metadata-sync"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.result.acceptedCount, 2);
  assert.equal(response.json.result.rejectedCount, 1);
  assert.equal(response.json.result.disabled, false);
  assert.match(response.json.result.syncId, /^[a-f0-9-]{36}$/);
  assert.ok(Date.parse(response.json.result.syncedAt) <= Date.now());
});


test("runs an organization lifecycle through authenticated RBAC endpoints", async () => {
  const handler = createDevCloudRequestHandler();
  const invokeAs = (sessionId, url, body = {}) => invokeHandler({
    body: JSON.stringify({ ...body, sessionId }),
    handler,
    headers: { "content-type": "application/json" },
    method: "POST",
    url
  });

  const created = await invokeAs("organization-owner", "/v1/org/create", {
    displayName: "Owner",
    name: "Research Lab"
  });
  assert.equal(created.statusCode, 200);
  const organizationId = created.json.organization.organizationId;
  assert.equal(created.json.organization.ownerUserId, testOwnerKey("organization-owner"));
  assert.equal(created.json.organization.myRole, "owner");

  const listed = await invokeAs("organization-owner", "/v1/org/list");
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json.activeOrganizationId, organizationId);
  assert.equal(listed.json.organizations[0].memberCount, 1);

  const invited = await invokeAs("organization-owner", "/v1/org/invite", {
    organizationId,
    role: "member",
    targetSubject: testOwnerKey("organization-member")
  });
  assert.equal(invited.statusCode, 200);
  assert.equal(invited.json.invite.role, "member");
  assert.match(invited.json.invitation.invitationToken, /^[a-f0-9-]{36}$/);

  const joined = await invokeAs("organization-member", "/v1/org/join", {
    displayName: "Member",
    expectedInvitationRevision: 0,
    invitationToken: invited.json.invitation.invitationToken
  });
  assert.equal(joined.statusCode, 200);
  assert.equal(joined.json.membership.role, "member");

  const promoted = await invokeAs("organization-owner", "/v1/org/members/role", {
    organizationId,
    role: "admin",
    targetSubject: testOwnerKey("organization-member")
  });
  assert.equal(promoted.statusCode, 200);
  assert.equal(promoted.json.member.role, "admin");
  const demoted = await invokeAs("organization-owner", "/v1/org/members/role", {
    organizationId,
    role: "member",
    targetSubject: testOwnerKey("organization-member")
  });
  assert.equal(demoted.statusCode, 200);
  assert.equal(demoted.json.member.role, "member");

  const forbiddenGovernance = await invokeAs(
    "organization-member",
    "/v1/org/governance-summary",
    { organizationId }
  );
  assert.equal(forbiddenGovernance.statusCode, 403);
  assert.equal(forbiddenGovernance.json.code, "organization_role_forbidden");

  const governance = await invokeAs(
    "organization-owner",
    "/v1/org/governance-summary",
    { organizationId }
  );
  assert.equal(governance.statusCode, 200);
  assert.equal(governance.json.summary.policy.uploadPolicy, "owner_admins");
  assert.equal(governance.json.summary.policy.exportPolicy, "disabled");

  const summary = await invokeAs("organization-member", "/v1/org/summary", {
    organizationId
  });
  assert.deepEqual(summary.json.summary.policy, {
    exportPolicy: "disabled",
    uploadPolicy: "owner_admins"
  });
  const memberPolicy = await invokeAs("organization-member", "/v1/org/storage-policy", {
    organizationId
  });
  assert.equal(memberPolicy.json.role, "member");

  const uploaded = await invokeHandler({
    body: Buffer.from("%PDF-1.7\nOrganization export policy\n%%EOF"),
    handler,
    headers: {
      "content-type": "application/pdf",
      "x-idempotency-key": "organization-export-upload",
      "x-liteasy-expected-revision": "0",
      "x-liteasy-file-name": encodeURIComponent("Policy.pdf"),
      "x-liteasy-scope-id": organizationId,
      "x-liteasy-scope-type": "organization",
      "x-liteasy-session-id": "organization-owner"
    },
    method: "POST",
    url: "/v1/library/documents/upload"
  });
  assert.equal(uploaded.statusCode, 200, JSON.stringify(uploaded.json));
  const documentId = uploaded.json.document.documentId;
  const createdAnnotation = await invokeAs(
    "organization-owner",
    "/v1/org/annotations/create",
    {
      body: {
        clientAnnotationId: "local-annotation-1",
        excerpt: "Organization evidence",
        kind: "note",
        note: "Initial note",
        page: 1,
        rects: [],
        text: "批注",
        updatedAt: "2026-08-06T00:00:00.000Z"
      },
      documentId,
      idempotencyKey: "team-annotation-create-1",
      organizationId
    }
  );
  assert.equal(createdAnnotation.statusCode, 200, JSON.stringify(createdAnnotation.json));
  assert.equal(createdAnnotation.json.revision, 1);
  assert.equal(createdAnnotation.json.uploadedBy, testOwnerKey("organization-owner"));
  const annotationId = createdAnnotation.json.annotationId;
  const conflictingAnnotationReplay = await invokeAs(
    "organization-owner",
    "/v1/org/annotations/create",
    {
      body: {
        ...createdAnnotation.json.body,
        note: "Changed under a reused key"
      },
      documentId,
      idempotencyKey: "team-annotation-create-1",
      organizationId
    }
  );
  assert.equal(conflictingAnnotationReplay.statusCode, 409);
  assert.equal(conflictingAnnotationReplay.json.code, "idempotency_key_reused");
  const listedAnnotations = await invokeAs(
    "organization-member",
    "/v1/org/annotations/list",
    { documentId, organizationId }
  );
  assert.equal(listedAnnotations.statusCode, 200);
  assert.equal(listedAnnotations.json.annotations[0].annotationId, annotationId);
  assert.equal(listedAnnotations.json.annotations[0].body.note, "Initial note");
  const updatedAnnotation = await invokeAs(
    "organization-owner",
    "/v1/org/annotations/update",
    {
      annotationId,
      body: {
        ...createdAnnotation.json.body,
        note: "Revised note",
        updatedAt: "2026-08-06T00:01:00.000Z"
      },
      expectedRevision: 1,
      idempotencyKey: "team-annotation-update-1",
      organizationId
    }
  );
  assert.equal(updatedAnnotation.statusCode, 200);
  assert.equal(updatedAnnotation.json.revision, 2);
  assert.equal(updatedAnnotation.json.body.note, "Revised note");
  const forbiddenAnnotationDelete = await invokeAs(
    "organization-member",
    "/v1/org/annotations/delete",
    {
      annotationId,
      expectedRevision: 2,
      idempotencyKey: "team-annotation-delete-member",
      organizationId
    }
  );
  assert.equal(forbiddenAnnotationDelete.statusCode, 403);
  assert.equal(forbiddenAnnotationDelete.json.code, "annotation_delete_forbidden");
  const deletedAnnotation = await invokeAs(
    "organization-owner",
    "/v1/org/annotations/delete",
    {
      annotationId,
      expectedRevision: 2,
      idempotencyKey: "team-annotation-delete-owner",
      organizationId
    }
  );
  assert.equal(deletedAnnotation.statusCode, 200);
  assert.equal(deletedAnnotation.json.deleted, true);
  const forbiddenExport = await invokeAs(
    "organization-member",
    "/v1/library/documents/export",
    { documentId, scopeId: organizationId, scopeType: "organization" }
  );
  assert.equal(forbiddenExport.statusCode, 403);
  assert.equal(forbiddenExport.json.code, "organization_export_forbidden");

  const updatedPolicy = await invokeAs(
    "organization-owner",
    "/v1/org/storage-policy/update",
    { exportPolicy: "all_members", organizationId, uploadPolicy: "all_members" }
  );
  assert.equal(updatedPolicy.statusCode, 200);
  assert.equal(updatedPolicy.json.exportPolicy, "all_members");
  assert.equal(updatedPolicy.json.uploadPolicy, "all_members");

  const allowedExport = await invokeAs(
    "organization-member",
    "/v1/library/documents/export",
    { documentId, scopeId: organizationId, scopeType: "organization" }
  );
  assert.equal(allowedExport.statusCode, 200);
  assert.match(allowedExport.body, /^%PDF-/);

  const ownerLeave = await invokeAs("organization-owner", "/v1/org/leave", { organizationId });
  assert.equal(ownerLeave.statusCode, 403);
  assert.equal(ownerLeave.json.code, "organization_owner_leave_blocked");

  const suspended = await invokeAs("organization-owner", "/v1/org/members/status", {
    organizationId,
    status: "suspended",
    targetSubject: testOwnerKey("organization-member")
  });
  assert.equal(suspended.statusCode, 200);
  assert.equal(suspended.json.member.status, "suspended");
  const resumed = await invokeAs("organization-owner", "/v1/org/members/status", {
    organizationId,
    status: "active",
    targetSubject: testOwnerKey("organization-member")
  });
  assert.equal(resumed.statusCode, 200);
  assert.equal(resumed.json.member.status, "active");
  const transferred = await invokeAs("organization-owner", "/v1/org/owner/transfer", {
    organizationId,
    targetSubject: testOwnerKey("organization-member")
  });
  assert.equal(transferred.statusCode, 200);
  assert.equal(transferred.json.newOwnerSubject, testOwnerKey("organization-member"));
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
      model: "deterministic-citation-check/v1",
      rationale: "确定性检查发现回答包含可追溯引用。",
      score: 0.86,
      verdict: "pass"
    }
  });
});

test("POST /v1/works/resolve resolves a paper identity and is idempotent", async () => {
  const body = JSON.stringify({
    sessionId: "test-session-1",
    identities: [
      { kind: "doi", value: "10.1145/3459615", sourceProvider: "crossref" },
      { kind: "arxiv", value: "2106.04561", relation: "is_preprint_of", sourceProvider: "arxiv" }
    ],
    title: "ColBERT",
    year: 2021,
    type: "conference"
  });

  const first = await invokeHandler({
    body,
    handlerOptions: { recommendationMode: "demo" },
    method: "POST",
    url: "/v1/works/resolve"
  });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json.created, true);
  assert.ok(first.json.work.id.startsWith("w_"));
  assert.equal(first.json.identifiers.length, 2);

  const second = await invokeHandler({
    body,
    handlerOptions: { recommendationMode: "demo" },
    method: "POST",
    url: "/v1/works/resolve"
  });
  assert.equal(second.statusCode, 201);
  assert.equal(second.json.created, false);
  assert.equal(second.json.work.id, first.json.work.id);
});

test("POST /v1/works/resolve rejects invalid identity kind with 400", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({
      sessionId: "test-session-1",
      identities: [{ kind: "bogus", value: "x" }]
    }),
    handlerOptions: { recommendationMode: "demo" },
    method: "POST",
    url: "/v1/works/resolve"
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json.code, "invalid_work_identity_kind");
});

test("POST /v1/works/resolve rejects empty identities with 400", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({ sessionId: "test-session-1", identities: [] }),
    handlerOptions: { recommendationMode: "demo" },
    method: "POST",
    url: "/v1/works/resolve"
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json.code, "invalid_work_identity_count");
});

test("GET /v1/works/resolve reports method not allowed", async () => {
  const response = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/v1/works/resolve"
  });
  assert.equal(response.statusCode, 405);
  assert.equal(response.json.code, "method_not_allowed");
});

test("service index advertises POST /v1/works/resolve", async () => {
  const response = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/"
  });
  assert.ok(response.json.endpoints.includes("POST /v1/works/resolve"));
});

test("GET /v1/concepts lists the seeded discipline catalog", async () => {
  const response = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/v1/concepts?source=discipline_catalog&kind=discipline"
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.concepts.length, 117);
  const first = response.json.concepts[0];
  assert.equal(first.source, "discipline_catalog");
  assert.equal(first.conceptKind, "discipline");
});

test("GET /v1/concepts filters categories by kind", async () => {
  const response = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/v1/concepts?source=discipline_catalog&kind=category"
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.concepts.length, 14);
});

test("GET /v1/concepts/:code returns a discipline with parent", async () => {
  const response = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/v1/concepts/0201"
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json.concept.label, "理论经济学");
  assert.equal(response.json.concept.parentId, "discipline:cat:02");
});

test("GET /v1/concepts/:code returns 404 for unknown code", async () => {
  const response = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/v1/concepts/9999"
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json.code, "concept_not_found");
});

test("POST /v1/concepts reports method not allowed", async () => {
  const response = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "POST",
    url: "/v1/concepts"
  });
  assert.equal(response.statusCode, 405);
  assert.equal(response.json.code, "method_not_allowed");
});

test("service index advertises concept endpoints", async () => {
  const response = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/"
  });
  assert.ok(response.json.endpoints.includes("GET /v1/concepts"));
  assert.ok(response.json.endpoints.includes("GET /v1/concepts/:code"));
});

test("POST /v1/works/:workId/index auto-tags a resolved work", async () => {
  const resolve = await invokeHandler({
    body: JSON.stringify({
      sessionId: "test-session-1",
      identities: [{ kind: "doi", value: "10.1/indextest" }],
      title: "ColBERT Efficient Passage Representation",
      year: 2021
    }),
    handlerOptions: { recommendationMode: "demo" },
    method: "POST",
    url: "/v1/works/resolve"
  });
  const workId = resolve.json.work.id;

  const index = await invokeHandler({
    body: JSON.stringify({ title: "ColBERT Efficient Passage Representation" }),
    handlerOptions: { recommendationMode: "demo" },
    method: "POST",
    url: `/v1/works/${workId}/index`
  });
  assert.equal(index.statusCode, 200);
  assert.ok(index.json.tags.some((tag) => tag.normalized === "colbert"));

  const tags = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/v1/tags"
  });
  assert.ok(tags.json.tags.some((tag) => tag.normalized === "colbert"));
});

test("POST /v1/works/:workId/index rejects missing text with 400", async () => {
  const response = await invokeHandler({
    body: JSON.stringify({}),
    handlerOptions: { recommendationMode: "demo" },
    method: "POST",
    url: "/v1/works/w_dummy/index"
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json.code, "missing_index_text");
});

test("GET /v1/tags/:id/works returns works sharing a tag", async () => {
  for (const doi of ["10.1/tagwork1", "10.1/tagwork2"]) {
    const resolve = await invokeHandler({
      body: JSON.stringify({
        sessionId: "test-session-1",
        identities: [{ kind: "doi", value: doi }],
        title: "ColBERT Dense Retrieval"
      }),
      handlerOptions: { recommendationMode: "demo" },
      method: "POST",
      url: "/v1/works/resolve"
    });
    await invokeHandler({
      body: JSON.stringify({ title: "ColBERT Dense Retrieval" }),
      handlerOptions: { recommendationMode: "demo" },
      method: "POST",
      url: `/v1/works/${resolve.json.work.id}/index`
    });
  }
  const tag = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/v1/tags"
  });
  const colbert = tag.json.tags.find((t) => t.normalized === "colbert");
  assert.ok(colbert.occurrenceCount >= 2);

  const works = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: `/v1/tags/${colbert.id}/works`
  });
  assert.equal(works.statusCode, 200);
  assert.ok(works.json.works.length >= 2);
});

test("GET /v1/tags/:id returns 404 for unknown tag", async () => {
  const response = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/v1/tags/t_doesnotexist1234"
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json.code, "tag_not_found");
});

test("service index advertises tag endpoints", async () => {
  const response = await invokeHandler({
    handlerOptions: { recommendationMode: "demo" },
    method: "GET",
    url: "/"
  });
  assert.ok(response.json.endpoints.includes("POST /v1/works/:workId/index"));
  assert.ok(response.json.endpoints.includes("GET /v1/tags"));
  assert.ok(response.json.endpoints.includes("GET /v1/tags/:id"));
  assert.ok(response.json.endpoints.includes("GET /v1/tags/:id/works"));
});

test("profile/get exposes reading-derived tags and signal with workId links them", async () => {
  const handler = createDevCloudRequestHandler();
  // Resolve + index a paper so it has canonical tags.
  const resolve = await invokeHandler({
    body: JSON.stringify({
      sessionId: "test-session-1",
      identities: [{ kind: "doi", value: "10.1/profile-tag-endpoint" }],
      title: "ColBERT Dense Retrieval"
    }),
    handler,
    method: "POST",
    url: "/v1/works/resolve"
  });
  const workId = resolve.json.work.id;
  await invokeHandler({
    body: JSON.stringify({ title: "ColBERT Dense Retrieval" }),
    handler,
    method: "POST",
    url: `/v1/works/${workId}/index`
  });

  await enablePersonalization(handler);
  // Open the paper: signal carries workId so the work's tags land in the profile.
  const signal = await invokeHandler({
    body: JSON.stringify({
      sessionId: "test-session-1",
      signal: { kind: "paper_opened", title: "ColBERT Dense Retrieval", workId }
    }),
    handler,
    method: "POST",
    url: "/v1/personalization/signal"
  });
  assert.equal(signal.statusCode, 200);
  const colbert = signal.json.tags.find((tag) => tag.label === "colbert");
  assert.ok(colbert, "colbert tag surfaced in profile");
  assert.ok(colbert.tagId, "colbert tag linked to canonical tag id");

  // profile/get also exposes the tags.
  const profile = await invokeHandler({
    body: JSON.stringify({ sessionId: "test-session-1" }),
    handler,
    method: "POST",
    url: "/v1/profile/get"
  });
  assert.ok(profile.json.tags.some((tag) => tag.label === "colbert"));
});

test("signal with invalid workId still records title-derived tags", async () => {
  const handler = createDevCloudRequestHandler();
  await enablePersonalization(handler);
  const signal = await invokeHandler({
    body: JSON.stringify({
      sessionId: "test-session-1",
      signal: { kind: "paper_opened", title: "神经信息检索方法", workId: "bad id" }
    }),
    handler,
    method: "POST",
    url: "/v1/personalization/signal"
  });
  assert.equal(signal.statusCode, 200);
  assert.ok(signal.json.tags.some((tag) => tag.label === "神经"));
  assert.equal(signal.json.tags[0].tagId, null);
});

test("tag-driven recommendation surfaces candidates with surfacing tag provenance", async () => {
  const stubSources = {
    colbert: [
      { id: "openalex:W100", provider: "openalex", relation: "topic_search", relevance: 0.9, title: "ColBERTv2 Passage Search", url: "https://openalex.org/W100" }
    ],
    retrieval: [
      { id: "openalex:W101", provider: "openalex", relation: "topic_search", relevance: 0.85, title: "Dense Retrieval Survey", url: "https://openalex.org/W101" }
    ]
  };
  const stubSearch = async (queryInput) => {
    const key = typeof queryInput?.query === "string" ? queryInput.query : "";
    return { sources: stubSources[key] ?? [] };
  };

  const handler = createDevCloudRequestHandler({
    crossrefEnabled: false,
    recommendationMode: "live",
    searchExternalKnowledge: stubSearch
  });

  await enablePersonalization(handler);
  // Give the user reading-derived tags.
  await invokeHandler({
    body: JSON.stringify({
      sessionId: "test-session-1",
      signal: { kind: "paper_opened", title: "ColBERT Retrieval" }
    }),
    handler,
    method: "POST",
    url: "/v1/personalization/signal"
  });

  // No selectedDocuments: recommendation is driven purely by user top tags.
  const response = await invokeHandler({
    body: JSON.stringify({ sessionId: "test-session-1" }),
    handler,
    method: "POST",
    url: "/v1/recommendations"
  });
  assert.equal(response.statusCode, 200);
  assert.ok(response.json.recommendations.length > 0);
  const colbertv2 = response.json.recommendations.find((r) => r.canonicalId === "openalex:W100");
  assert.ok(colbertv2, "colbert-tagged candidate should be surfaced");
  assert.deepEqual(colbertv2.surfacingTags, ["colbert"]);
});

test("recommendations returns empty when no selected documents and no user tags", async () => {
  const handler = createDevCloudRequestHandler({
    crossrefEnabled: false,
    recommendationMode: "live",
    searchExternalKnowledge: async () => ({ sources: [] })
  });
  const response = await invokeHandler({
    body: JSON.stringify({ sessionId: "test-session-1" }),
    handler,
    method: "POST",
    url: "/v1/recommendations"
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json.recommendations, []);
});
