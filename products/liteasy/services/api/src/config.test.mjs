import assert from "node:assert/strict";
import test from "node:test";
import {
  loadCloudConfig,
  loadMigrationDatabaseConfig,
  publicAdminIdentityConfig,
  publicCloudConfig,
  publicDesktopIdentityConfig
} from "./config.mjs";

function validEnv(overrides = {}) {
  return {
    DATABASE_URL: "postgresql://liteasy:secret@db.internal/liteasy",
    LITEASY_ALLOWED_ORIGINS: "http://tauri.localhost,https://app.liteasy.example",
    LITEASY_DATABASE_SSL_MODE: "verify-full",
    LITEASY_IDP_CLIENT_ID: "liteasy-cloud",
    LITEASY_IDP_CLIENT_SECRET: "identity-secret",
    LITEASY_IDP_ADMIN_CLIENT_ID: "liteasy-admin-public",
    LITEASY_IDP_DESKTOP_CLIENT_ID: "liteasy-desktop-public",
    LITEASY_IDP_DISCOVERY_URL: "https://identity.internal/.well-known/openid-configuration",
    LITEASY_IDP_INTROSPECTION_URL: "https://identity.internal/oauth2/introspect",
    LITEASY_IDP_INTUECHO_SERVICE_CLIENT_ID: "intuecho-organization-service",
    LITEASY_IDP_VISUALIZATION_SERVICE_CLIENT_ID: "liteasy-visualization-service",
    LITEASY_IDP_LITERATURE_SERVICE_CLIENT_ID: "liteasy-literature-projection",
    LITEASY_IDP_LITERATURE_SERVICE_CLIENT_SECRET: "literature-service-secret",
    LITEASY_IDP_ISSUER: "https://identity.internal",
    LITEASY_IDP_JWKS_URL: "https://identity.internal/.well-known/jwks.json",
    LITEASY_IDP_MANAGEMENT_CLIENT_ID: "liteasy-account-lifecycle",
    LITEASY_IDP_MANAGEMENT_CLIENT_SECRET: "management-secret",
    LITEASY_IDP_MANAGEMENT_URL: "https://identity-admin.internal",
    LITEASY_IDP_REVOCATION_URL: "https://identity.internal/oauth2/revoke",
    LITEASY_IDP_TOKEN_URL: "https://identity.internal/oauth2/token",
    LITEASY_INTUECHO_ADMIN_API_URL: "https://forum-api.internal",
    LITEASY_INTUECHO_LITERATURE_API_URL: "https://forum-literature-api.internal",
    LITEASY_MIGRATION_DATABASE_URL: "postgresql://liteasy_migrator:secret@db.internal/liteasy",
    LITEASY_MARKETING_APPLICATION_SECRET: "marketing-application-secret",
    LITEASY_PDF_SCANNER_SECRET: "scanner-deployment-secret",
    LITEASY_PDF_SCANNER_URL: "https://scanner.internal/v1/pdf:scan",
    LITEASY_RECOMMENDATION_CONTACT_EMAIL: "operations@liteasy.example",
    LITEASY_S3_BUCKET: "liteasy-private-documents",
    LITEASY_S3_REGION: "ap-southeast-1",
    NODE_ENV: "production",
    ...overrides
  };
}

test("loads a strict production PostgreSQL and S3 configuration", () => {
  const config = loadCloudConfig(validEnv());
  assert.equal(config.database.sslMode, "verify-full");
  assert.equal(config.s3.forcePathStyle, false);
  assert.equal(config.s3.securityProfile, "aws-s3");
  assert.equal(config.pdfSecurity.endpoint, "https://scanner.internal/v1/pdf:scan");
  assert.equal(config.pdfSecurity.timeoutMs, 120_000);
  assert.deepEqual(publicCloudConfig(config), {
    databaseTls: "verify-full",
    environment: "production",
    identity: "oidc+jwks+rfc7662",
    modelProxy: "unavailable",
    objectStorage: "s3",
    region: "ap-southeast-1"
  });
  assert.equal(JSON.stringify(publicCloudConfig(config)).includes("secret"), false);
  assert.deepEqual(publicDesktopIdentityConfig(config), {
    audience: "liteasy-desktop",
    authorizationFlow: "authorization_code_pkce",
    clientId: "liteasy-desktop-public",
    issuer: "https://identity.internal",
    revocationUrl: "https://identity.internal/oauth2/revoke"
  });
  assert.equal(JSON.stringify(publicDesktopIdentityConfig(config)).includes("secret"), false);
  assert.deepEqual(publicAdminIdentityConfig(config), {
    audience: "liteasy-admin",
    authorizationFlow: "authorization_code_pkce",
    clientId: "liteasy-admin-public",
    issuer: "https://identity.internal"
  });
  assert.equal(JSON.stringify(publicAdminIdentityConfig(config)).includes("secret"), false);
});

