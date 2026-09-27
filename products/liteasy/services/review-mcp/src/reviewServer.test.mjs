import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { request as httpRequest } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { createReviewHttpServer } from "./httpServer.mjs";
import { createDesktopRunner, desktopSocketPath } from "./desktopRunner.mjs";

const token = "test-only-token-which-is-long-enough";
const reviewId = "51c074bd-24d5-45a3-82e5-a1e424bf1539";

test("stdio entrypoint can be initialized by a tunnel and reports an offline desktop honestly", async (t) => {
  const client = new Client({ name: "stdio-test", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL("./main.mjs", import.meta.url)), "--stdio"],
    env: { LITEASY_AGENT_SOCKET: "/nonexistent-liteasy-review-test.sock" }, stderr: "pipe" });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 4);
  assert.equal((await client.callTool({ name: "liteasy_review_current", arguments: {} })).isError, true);
});
async function fixture(t, readDesktop) {
  const allowedHosts = ["127.0.0.1"];
  const server = createReviewHttpServer({ token, allowedHosts, readDesktop });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  allowedHosts.push(`127.0.0.1:${server.address().port}`);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const client = new Client({ name: "review-test", version: "1" });
  const headers = { Authorization: `Bearer ${token}` };
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  t.after(() => client.close());
  return { client, url, headers };
}

test("real HTTP MCP client lists only read tools; schema failures never reach the desktop", async (t) => {
  const calls = [];
  const { client } = await fixture(t, async (input) => { calls.push(input); return { reviewId, totalComments: 1 }; });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 4);
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint));
  assert.equal((await client.callTool({ name: "liteasy_review_current", arguments: {} })).structuredContent.reviewId, reviewId);
  for (const request of [
    { name: "liteasy_agent_turn", arguments: { message: "run a model" } },
    { name: "liteasy_review_comments", arguments: { reviewId, offset: -1 } },
    { name: "liteasy_review_current", arguments: { operation: "cli" } },
  ]) assert.equal((await client.callTool(request)).isError, true);
  assert.deepEqual(calls, [{ operation: "current" }]);
});

test("every request requires authentication and trusted Host/Origin, including initialization", async (t) => {
  const { url, headers } = await fixture(t, async () => ({}));
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const request = (overrides, requestBody = body) => fetch(url, { method: "POST", headers: { ...headers,
    "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...overrides }, body: requestBody });
  assert.equal((await request({ Authorization: "Bearer wrong" })).status, 401);
  assert.equal((await request({ Origin: "https://untrusted.example" })).status, 403);
  // fetch controls Host itself; exercise DNS-rebinding protection on the actual wire.
  const untrustedStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: "POST", headers: { ...headers, Host: "untrusted.example" } }, (res) => {
      res.resume(); resolve(res.statusCode);
    });
    req.on("error", reject); req.end(body);
  });
  assert.equal(untrustedStatus, 403);
  assert.equal((await request({}, "x".repeat(17_000))).status, 413);
  assert.equal((await fetch(`${url}?token=${token}`, { headers })).status, 404);
});

test("MCP connects through the exact desktop wire protocol; revocation and unavailable host are real errors", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "liteasy-review-"));
  const socketPath = join(directory, "agent.sock");
  let shared = true;
  const sockets = new Set();
  const desktop = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (part) => {
      buffer += part;
      if (!buffer.includes("\n")) return;
      const input = JSON.parse(buffer.trim());
      assert.equal(input.kind, "paper_review");
      assert.equal(typeof input.request_id, "string");
      socket.end(`${JSON.stringify(shared ? { ok: true, value: { reviewId, comments: [{ comment: "用户疑问", page: 2 }] } }
        : { ok: false, error: "review_not_shared" })}\n`);
    });
  });
  desktop.listen(socketPath);
  await once(desktop, "listening");
  t.after(async () => { sockets.forEach((socket) => socket.destroy()); desktop.close(); await rm(directory, { recursive: true, force: true }); });
  const readDesktop = createDesktopRunner({ socketPath });
  const { client } = await fixture(t, readDesktop);
  const result = await client.callTool({ name: "liteasy_review_comments", arguments: { reviewId } });
  assert.equal(result.structuredContent.comments[0].comment, "用户疑问");
  shared = false;
  assert.equal((await client.callTool({ name: "liteasy_review_current", arguments: {} })).isError, true);
  await assert.rejects(createDesktopRunner({ socketPath: join(directory, "missing") })({ operation: "current" }), /desktop_unavailable/);
});

test("runner deadlines and cancellation release the socket without retrying", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "liteasy-review-"));
  const socketPath = join(directory, "agent.sock");
  const sockets = new Set();
  const desktop = createServer((socket) => { sockets.add(socket); socket.on("data", () => {}); socket.on("close", () => sockets.delete(socket)); });
  desktop.listen(socketPath);
  await once(desktop, "listening");
  t.after(async () => { sockets.forEach((socket) => socket.destroy()); desktop.close(); await rm(directory, { recursive: true, force: true }); });
  await assert.rejects(createDesktopRunner({ socketPath, timeoutMs: 30 })({ operation: "current" }), /desktop_timeout/);
  const abort = new AbortController();
  const read = createDesktopRunner({ socketPath })({ operation: "current" }, { signal: abort.signal });
  abort.abort();
  await assert.rejects(read, /review_cancelled/);
  assert.throws(() => desktopSocketPath({}, "win32"), /Windows/);
});
