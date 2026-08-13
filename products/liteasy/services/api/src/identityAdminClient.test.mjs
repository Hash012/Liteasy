import assert from "node:assert/strict";
import test from "node:test";
import { IdentityAdminClient } from "./identityAdminClient.mjs";

const config = {
  managementClientId: "account-lifecycle",
  managementClientSecret: "secret",
  managementUrl: "https://identity-admin.test",
  tokenUrl: "https://identity.test/token"
};

function response(body, ok = true) {
  return { ok, async json() { return body; } };
}

test("requires explicit revocation confirmation for every product audience", async () => {
  const calls = [];
  const client = new IdentityAdminClient(config, { fetchImpl: async (url, request) => {
    calls.push({ request, url });
    if (url === config.tokenUrl) return response({ access_token: "service-token", token_type: "Bearer" });
    return response({
      allSessionsRevoked: true,
      revokedAudiences: ["liteasy-admin", "liteasy-desktop", "intuecho-web"],
      status: "disabled",
      subjectId: "user_1",
      updatedAt: "2026-08-07T00:00:00.000Z"
    });
  } });
  const result = await client.setAccountStatus({
    idempotencyKey: "disable-user-0001",
    reason: "Approved security suspension",
    status: "disabled",
    subjectId: "user_1",
    traceId: "trace_1"
  });
  assert.deepEqual(result.revokedAudiences, ["intuecho-web", "liteasy-admin", "liteasy-desktop"]);
  assert.match(calls[0].request.headers.authorization, /^Basic /);
  assert.equal(calls[1].request.headers["x-idempotency-key"], "disable-user-0001");
  assert.equal(JSON.parse(calls[1].request.body).status, "disabled");
});

test("fails closed when the identity provider omits one audience", async () => {
  const client = new IdentityAdminClient(config, { fetchImpl: async (url) => (
    url === config.tokenUrl
      ? response({ access_token: "service-token", token_type: "Bearer" })
      : response({
        allSessionsRevoked: true,
        revokedAudiences: ["liteasy-desktop", "liteasy-admin"],
        status: "deleted",
        subjectId: "user_1",
        updatedAt: "2026-08-07T00:00:00.000Z"
      })
  ) });
  await assert.rejects(() => client.setAccountStatus({
    idempotencyKey: "delete-user-0001",
    reason: "Approved account deletion",
    status: "deleted",
    subjectId: "user_1",
    traceId: "trace_1"
  }), /identity_session_revocation_unconfirmed/);
});

test("lists a validated account directory page through the management identity", async () => {
  const calls = [];
  const client = new IdentityAdminClient(config, { fetchImpl: async (url, request) => {
    calls.push({ request, url });
    if (url === config.tokenUrl) return response({ access_token: "service-token", token_type: "Bearer" });
    return response({
      accounts: [{
        accountType: "person",
        createdAt: "2026-08-12T00:00:00.000Z",
        email: "reader@example.com",
        emailVerified: true,
        enabled: true,
        firstName: "Lin",
        lastName: "Qiao",
        subjectId: "user_1",
        username: "reader@example.com"
      }],
      first: 0,
      max: 50,
      search: "reader",
      total: 1
    });
  } });
  const result = await client.listAccounts({ first: 0, max: 50, search: "reader" });
  assert.equal(result.accounts[0].subjectId, "user_1");
  assert.equal(new URL(calls[1].url).searchParams.get("search"), "reader");
  assert.equal(calls[1].request.headers.authorization, "Bearer service-token");
  assert.equal(new URLSearchParams(calls[0].request.body).get("scope"), "accounts:write sessions:revoke");
});