test("loads deployment-scoped model providers without exposing credentials", () => {
  const config = loadCloudConfig(validEnv({
    LITEASY_MODEL_DEEPSEEK_API_KEY: "deepseek-deployment-secret",
    LITEASY_MODEL_DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    LITEASY_MODEL_DEEPSEEK_MODEL: "deepseek-v4-flash",
    LITEASY_MODEL_OPENAI_API_KEY: "openai-deployment-secret",
    LITEASY_MODEL_OPENAI_BASE_URL: "https://api.openai.com/v1",
    LITEASY_MODEL_OPENAI_MODEL: "gpt-5-mini"
  }));

  assert.equal(config.models.providers.openai.model, "gpt-5-mini");
  assert.equal(config.models.providers.deepseek.apiKey, "deepseek-deployment-secret");
  assert.equal(publicCloudConfig(config).modelProxy, "configured");
  assert.equal(JSON.stringify(publicCloudConfig(config)).includes("openai"), false);
  assert.equal(JSON.stringify(publicCloudConfig(config)).includes("secret"), false);
});

test("loads visualization secret references from the deployment-owned JSON variable only", () => {
  const config = loadCloudConfig(validEnv({
    LITEASY_VISUALIZATION_EGRESS_HOSTNAMES: "provider.example, backup.example",
    LITEASY_VISUALIZATION_SECRETS_JSON: JSON.stringify({
      "viz-secret:provider-1": "deployment-managed-value"
    })
  }));

  assert.deepEqual(config.visualization.egressHostnames, ["backup.example", "provider.example"]);
  assert.equal(config.visualization.secrets["viz-secret:provider-1"], "deployment-managed-value");
  assert.equal(JSON.stringify(publicCloudConfig(config)).includes("deployment-managed-value"), false);
  assert.throws(
    () => loadCloudConfig(validEnv({ LITEASY_VISUALIZATION_SECRETS_JSON: "not-json" })),
    /LITEASY_VISUALIZATION_SECRETS_JSON/
  );
});

test("rejects partial, insecure, or credential-bearing model provider configuration", () => {
  assert.throws(() => loadCloudConfig(validEnv({
    LITEASY_MODEL_OPENAI_API_KEY: "only-a-key"
  })), /LITEASY_MODEL_OPENAI_BASE_URL/);
  assert.throws(() => loadCloudConfig(validEnv({
    LITEASY_MODEL_OPENAI_API_KEY: "secret",
    LITEASY_MODEL_OPENAI_BASE_URL: "http://api.openai.com/v1",
    LITEASY_MODEL_OPENAI_MODEL: "gpt-5-mini"
  })), /must use HTTPS/);
  assert.throws(() => loadCloudConfig(validEnv({
    LITEASY_MODEL_OPENAI_API_KEY: "secret",
    LITEASY_MODEL_OPENAI_BASE_URL: "https://user:pass@models.example/v1?token=secret",
    LITEASY_MODEL_OPENAI_MODEL: "gpt-5-mini"
  })), /cannot contain credentials/);
});

