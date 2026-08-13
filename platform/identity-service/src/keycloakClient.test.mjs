import assert from "node:assert/strict";
import test from "node:test";
import { KeycloakClient } from "./keycloakClient.mjs";

const config = {
  apiUrl: "https://identity.test/admin/realms/liteasy",
  clientId: "liteasy-keycloak-admin",
  clientSecret: "admin-secret-value",
  tokenUrl: "https://identity.test/realms/liteasy/protocol/openid-connect/token"
};

function mockFetch(responses, calls) {
  return async (url, options) => {
    calls.push({ options, url });
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch");
    return response;
  };
}

test("disables a user, logs out every Keycloak session, and confirms the state", async () => {
  const calls = [];
  const client = new KeycloakClient(config, { fetchImpl: mockFetch([
    new Response(JSON.stringify({ access_token: "admin-token" })),
    new Response(JSON.stringify({ enabled: true, id: "subject-1" })),
    new Response(null, { status: 204 }),
    new Response(null, { status: 204 }),
    new Response(JSON.stringify({ enabled: false, id: "subject-1" }))
  ], calls) });
  const result = await client.setStatus("subject-1", "disabled");
  assert.equal(result.allSessionsRevoked, true);
  assert.deepEqual(result.revokedAudiences, ["intuecho-web", "liteasy-admin", "liteasy-desktop"]);
  assert.equal(calls[3].url, `${config.apiUrl}/users/subject-1/logout`);
  assert.equal(calls[3].options.method, "POST");
});

test("treats an already absent subject as the idempotent deleted state", async () => {
  const calls = [];
  const client = new KeycloakClient(config, { fetchImpl: mockFetch([
    new Response(JSON.stringify({ access_token: "admin-token" })),
    new Response(null, { status: 404 }),
    new Response(null, { status: 404 })
  ], calls) });
  const result = await client.setStatus("subject-2", "deleted");
  assert.equal(result.status, "deleted");
  assert.equal(result.allSessionsRevoked, true);
  assert.equal(calls.some((call) => call.options.method === "DELETE"), false);
});

test("does not claim revocation when activating an account", async () => {
  const client = new KeycloakClient(config, { fetchImpl: mockFetch([
    new Response(JSON.stringify({ access_token: "admin-token" })),
    new Response(JSON.stringify({ enabled: false, id: "subject-3" })),
    new Response(null, { status: 204 }),
    new Response(JSON.stringify({ enabled: true, id: "subject-3" }))
  ], []) });
  const result = await client.setStatus("subject-3", "active");
  assert.equal(result.allSessionsRevoked, false);
  assert.deepEqual(result.revokedAudiences, []);
});

test("lists a bounded account page with only approved identity fields", async () => {
  const calls = [];
  const client = new KeycloakClient(config, { fetchImpl: mockFetch([
    new Response(JSON.stringify({ access_token: "admin-token" })),
    new Response(JSON.stringify([{
      access: { manage: true },
      attributes: { private: ["hidden"] },
      createdTimestamp: 1786492800000,
      email: "reader@example.com",
      emailVerified: true,
      enabled: true,
      firstName: "Lin",
      id: "subject-4",
      lastName: "Qiao",
      username: "reader@example.com"
    }])),
    new Response(JSON.stringify(1))
  ], calls) });
  const result = await client.listAccounts({ first: 50, max: 25, search: "reader" });
  assert.deepEqual(result, {
    accounts: [{
      accountType: "person",
      createdAt: "2026-08-12T00:00:00.000Z",
      email: "reader@example.com",
      emailVerified: true,
      enabled: true,
      firstName: "Lin",
      lastName: "Qiao",
      subjectId: "subject-4",
      username: "reader@example.com"
    }],
    first: 50,
    max: 25,
    search: "reader",
    total: 1
  });
  assert.match(calls[1].url, /\/users\?/);
  assert.equal(new URL(calls[1].url).searchParams.get("briefRepresentation"), "true");
  assert.equal(new URL(calls[1].url).searchParams.get("search"), "reader");
  assert.match(calls[1].options.headers.authorization, /^Bearer /);
  assert.match(calls[2].url, /\/users\/count\?search=reader$/);
  assert.equal("attributes" in result.accounts[0], false);
});
