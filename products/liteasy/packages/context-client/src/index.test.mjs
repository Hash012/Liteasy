import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { ContextClient, normalizeContextOrigin } from "./index.mjs";
const version = "liteasy.context-api/v1";
test("SDK uses the host transport and encodes Chinese filters without leaking credentials", async () => {
  let seen;
  const client = new ContextClient({ origin: "https://example.test", token: "synthetic-secret", transport: async (request) => {
    seen = request;
    return { status: 200, json: async () => ({ schemaVersion: version, entries: [], nextCursor: null }) };
  } });
  await client.list({ scopes: ["personal", "project/gpu"], query: "GPU 压缩", tags: ["学习"] });
  const url = new URL(seen.url);
  assert.deepEqual(url.searchParams.getAll("scope"), ["personal", "project/gpu"]);
  assert.equal(url.searchParams.get("query"), "GPU 压缩");
  assert.equal(seen.headers.authorization, "Bearer synthetic-secret");
  assert.equal(seen.url.includes("synthetic-secret"), false);
});
test("distinguishes conflict, network failure and a malformed success response", async () => {
  const base = { origin: "https://example.test", token: "synthetic-secret" };
  await assert.rejects(new ContextClient({ ...base, transport: async () => ({ status: 409, json: async () => ({ schemaVersion: version, error: { code: "context_revision_conflict", currentRevision: 3, requestId: "trace" } }) }) }).whoami(), { code: "context_revision_conflict", currentRevision: 3, status: 409 });
  await assert.rejects(new ContextClient({ ...base, transport: async () => { throw new Error("synthetic-secret should not escape"); } }).whoami(), (error) => error.code === "context_network_unavailable" && !error.message.includes("synthetic-secret"));
  await assert.rejects(new ContextClient({ ...base, transport: async () => ({ status: 200, json: async () => ({ schemaVersion: version }) }) }).whoami(), { code: "context_protocol_invalid" });
});
test("rejects unsafe origins and never follows redirects with a bearer credential", async () => {
  for (const origin of ["http://example.test", "https://user:password@example.test", "https://example.test/other", "https://example.test/?token=x"]) assert.throws(() => normalizeContextOrigin(origin));
  const client = new ContextClient({ origin: "https://example.test", token: "synthetic-secret", transport: async () => { throw new Error("must not call"); } });
  await assert.rejects(client.request("GET", "/v1/context/%2e%2e/account"), { code: "context_path_invalid" });
  const server = http.createServer((_request, response) => { response.writeHead(302, { location: "https://example.test/receive" }); response.end(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await assert.rejects(new ContextClient({ origin: `http://127.0.0.1:${server.address().port}`, token: "synthetic-secret" }).whoami(), { code: "context_network_unavailable" }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
});
