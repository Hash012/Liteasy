import assert from "node:assert/strict";
import test from "node:test";
import { authorizeManagementRequest } from "./authorization.mjs";

const config = {
  audience: "liteasy-identity-management",
  callerClientId: "liteasy-account-lifecycle",
  issuer: "https://identity.test/realms/liteasy",
  verifier: {
    clientId: "liteasy-identity-introspection",
    clientSecret: "introspection-secret-value",
    url: "https://identity.test/introspect"
  }
};

test("authorizes only the dedicated caller audience and both lifecycle scopes", async () => {
  let request;
  const identity = await authorizeManagementRequest("Bearer caller-token", config, async (url, options) => {
    request = { options, url };
    return new Response(JSON.stringify({
      active: true,
      aud: ["liteasy-identity-management"],
      client_id: "liteasy-account-lifecycle",
      iss: config.issuer,
      scope: "accounts:write sessions:revoke"
    }), { status: 200 });
  });
  assert.equal(identity.clientId, "liteasy-account-lifecycle");
  assert.equal(request.url, config.verifier.url);
  assert.match(request.options.headers.authorization, /^Basic /);
  assert.equal(
    Buffer.from(request.options.headers.authorization.slice("Basic ".length), "base64").toString("utf8"),
    `${config.verifier.clientId}:${config.verifier.clientSecret}`
  );
  assert.equal(new URLSearchParams(request.options.body).get("token"), "caller-token");
});

test("fails closed for inactive, wrong-audience, wrong-client, and under-scoped tokens", async () => {
  const cases = [
    { active: false, aud: [config.audience], client_id: config.callerClientId, iss: config.issuer, scope: "accounts:write sessions:revoke" },
    { active: true, aud: [config.audience], client_id: config.callerClientId, iss: "https://wrong.test/realms/liteasy", scope: "accounts:write sessions:revoke" },
    { active: true, aud: ["liteasy-admin"], client_id: config.callerClientId, iss: config.issuer, scope: "accounts:write sessions:revoke" },
    { active: true, aud: [config.audience], client_id: "liteasy-cloud", iss: config.issuer, scope: "accounts:write sessions:revoke" },
    { active: true, aud: [config.audience], client_id: config.callerClientId, iss: config.issuer, scope: "accounts:write" }
  ];
  for (const body of cases) {
    await assert.rejects(
      () => authorizeManagementRequest("Bearer caller-token", config, async () => new Response(JSON.stringify(body))),
      /management_authorization_denied/
    );
  }
});
