import assert from "node:assert/strict";
import test from "node:test";
import { loadIdentityManagementConfig } from "./config.mjs";

function validEnv(overrides = {}) {
  return {
    IDENTITY_MANAGEMENT_ADMIN_API_URL: "http://keycloak:8080/admin/realms/liteasy",
    IDENTITY_MANAGEMENT_ADMIN_CLIENT_ID: "liteasy-keycloak-admin",
    IDENTITY_MANAGEMENT_ADMIN_CLIENT_SECRET: "admin-secret-value",
    IDENTITY_MANAGEMENT_ADMIN_TOKEN_URL: "http://keycloak:8080/realms/liteasy/protocol/openid-connect/token",
    IDENTITY_MANAGEMENT_AUDIENCE: "liteasy-identity-management",
    IDENTITY_MANAGEMENT_CALLER_CLIENT_ID: "liteasy-account-lifecycle",
    IDENTITY_MANAGEMENT_INTROSPECTION_CLIENT_ID: "liteasy-identity-introspection",
    IDENTITY_MANAGEMENT_INTROSPECTION_CLIENT_SECRET: "introspection-secret-value",
    IDENTITY_MANAGEMENT_INTROSPECTION_URL: "http://keycloak:8080/realms/liteasy/protocol/openid-connect/token/introspect",
    IDENTITY_MANAGEMENT_ISSUER: "http://keycloak:8080/realms/liteasy",
    NODE_ENV: "test",
    ...overrides
  };
}

test("loads separate caller, introspection, and Keycloak administrator clients", () => {
  const config = loadIdentityManagementConfig(validEnv());
  assert.equal(config.authorization.callerClientId, "liteasy-account-lifecycle");
  assert.equal(config.authorization.audience, "liteasy-identity-management");
  assert.equal(config.authorization.verifier.clientId, "liteasy-identity-introspection");
  assert.equal(config.admin.clientId, "liteasy-keycloak-admin");
});

test("rejects shared clients and insecure non-test endpoints", () => {
  assert.throws(
    () => loadIdentityManagementConfig(validEnv({
      IDENTITY_MANAGEMENT_ADMIN_CLIENT_ID: "liteasy-account-lifecycle"
    })),
    /must be distinct/
  );
  assert.throws(
    () => loadIdentityManagementConfig(validEnv({ NODE_ENV: "staging" })),
    /must use HTTPS/
  );
});
