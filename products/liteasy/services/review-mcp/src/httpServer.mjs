import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createReviewServer } from "./reviewServer.mjs";

export function createReviewHttpServer({ token, allowedHosts, allowedOrigins = [], readDesktop }) {
  if (typeof token !== "string" || token.length < 32 || /\s/.test(token)) throw new Error("A private token of at least 32 non-whitespace characters is required.");
  if (!allowedHosts?.length) throw new Error("An explicit Host allowlist is required.");
  const expected = Buffer.from(`Bearer ${token}`);
  let active = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const fail = (status, message) => { res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }); res.end(message); };
    if (req.url !== "/mcp") { fail(404, "Not found"); return; }
    if (!allowedHosts.includes(req.headers.host) || (req.headers.origin && !allowedOrigins.includes(req.headers.origin))) {
      fail(403, "Untrusted Host or Origin"); return;
    }
    const supplied = Buffer.from(req.headers.authorization ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.setHeader("WWW-Authenticate", "Bearer"); fail(401, "Authentication required"); return;
    }
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); fail(405, "Use stateless MCP POST requests"); return; }
    if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) { fail(415, "JSON required"); return; }
    if (active >= 16) { fail(503, "Busy; retry later"); return; }
    active++;
    const abort = new AbortController();
    const deadline = setTimeout(() => { abort.abort(); if (!res.writableEnded) res.destroy(); }, 15_000);
    let mcp;
    let transport;
    const close = () => { abort.abort(); void transport?.close(); void mcp?.close(); };
    res.once("close", close);
    try {
      let size = 0;
      const chunks = [];
      for await (const data of req) {
        size += data.length;
        if (size > 16_384) { fail(413, "Request too large"); return; }
        chunks.push(data);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { fail(400, "Invalid JSON"); return; }
      mcp = createReviewServer((input) => readDesktop(input, { signal: abort.signal }));
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent && !res.destroyed) fail(500, "Review connection failed");
    } finally {
      clearTimeout(deadline);
      active--;
      close();
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  return server;
}
