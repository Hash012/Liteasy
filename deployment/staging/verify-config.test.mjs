import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvFile, validateStagingConfig } from "./verify-config.mjs";

function validConfig(overrides = {}) {
  const digest = "a".repeat(64);
  return {
    ADMIN_HOST: "admin.staging.liteasyclaw.com",
    API_HOST: "api.staging.liteasyclaw.com",
    AUTH_HOST: "auth.staging.liteasyclaw.com",
    COMMUNITY_HOST: "community.staging.liteasyclaw.com",
    GATEWAY_IMAGE: `registry.example/liteasy/gateway@sha256:${digest}`,
    GATEWAY_ENV_FILE: "/etc/liteasy/staging/gateway.env",
    IDENTITY_HOST: "identity.staging.liteasyclaw.com",
    IDENTITY_MANAGEMENT_ENV_FILE: "/etc/liteasy/staging/identity-management.env",
    IDENTITY_MANAGEMENT_IMAGE: `registry.example/liteasy/identity@sha256:${digest}`,
    INTUECHO_API_ENV_FILE: "/etc/liteasy/staging/intuecho-api.env",
    INTUECHO_API_IMAGE: `registry.example/liteasy/intuecho-api@sha256:${digest}`,
    KEYCLOAK_ENV_FILE: "/etc/liteasy/staging/keycloak.env",
    KEYCLOAK_IMAGE: `registry.example/keycloak@sha256:${digest}`,
    LITEASY_API_ENV_FILE: "/etc/liteasy/staging/liteasy-api.env",
    LITEASY_API_IMAGE: `registry.example/liteasy/api@sha256:${digest}`,
    MARKETING_HOST: "staging.liteasyclaw.com",
    RDS_CA_CERT_FILE: "/etc/liteasy/staging/aliyun-rds-ca.pem",
    STAGING_RUNTIME_DIR: "/etc/liteasy/staging",
    ...overrides
  };
}

test("parses the narrow deployment env format", () => {
  assert.deepEqual(parseEnvFile("# comment\nAPI_HOST=api.staging.liteasyclaw.com\nEMPTY=\n"), {
    API_HOST: "api.staging.liteasyclaw.com",
    EMPTY: ""
  });
});

test("accepts unique staging hosts, absolute runtime paths and digest-pinned images", () => {
  const result = validateStagingConfig(validConfig());
  assert.equal(result.verified, true);
  assert.equal(result.images, 5);
});

test("rejects mutable images and non-staging hosts", () => {
  assert.throws(
    () => validateStagingConfig(validConfig({ LITEASY_API_IMAGE: "registry.example/liteasy/api:latest" })),
    /staging_config_unpinned_image/
  );
  assert.throws(
    () => validateStagingConfig(validConfig({ API_HOST: "api.liteasyclaw.com" })),
    /staging_config_invalid_host/
  );
});

test("rejects duplicate hosts and relative secret material paths", () => {
  assert.throws(
    () => validateStagingConfig(validConfig({ ADMIN_HOST: "api.staging.liteasyclaw.com" })),
    /staging_config_duplicate_host/
  );
  assert.throws(
    () => validateStagingConfig(validConfig({ RDS_CA_CERT_FILE: "./rds.pem" })),
    /staging_config_runtime_path_invalid/
  );
});