test("fails closed without production storage and identity requirements", () => {
  for (const name of [
    "DATABASE_URL",
    "LITEASY_ALLOWED_ORIGINS",
    "LITEASY_DATABASE_SSL_MODE",
    "LITEASY_IDP_CLIENT_ID",
    "LITEASY_IDP_CLIENT_SECRET",
    "LITEASY_IDP_ADMIN_CLIENT_ID",
    "LITEASY_IDP_DESKTOP_CLIENT_ID",
    "LITEASY_IDP_DISCOVERY_URL",
    "LITEASY_IDP_INTROSPECTION_URL",
    "LITEASY_IDP_INTUECHO_SERVICE_CLIENT_ID",
    "LITEASY_IDP_VISUALIZATION_SERVICE_CLIENT_ID",
    "LITEASY_IDP_LITERATURE_SERVICE_CLIENT_ID",
    "LITEASY_IDP_LITERATURE_SERVICE_CLIENT_SECRET",
    "LITEASY_IDP_ISSUER",
    "LITEASY_IDP_JWKS_URL",
    "LITEASY_IDP_MANAGEMENT_CLIENT_ID",
    "LITEASY_IDP_MANAGEMENT_CLIENT_SECRET",
    "LITEASY_IDP_MANAGEMENT_URL",
    "LITEASY_IDP_REVOCATION_URL",
    "LITEASY_IDP_TOKEN_URL",
    "LITEASY_INTUECHO_ADMIN_API_URL",
    "LITEASY_INTUECHO_LITERATURE_API_URL",
    "LITEASY_MARKETING_APPLICATION_SECRET",
    "LITEASY_PDF_SCANNER_SECRET",
    "LITEASY_PDF_SCANNER_URL",
    "LITEASY_RECOMMENDATION_CONTACT_EMAIL",
    "LITEASY_S3_BUCKET",
    "LITEASY_S3_REGION"
  ]) {
    const env = validEnv();
    delete env[name];
    assert.throws(() => loadCloudConfig(env), new RegExp(name));
  }
});

test("requires separate confidential service, desktop, admin, and management clients", () => {
  assert.throws(() => loadCloudConfig(validEnv({
    LITEASY_IDP_DESKTOP_CLIENT_ID: "liteasy-cloud"
  })), /must be distinct/);
  assert.throws(() => loadCloudConfig(validEnv({
    LITEASY_IDP_DESKTOP_CLIENT_ID: "invalid client id"
  })), /is invalid/);
  assert.throws(() => loadCloudConfig(validEnv({
    LITEASY_IDP_ADMIN_CLIENT_ID: "liteasy-cloud"
  })), /must be distinct/);
  assert.throws(() => loadCloudConfig(validEnv({
    LITEASY_IDP_ADMIN_CLIENT_ID: "liteasy-desktop-public"
  })), /must be distinct/);
  assert.throws(() => loadCloudConfig(validEnv({
    LITEASY_IDP_MANAGEMENT_CLIENT_ID: "liteasy-admin-public"
  })), /dedicated confidential client/);
  assert.throws(() => loadCloudConfig(validEnv({
    LITEASY_IDP_INTUECHO_SERVICE_CLIENT_ID: "liteasy-account-lifecycle"
  })), /dedicated confidential client/);
  assert.throws(() => loadCloudConfig(validEnv({
    LITEASY_IDP_LITERATURE_SERVICE_CLIENT_ID: "intuecho-organization-service"
  })), /dedicated confidential client/);
});

test("rejects SQLite, loopback production databases, insecure S3 and weak TLS modes", () => {
  assert.throws(() => loadCloudConfig(validEnv({ DATABASE_URL: "file:///tmp/liteasy.sqlite" })), /PostgreSQL/);
  assert.throws(
    () => loadCloudConfig(validEnv({ DATABASE_URL: "postgresql://user:pass@127.0.0.1/liteasy" })),
    /loopback/
  );
  assert.throws(
    () => loadCloudConfig(validEnv({ LITEASY_S3_ENDPOINT: "http://objects.internal" })),
    /must use HTTPS/
  );
  assert.throws(
    () => loadCloudConfig(validEnv({ LITEASY_PDF_SCANNER_URL: "http://scanner.internal/v1/pdf:scan" })),
    /must use HTTPS/
  );
  assert.throws(
    () => loadCloudConfig(validEnv({ LITEASY_PDF_SCANNER_URL: "https://scanner.internal/v1/pdf:scan?secret=x" })),
    /cannot contain credentials/
  );
  assert.throws(
    () => loadCloudConfig(validEnv({ LITEASY_PDF_SCANNER_SECRET: "short" })),
    /16 to 4096/
  );
  assert.throws(() => loadCloudConfig(validEnv({ LITEASY_DATABASE_SSL_MODE: "disable" })), /must require TLS/);
  assert.throws(() => loadCloudConfig(validEnv({ LITEASY_ALLOWED_ORIGINS: "*" })), /wildcard/);
  assert.throws(
    () => loadCloudConfig(validEnv({ LITEASY_RECOMMENDATION_CONTACT_EMAIL: "not-an-email" })),
    /valid contact email/
  );
  assert.throws(
    () => loadCloudConfig(validEnv({ LITEASY_RECOMMENDATION_CROSSREF_ENDPOINT: "http://api.crossref.org/works" })),
    /must use HTTPS/
  );
  assert.throws(
    () => loadCloudConfig(validEnv({ LITEASY_ALLOWED_ORIGINS: "http://untrusted.example" })),
    /must be HTTPS/
  );
  assert.throws(
    () => loadCloudConfig(validEnv({ LITEASY_S3_SECURITY_PROFILE: "unchecked" })),
    /LITEASY_S3_SECURITY_PROFILE/
  );
  assert.throws(
    () => loadCloudConfig(validEnv({ LITEASY_S3_SECURITY_PROFILE: "aliyun-oss" })),
    /requires LITEASY_S3_ENDPOINT/
  );
  assert.throws(
    () => loadCloudConfig(validEnv({
      LITEASY_S3_ENDPOINT: "https://objects.example.com",
      LITEASY_S3_SECURITY_PROFILE: "aliyun-oss"
    })),
    /official virtual-hosted OSS endpoint/
  );
});

