import assert from "node:assert/strict";
import test from "node:test";
import { createIdentityVerifier } from "./identityVerifier.mjs";

test("identity verification fails closed when the identity endpoint is missing", async () => {
  const verify = createIdentityVerifier({ endpoint: "" });
  await assert.rejects(() => verify("token"), (error) => {
    assert.equal(error.code, "IDENTITY_SERVICE_UNAVAILABLE");
    assert.equal(error.statusCode, 503);
    return true;
  });
});

test("identity verification always requests and validates the Intuecho audience", async () => {
  let requestBody;
  const verify = createIdentityVerifier({
    endpoint: "http://identity.test/",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        session: { audience: "liteasy-desktop", userId: "user-1", name: "User" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  await assert.rejects(() => verify("secure-token"), (error) => error.code === "INVALID_IDENTITY_RESPONSE");
  assert.deepEqual(requestBody, { sessionId: "secure-token", audience: "intuecho-web" });
});

test("a valid Intuecho session becomes the request identity", async () => {
  const verify = createIdentityVerifier({
    endpoint: "http://identity.test",
    fetchImpl: async () => new Response(JSON.stringify({
      session: { audience: "intuecho-web", userId: "user-1", name: "研究者" }
    }), { status: 200, headers: { "Content-Type": "application/json" } })
  });

  assert.deepEqual(await verify("secure-token"), { id: "user-1", name: "研究者", initials: "研究" });
});

test("admin verification uses a bearer admin session and validates its audience", async () => {
  let received;
  const verify = createIdentityVerifier({
    endpoint: "http://identity.test",
    endpointPath: "/v1/admin/session",
    expectedAudience: "liteasy-admin",
    useBearer: true,
    fetchImpl: async (url, init) => {
      received = { authorization: init.headers.Authorization, url };
      return new Response(JSON.stringify({
        session: { audience: "liteasy-admin", userId: "admin-1", name: "Admin" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  assert.equal((await verify("admin-token")).id, "admin-1");
  assert.deepEqual(received, {
    authorization: "Bearer admin-token",
    url: "http://identity.test/v1/admin/session"
  });
});
