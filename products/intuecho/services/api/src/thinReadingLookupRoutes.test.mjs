import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { registerAnnotationCommunityRoutes } from "./annotationCommunityRoutes.mjs";

const query = { annotationId: "local-1", queueKey: "artifact:local-1", updatedAt: "2026-10-03T01:00:00.000Z", payloadDigest: "a".repeat(64) };
function setup(t) {
  const calls = [];
  const app = Fastify();
  registerAnnotationCommunityRoutes(app, { lookupDesktopAnnotations: async (owner, queries) => {
    calls.push({ owner, queries });
    return queries.map((item) => ({ ...item, status: "matched", remoteAnnotationId: "remote-1", publicationRevision: 1 }));
  } }, { currentUser: () => null, requireAdmin: () => null, requireUser: () => null,
    requireDesktopUser: (request, reply) => request.headers.authorization === "Bearer synthetic-desktop"
      ? { id: "verified-owner" } : (reply.code(401).send({ error: "AUTH_REQUIRED" }), null) });
  t.after(() => app.close());
  return { app, calls };
}

test("lookup route requires desktop authentication and derives owner exclusively from that boundary", async (t) => {
  const { app, calls } = setup(t);
  const request = { method: "POST", url: "/v1/thin-reading/annotations:lookup", payload: { queries: [query] } };
  assert.equal((await app.inject(request)).statusCode, 401);
  assert.equal(calls.length, 0);
  const response = await app.inject({ ...request, headers: { authorization: "Bearer synthetic-desktop" } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().results[0].remoteAnnotationId, "remote-1");
  assert.deepEqual(calls, [{ owner: { id: "verified-owner" }, queries: [query] }]);
});

test("lookup route rejects body, owner and malformed digest additions without invoking publication", async (t) => {
  const { app, calls } = setup(t);
  for (const invalid of [{ ...query, body: "Do not publish" }, { ...query, ownerId: "another" }, { ...query, payloadDigest: "invalid" }]) {
    const response = await app.inject({ method: "POST", url: "/v1/thin-reading/annotations:lookup",
      headers: { authorization: "Bearer synthetic-desktop" }, payload: { queries: [invalid] } });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(calls.length, 0);
});
