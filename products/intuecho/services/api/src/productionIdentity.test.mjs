import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductionIdentityVerifier,
  ProductionIdentityError,
  requireFreshAdminMfa,
  verifyIntuechoIdentityReadiness
} from "./productionIdentity.mjs";

const config = {
  clientId: "intuecho-api",
  clientSecret: "secret",
  discoveryUrl: "https://identity.test/.well-known/openid-configuration",
  introspectionUrl: "https://identity.test/introspect",
  issuer: "https://identity.test",
  jwksUrl: "https://identity.test/jwks"
};

function verifier(overrides = {}) {
  return createProductionIdentityVerifier(config, {
    fetchImpl: async (_url, request) => {
      assert.match(request.headers.authorization, /^Basic /);
      return { ok: true, async json() { return { active: true, aud: "intuecho-web", sub: "user-1" }; } };
    },
    jwks: {},
    verifyJwt: async () => ({ payload: {
      amr: ["pwd"], aud: "intuecho-web", auth_time: 100, exp: 200, iat: 100,
      iss: config.issuer, name: "同名研究者", sid: "session-1", sub: "user-1"
    } }),
    ...overrides
  });
}

test("verifies a signed, active intuecho-web token and derives the stable subject", async () => {
  const identity = await verifier().verifyAuthorizationHeader("Bearer signed-token", "intuecho-web");
  assert.equal(identity.subject, "user-1");
  assert.equal(identity.name, "同名研究者");
  assert.equal(identity.token, "signed-token");
});

test("rejects revoked, cross-audience and nameless Web tokens", async () => {
  await assert.rejects(
    () => verifier({ fetchImpl: async () => ({ ok: true, async json() { return { active: false }; } }) })
      .verifyAuthorizationHeader("Bearer revoked", "intuecho-web"),
    /session_revoked/
  );
  await assert.rejects(
    () => verifier({ fetchImpl: async () => ({ ok: true, async json() { return { active: true, aud: "liteasy-desktop", sub: "user-1" }; } }) })
      .verifyAuthorizationHeader("Bearer wrong", "intuecho-web"),
    /access_token_audience_mismatch/
  );
  await assert.rejects(
    () => verifier({ verifyJwt: async () => ({ payload: { sub: "user-1" } }) })
      .verifyAuthorizationHeader("Bearer nameless", "intuecho-web"),
    /identity_display_name_missing/
  );
});

test("requires recent MFA for forum moderation", () => {
  const identity = {
    audience: "liteasy-admin",
    authTime: 1_000,
    authenticationMethods: ["pwd", "mfa"]
  };
  assert.equal(requireFreshAdminMfa(identity, { nowSeconds: 1_100 }), identity);
  assert.throws(
    () => requireFreshAdminMfa({ ...identity, authenticationMethods: ["pwd"] }, { nowSeconds: 1_100 }),
    ProductionIdentityError
  );
  assert.throws(
    () => requireFreshAdminMfa(identity, { nowSeconds: 1_400 }),
    /fresh_authentication_required/
  );
});

test("checks OIDC discovery, introspection auth and signing keys at readiness", async () => {
  const result = await verifyIntuechoIdentityReadiness(config, async (url) => {
    if (url === config.discoveryUrl) return { ok: true, async json() { return {
      id_token_signing_alg_values_supported: ["RS256"],
      introspection_endpoint: config.introspectionUrl,
      introspection_endpoint_auth_methods_supported: ["client_secret_basic"],
      issuer: config.issuer,
      jwks_uri: config.jwksUrl
    }; } };
    return { ok: true, async json() { return { keys: [{ kid: "key-1", kty: "RSA", use: "sig" }] }; } };
  });
  assert.deepEqual(result, { discovery: true, jwks: true });
});
