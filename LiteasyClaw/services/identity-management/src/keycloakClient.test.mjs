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
