import assert from "node:assert/strict";
import test from "node:test";
import {
  loadIntuechoMigrationConfig,
  loadIntuechoProductionConfig,
  publicIntuechoIdentityConfig
} from "./productionConfig.mjs";

function environment(overrides = {}) {
  return {
    INTUECHO_ADMIN_API_URL: "http://admin.test",
    INTUECHO_ALLOWED_ORIGINS: "http://web.test",
    INTUECHO_DATABASE_SSL_MODE: "require",
    INTUECHO_DATABASE_URL: "postgresql://intuecho_app:secret@postgres.test/intuecho",
    INTUECHO_IDP_CLIENT_ID: "intuecho-api",
    INTUECHO_IDP_CLIENT_SECRET: "secret",
    INTUECHO_IDP_DISCOVERY_URL: "http://identity.test/.well-known/openid-configuration",
    INTUECHO_IDP_INTROSPECTION_URL: "http://identity.test/introspect",
    INTUECHO_IDP_ISSUER: "http://identity.test",
    INTUECHO_IDP_JWKS_URL: "http://identity.test/jwks",
    INTUECHO_IDP_TOKEN_URL: "http://identity.test/token",
    INTUECHO_IDP_WEB_CLIENT_ID: "intuecho-web",
    INTUECHO_MIGRATION_DATABASE_URL: "postgresql://intuecho_migrator:secret@postgres.test/intuecho",
    INTUECHO_ORGANIZATION_API_URL: "http://liteasy.test",
    INTUECHO_ORGANIZATION_SERVICE_CLIENT_ID: "intuecho-organization-service",
    INTUECHO_ORGANIZATION_SERVICE_CLIENT_SECRET: "service-secret",
    NODE_ENV: "test",
    ...overrides
  };
}

test("loads a separate PostgreSQL, IdP and administration boundary", () => {
  const config = loadIntuechoProductionConfig(environment());
  assert.equal(config.database.connectionString.includes("intuecho_app"), true);
  assert.equal(config.identity.webClientId, "intuecho-web");
  assert.equal(config.organizationAuthorization.audience, "liteasy-internal");
  assert.equal(config.organizationAuthorization.clientId, "intuecho-organization-service");
  assert.deepEqual(publicIntuechoIdentityConfig(config), {
    audience: "intuecho-web",
    authorizationFlow: "authorization_code_pkce",
    clientId: "intuecho-web",
    issuer: "http://identity.test"
  });
  assert.equal(loadIntuechoMigrationConfig(environment()).applicationRole, "intuecho_app");
});

test("requires HTTPS and non-loopback services outside tests", () => {
  assert.throws(
    () => loadIntuechoProductionConfig(environment({ NODE_ENV: "production" })),
    /must use HTTPS/
  );
  assert.throws(
    () => loadIntuechoProductionConfig(environment({
      INTUECHO_ADMIN_API_URL: "https://127.0.0.1",
      NODE_ENV: "production"
    })),
    /cannot use loopback/
  );
});

test("rejects wildcard origins and shared database or identity roles", () => {
  assert.throws(
    () => loadIntuechoProductionConfig(environment({ INTUECHO_ALLOWED_ORIGINS: "*" })),
    /cannot use a wildcard/
  );
  assert.throws(
    () => loadIntuechoProductionConfig(environment({ INTUECHO_IDP_WEB_CLIENT_ID: "intuecho-api" })),
    /must be distinct/
  );
  assert.throws(
    () => loadIntuechoProductionConfig(environment({ INTUECHO_ORGANIZATION_SERVICE_CLIENT_ID: "intuecho-api" })),
    /must be distinct/
  );
  assert.throws(
    () => loadIntuechoMigrationConfig(environment({
      INTUECHO_MIGRATION_DATABASE_URL: "postgresql://intuecho_app:other@postgres.test/intuecho"
    })),
    /must be distinct identifiers/
  );
});
