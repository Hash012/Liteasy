import assert from "node:assert/strict";
import test from "node:test";
import { validatePostgresIntegrationDatabases } from "../scripts/postgresIntegrationGuard.mjs";

const applicationUrl = "postgresql://liteasy_app:app-password@127.0.0.1:55432/liteasy_test";
const migrationUrl = "postgresql://liteasy_migrator:migrator-password@127.0.0.1:55432/liteasy_test";

test("builds explicit pool configs only from guarded loopback test URLs", () => {
  assert.deepEqual(validatePostgresIntegrationDatabases(applicationUrl, migrationUrl), {
    application: {
      database: "liteasy_test",
      host: "127.0.0.1",
      password: "app-password",
      port: 55432,
      user: "liteasy_app"
    },
    migration: {
      database: "liteasy_test",
      host: "127.0.0.1",
      password: "migrator-password",
      port: 55432,
      user: "liteasy_migrator"
    }
  });
});

function assertUrlSuffixRejected(suffix) {
  for (const [application, migration] of [
    [`${applicationUrl}${suffix}`, migrationUrl],
    [applicationUrl, `${migrationUrl}${suffix}`]
  ]) {
    assert.throws(
      () => validatePostgresIntegrationDatabases(application, migration),
      /integration_database_forbidden/
    );
  }
}

test("rejects PostgreSQL host query overrides before creating a pool", () => {
  assertUrlSuffixRejected("?host=database.example.com");
});

test("rejects PostgreSQL user query overrides before creating a pool", () => {
  assertUrlSuffixRejected("?user=postgres");
});

test("rejects PostgreSQL URL fragments before creating a pool", () => {
  assertUrlSuffixRejected("#unsafe");
});

test("requires PostgreSQL protocol, loopback test databases, and distinct roles", () => {
  assert.throws(
    () => validatePostgresIntegrationDatabases(applicationUrl.replace("postgresql:", "https:"), migrationUrl),
    /integration_database_forbidden/
  );
  assert.throws(
    () => validatePostgresIntegrationDatabases(applicationUrl.replace("127.0.0.1", "database.example.com"), migrationUrl),
    /integration_database_forbidden/
  );
  assert.throws(
    () => validatePostgresIntegrationDatabases(applicationUrl.replace("liteasy_test", "liteasy"), migrationUrl),
    /integration_database_forbidden/
  );
  assert.throws(
    () => validatePostgresIntegrationDatabases(applicationUrl, migrationUrl.replace("liteasy_test", "other_test")),
    /integration_database_forbidden/
  );
  assert.throws(
    () => validatePostgresIntegrationDatabases(applicationUrl, applicationUrl),
    /integration_migration_role_required/
  );
});

test("requires application and migration roles to target the same database endpoint", () => {
  assert.throws(
    () => validatePostgresIntegrationDatabases(
      applicationUrl,
      migrationUrl.replace(":55432/", ":55433/")
    ),
    /integration_database_forbidden/
  );
});

test("requires explicit application and migration credentials", () => {
  assert.throws(
    () => validatePostgresIntegrationDatabases(
      applicationUrl.replace("liteasy_app", ""),
      migrationUrl
    ),
    /integration_database_forbidden/
  );
  assert.throws(
    () => validatePostgresIntegrationDatabases(
      applicationUrl.replace(":app-password@", "@"),
      migrationUrl
    ),
    /integration_database_forbidden/
  );
  assert.throws(
    () => validatePostgresIntegrationDatabases(
      applicationUrl,
      migrationUrl.replace("liteasy_migrator", "")
    ),
    /integration_database_forbidden/
  );
  assert.throws(
    () => validatePostgresIntegrationDatabases(
      applicationUrl,
      migrationUrl.replace(":migrator-password@", "@")
    ),
    /integration_database_forbidden/
  );
});
