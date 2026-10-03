import { createServer } from "node:http";

// Test-only transport. It deliberately does not stand in for PostgreSQL, an IdP,
// server authorization tests, or the repository's real command ledger tests.
export async function createCommunityFixture() {
  const state = {
    requests: [], commands: new Map(), hidden: new Set(), revoked: false,
    failNextPage: false, delayNextPage: null, loseNextCreate: false, lostCreateOperations: new Set(),
    holdNextLookup: null, holdNextCreate: null, malformedLookup: false, missingLookups: false,
    commits: 0, events: 0
  };
  const session = {
    audience: "intuecho-web", userId: "industrial-browser-user", name: "浏览器验收用户",
    email: "synthetic@example.invalid", sessionId: "synthetic-loopback-session",
    expiresAt: "2099-01-01T00:00:00.000Z"
  };
  const annotation = (index, body = `授权合成批注 ${String(index).padStart(2, "0")}`) => ({
    id: `fixture-annotation-${index}`, body, revision: 1, visibility: "public",
    author: { id: session.userId, initials: "验收", name: session.name,
      profile: { educationStage: null, institutions: [] } },
    createdAt: "2026-10-03T00:00:00.000Z", updatedAt: "2026-10-03T00:00:00.000Z",
    organizationId: null, originalReply: null, ratingAverage: null, ratingCount: 0,
    shareToPlaza: true, tags: [], targets: [], viewerCanModerate: false,
    viewerIsAuthor: true, viewerSaved: false, viewerRating: null, withdrawnAt: null
  });
  const entries = Array.from({ length: 65 }, (_, index) => annotation(index + 1));
  const send = (response, status, body) => {
    response.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization,content-type", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" });
    response.end(JSON.stringify(body));
  };
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "OPTIONS") return send(response, 204, {});
      const url = new URL(request.url, "http://127.0.0.1");
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = raw ? JSON.parse(raw) : undefined;
      state.requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams),
        method: request.method, authenticated: request.headers.authorization === `Bearer ${session.sessionId}`, body });
      const path = url.pathname;
      if (path === "/v1/identity/web-config") return send(response, 404, { error: "DEVELOPMENT_ONLY" });
      if (path === "/v1/account/session" || path === "/v1/account/login") {
        return state.revoked ? send(response, 401, { error: "SESSION_REVOKED" }) : send(response, 200, { session });
      }
      if (path === "/v1/account/logout") return send(response, 200, { ok: true });
      if (state.revoked && request.headers.authorization) return send(response, 401, { error: "SESSION_REVOKED", message: "合成会话已撤销" });
      if (path === "/v1/me/community-preferences") return send(response, 200, { preferences: [] });
      if (path === "/v1/conversations") return send(response, 200, { conversations: [] });
      if (path === "/v1/me/academic-profile") return send(response, 200, { profile: { educationStage: null, institutions: [], revision: 1 } });
      if (path === "/v1/me/organizations") return send(response, 200, { organizations: [] });
      if (path === "/v1/plaza" || path === "/v1/plaza/page") {
        const delay = state.delayNextPage;
        state.delayNextPage = null;
        if (delay) { delay.entered(); await delay.wait; }
        if (state.failNextPage) { state.failNextPage = false; return send(response, 503, { error: "TEMPORARY_UNAVAILABLE", message: "合成暂时故障，请重试" }); }
        const query = url.searchParams.get("query") ?? "";
        let filtered = query ? entries.filter((item) => item.body.includes(query)) : entries;
        if (!request.headers.authorization) filtered = [];
        if (path === "/v1/plaza") return send(response, 200, { annotations: filtered, filters: Object.fromEntries(url.searchParams) });
        const start = Number(url.searchParams.get("cursor")?.replace("fixture-cursor-", "") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 30);
        return send(response, 200, { annotations: filtered.slice(start, start + limit),
          nextCursor: start + limit < filtered.length ? `fixture-cursor-${start + limit}` : null });
      }
      if (path === "/v1/annotations" && request.method === "POST") {
        const hold = state.holdNextCreate;
        state.holdNextCreate = null;
        if (hold) { hold.entered(); await hold.wait; }
        const command = body.command;
        let stored = state.commands.get(command.operationId);
        if (!stored) {
          const created = annotation(`created-${state.commits + 1}`, body.body);
          stored = { annotation: created, receipt: { ...command, operationType: "create_annotation",
            resourceId: created.id, committedAt: new Date().toISOString() } };
          state.commands.set(command.operationId, stored);
          state.commits += 1; state.events += 1;
        }
        if (state.loseNextCreate) { state.loseNextCreate = false; state.lostCreateOperations.add(command.operationId); }
        // Chromium may retry a reset connection once. Keep dropping this intent's
        // responses while retaining a single committed receipt in the fixture.
        if (state.lostCreateOperations.has(command.operationId)) { response.destroy(); return; }
        return send(response, 200, { annotation: stored.annotation });
      }
      if (path.startsWith("/v1/community-commands/")) {
        const hold = state.holdNextLookup;
        state.holdNextLookup = null;
        if (hold) { hold.entered(); await hold.wait; }
        if (state.malformedLookup) return send(response, 200, {});
        const stored = state.missingLookups ? undefined : state.commands.get(decodeURIComponent(path.split("/").at(-1)));
        return send(response, 200, stored ? { status: "committed", receipt: stored.receipt,
          available: !state.hidden.has(stored.annotation.id) } : { status: "not_found" });
      }
      if (/^\/v1\/annotations\/[^/]+\/replies$/.test(path)) return send(response, 200, { replies: [] });
      if (/^\/v1\/annotations\/[^/]+$/.test(path)) {
        const id = decodeURIComponent(path.split("/").at(-1));
        if (state.hidden.has(id) || !request.headers.authorization) return send(response, 404, { error: "ANNOTATION_NOT_FOUND", message: "当前内容不可访问" });
        const found = entries.find((item) => item.id === id) ?? [...state.commands.values()].find((item) => item.annotation.id === id)?.annotation;
        return found ? send(response, 200, { annotation: found }) : send(response, 404, { error: "ANNOTATION_NOT_FOUND" });
      }
      return send(response, 404, { error: "UNIMPLEMENTED_SYNTHETIC_ROUTE", path });
    } catch (error) { send(response, 500, { error: "FIXTURE_FAILURE", message: error.message }); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { state, session: { ...session, issuer: origin }, origin,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

export function deferredFixtureRequest() {
  let entered, release;
  const started = new Promise((resolve) => { entered = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  return { entered, release, started, wait };
}
