import assert from "node:assert/strict";
import test from "node:test";
import {
  createIdentityVerifier,
  IdentityError,
  requireFreshMfa,
  verifyIdentityProviderReadiness
} from "./identityVerifier.mjs";

function identityConfig() {
  return {
    clientId: "liteasy-cloud",
    clientSecret: "secret",
    discoveryUrl: "https://identity.example/.well-known/openid-configuration",
    introspectionUrl: "https://identity.example/introspect",
    issuer: "https://identity.example",
    jwksUrl: "https://identity.example/jwks",
    revocationUrl: "https://identity.example/revoke",
    tokenUrl: "https://identity.example/token"
  };
}

function verifier(overrides = {}) {
  return createIdentityVerifier(identityConfig(), {
    fetchImpl: async (_url, request) => {
      assert.match(request.headers.authorization, /^Basic /);
      return { ok: true, async json() { return { active: true, aud: "liteasy-desktop", sub: "user_1" }; } };
    },
    jwks: {},
    verifyJwt: async () => ({ payload: {
      amr: ["pwd"], aud: "liteasy-desktop", auth_time: 100, exp: 200, iat: 100,
      iss: "https://identity.example", roles: ["user"], scope: "library:read library:write",
      sid: "session_1", sub: "user_1"
    } }),
    ...overrides
  });
}

test("derives the user identity from a signed, active audience-bound token", async () => {
  assert.deepEqual(await verifier().verifyAuthorizationHeader("Bearer signed-token", "liteasy-desktop"), {
    adminMfaVerified: false,
    audience: "liteasy-desktop",
    authTime: 100,
    authenticationMethods: ["pwd"],
    roles: ["user"],
    scopes: ["library:read", "library:write"],
    sessionId: "session_1",
    subject: "user_1",
    token: "signed-token"
  });
});

test("rejects missing, invalid, revoked and cross-audience tokens", async () => {
  await assert.rejects(() => verifier().verifyAuthorizationHeader(undefined, "liteasy-desktop"), /authentication_required/);
  await assert.rejects(
    () => verifier({ verifyJwt: async () => { throw new Error("bad signature"); } })
      .verifyAuthorizationHeader("Bearer bad", "liteasy-desktop"),
    /access_token_invalid/
  );
  await assert.rejects(
    () => verifier({ fetchImpl: async () => ({ ok: true, async json() { return { active: false }; } }) })
      .verifyAuthorizationHeader("Bearer revoked", "liteasy-desktop"),
    /session_revoked/
  );
  await assert.rejects(
    () => verifier({ fetchImpl: async () => ({ ok: true, async json() { return { active: true, aud: "liteasy-admin", sub: "user_1" }; } }) })
      .verifyAuthorizationHeader("Bearer wrong-audience", "liteasy-desktop"),
    /access_token_audience_mismatch/
  );
});

test("requires a dedicated client and scope for Intuecho service authorization", async () => {
  const serviceVerifier = verifier({
    fetchImpl: async () => ({ ok: true, async json() { return {
      active: true,
      aud: "liteasy-internal",
      client_id: "intuecho-organization-service",
      scope: "organization:authorize",
      sub: "intuecho-service"
    }; } }),
    verifyJwt: async () => ({ payload: {
      aud: "liteasy-internal",
      exp: 200,
      iat: 100,
      iss: "https://identity.example",
      sub: "intuecho-service"
    } })
  });
  const identity = await serviceVerifier.verifyServiceAuthorizationHeader("Bearer service-token", {
    clientId: "intuecho-organization-service",
    requiredScope: "organization:authorize"
  });
  assert.equal(identity.audience, "liteasy-internal");
  assert.equal(identity.clientId, "intuecho-organization-service");
  await assert.rejects(
    () => serviceVerifier.verifyServiceAuthorizationHeader("Bearer service-token", {
      clientId: "another-client",
      requiredScope: "organization:authorize"
    }),
    /service_client_mismatch/
  );
  await assert.rejects(
    () => serviceVerifier.verifyServiceAuthorizationHeader("Bearer service-token", {
      clientId: "intuecho-organization-service",
      requiredScope: "organization:write"
    }),
    /service_scope_required/
  );
});

test("requires recent MFA for high-risk administrator operations", () => {
  const identity = { adminMfaVerified: true, audience: "liteasy-admin", authTime: 1_000, authenticationMethods: ["mfa"] };
  assert.equal(requireFreshMfa(identity, { nowSeconds: 1_100 }), identity);
  assert.throws(() => requireFreshMfa({ ...identity, adminMfaVerified: false }, { nowSeconds: 1_100 }), IdentityError);
  assert.throws(() => requireFreshMfa(identity, { nowSeconds: 1_400 }), /fresh_authentication_required/);
  assert.throws(() => requireFreshMfa({ ...identity, audience: "liteasy-desktop" }, { nowSeconds: 1_100 }), /admin_audience_required/);
});

test("derives the administrator MFA proof only from the dedicated signed claim", async () => {
  const admin = verifier({
    fetchImpl: async () => ({ ok: true, async json() { return {
      active: true, aud: "liteasy-admin", sub: "admin_1"
    }; } }),
    verifyJwt: async () => ({ payload: {
      amr: ["pwd"], aud: "liteasy-admin", auth_time: 1_000, exp: 2_000, iat: 1_000,
      iss: "https://identity.example", liteasy_admin_mfa: true, sub: "admin_1"
    } })
  });

  const identity = await admin.verifyAuthorizationHeader("Bearer admin-token", "liteasy-admin");
  assert.equal(identity.adminMfaVerified, true);
  assert.deepEqual(identity.authenticationMethods, ["pwd", "mfa"]);
});

test("verifies OIDC discovery, introspection authentication and signing keys before readiness", async () => {
  const config = identityConfig();
  const result = await verifyIdentityProviderReadiness(config, async (url) => {
    if (url === config.discoveryUrl) return { ok: true, async json() { return {
      id_token_signing_alg_values_supported: ["RS256"],
      introspection_endpoint: config.introspectionUrl,
      introspection_endpoint_auth_methods_supported: ["client_secret_basic"],
      issuer: config.issuer,
      jwks_uri: config.jwksUrl,
      revocation_endpoint: config.revocationUrl,
      token_endpoint: config.tokenUrl,
      token_endpoint_auth_methods_supported: ["client_secret_basic"]
    }; } };
    return { ok: true, async json() { return { keys: [{ kid: "key-1", kty: "RSA", use: "sig" }] }; } };
  });
  assert.deepEqual(result, { discovery: true, jwks: true });
  await assert.rejects(
    () => verifyIdentityProviderReadiness(config, async () => ({ ok: true, async json() { return {}; } })),
    /identity_discovery_mismatch/
  );
});