test("accepts the explicit Aliyun OSS security profile only on an official endpoint", () => {
  const config = loadCloudConfig(validEnv({
    LITEASY_S3_ENDPOINT: "https://oss-cn-hongkong.aliyuncs.com",
    LITEASY_S3_SECURITY_PROFILE: "aliyun-oss"
  }));
  assert.equal(config.s3.endpoint, "https://oss-cn-hongkong.aliyuncs.com");
  assert.equal(config.s3.securityProfile, "aliyun-oss");
});

test("allows loopback services only under the explicit test environment", () => {
  const config = loadCloudConfig(validEnv({
    DATABASE_URL: "postgresql://user:pass@127.0.0.1/liteasy_test",
    LITEASY_IDP_DISCOVERY_URL: "http://127.0.0.1:9001/.well-known/openid-configuration",
    LITEASY_IDP_INTROSPECTION_URL: "http://127.0.0.1:9001/introspect",
    LITEASY_IDP_ISSUER: "http://127.0.0.1:9001",
    LITEASY_IDP_JWKS_URL: "http://127.0.0.1:9001/jwks",
    LITEASY_IDP_MANAGEMENT_URL: "http://127.0.0.1:9001/admin",
    LITEASY_IDP_REVOCATION_URL: "http://127.0.0.1:9001/revoke",
    LITEASY_IDP_TOKEN_URL: "http://127.0.0.1:9001/token",
    LITEASY_INTUECHO_ADMIN_API_URL: "http://127.0.0.1:4040",
    LITEASY_INTUECHO_LITERATURE_API_URL: "http://127.0.0.1:4040",
    LITEASY_PDF_SCANNER_URL: "http://127.0.0.1:3310/v1/pdf:scan",
    LITEASY_S3_ENDPOINT: "http://127.0.0.1:9000",
    NODE_ENV: "test"
  }));
  assert.equal(config.environment, "test");
});

test("requires a distinct deployment-scoped migration database role", () => {
  assert.equal(new URL(loadMigrationDatabaseConfig(validEnv()).connectionString).username, "liteasy_migrator");
  assert.throws(
    () => loadMigrationDatabaseConfig(validEnv({
      LITEASY_MIGRATION_DATABASE_URL: "postgresql://liteasy:other@db.internal/liteasy"
    })),
    /must be distinct/
  );
  const missing = validEnv();
  delete missing.LITEASY_MIGRATION_DATABASE_URL;
  assert.throws(() => loadMigrationDatabaseConfig(missing), /LITEASY_MIGRATION_DATABASE_URL/);

  const deploymentOnly = {
    DATABASE_URL: validEnv().DATABASE_URL,
    LITEASY_DATABASE_SSL_MODE: "verify-full",
    LITEASY_MIGRATION_DATABASE_URL: validEnv().LITEASY_MIGRATION_DATABASE_URL,
    NODE_ENV: "production"
  };
  assert.equal(new URL(loadMigrationDatabaseConfig(deploymentOnly).connectionString).username, "liteasy_migrator");
  assert.equal(loadMigrationDatabaseConfig(deploymentOnly).applicationRole, "liteasy");
  assert.throws(
    () => loadMigrationDatabaseConfig({
      ...deploymentOnly,
      DATABASE_URL: "postgresql://bad-role:secret@db.internal/liteasy"
    }),
    /PostgreSQL identifiers/
  );
});
