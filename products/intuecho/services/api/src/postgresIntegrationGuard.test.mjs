import assert from "node:assert/strict";
import test from "node:test";
import { validateIntuechoPostgresIntegrationDatabases } from "../scripts/postgresIntegrationGuard.mjs";

const applicationUrl = "postgresql://intuecho_app:app-password@127.0.0.1:55433/intuecho_test";
const migrationUrl = "postgresql://intuecho_migrator:migrator-password@127.0.0.1:55433/intuecho_test";

function rejectsEitherUrl(transform) {
  for (const [application, migration] of [
    [transform(applicationUrl), migrationUrl],
    [applicationUrl, transform(migrationUrl)]
  ]) {
    assert.throws(
      () => validateIntuechoPostgresIntegrationDatabases(application, migration),
      /intuecho_integration_database_forbidden/
    );
  }
}

test("rejects connection parameter overrides and URL fragments before creating pools", () => {
  for (const suffix of [
    "?host=database.example.invalid",
    "?database=production",
    "?user=postgres",
    "?port=5432",
    "?sslmode=disable",
    "#unsafe"
  ]) {
    rejectsEitherUrl((url) => `${url}${suffix}`);
  }
});

test("requires application and migration roles to use the same loopback endpoint", () => {
  rejectsEitherUrl((url) => url.replace(":55433/", ":55434/"));
  rejectsEitherUrl((url) => url.replace("127.0.0.1", "database.example.invalid"));
  rejectsEitherUrl((url) => url.replace("intuecho_test", "other_test"));
  assert.throws(
    () => validateIntuechoPostgresIntegrationDatabases(applicationUrl, applicationUrl),
    /intuecho_integration_database_forbidden/
  );
});

test("requires PostgreSQL URLs, test database names and explicit credentials", () => {
  rejectsEitherUrl((url) => url.replace("postgresql:", "https:"));
  rejectsEitherUrl((url) => url.replace("intuecho_test", "intuecho"));
  for (const url of [applicationUrl, migrationUrl]) {
    const missingUser = new URL(url);
    missingUser.username = "";
    const missingPassword = new URL(url);
    missingPassword.password = "";
    const counterpart = url === applicationUrl ? migrationUrl : applicationUrl;
    for (const missingCredential of [missingUser, missingPassword]) {
      assert.throws(
        () => validateIntuechoPostgresIntegrationDatabases(missingCredential.href, counterpart),
        /intuecho_integration_database_forbidden/
      );
    }
  }
});

test("rejects malformed URLs, invalid escapes and encoded database paths", () => {
  for (const invalid of [
    "not a URL",
    applicationUrl.replace("intuecho_test", "other%2Fintuecho_test"),
    applicationUrl.replace("intuecho_test", "%FF_test"),
    applicationUrl.replace("app-password", "%FF")
  ]) {
    assert.throws(
      () => validateIntuechoPostgresIntegrationDatabases(invalid, migrationUrl),
      /intuecho_integration_database_forbidden/
    );
  }
});

test("returns only explicit decoded pool settings for the validated targets", () => {
  assert.deepEqual(validateIntuechoPostgresIntegrationDatabases(applicationUrl, migrationUrl), {
    application: {
      database: "intuecho_test",
      host: "127.0.0.1",
      password: "app-password",
      port: 55433,
      user: "intuecho_app"
    },
    migration: {
      database: "intuecho_test",
      host: "127.0.0.1",
      password: "migrator-password",
      port: 55433,
      user: "intuecho_migrator"
    }
  });
});

test("accepts IPv6 loopback and default PostgreSQL ports without passing through URLs", () => {
  const application = "postgres://intuecho_app:app%2Bpassword@[::1]/intuecho_test";
  const migration = "postgresql://intuecho_migrator:migrator%2Bpassword@[::1]:5432/intuecho_test";
  const result = validateIntuechoPostgresIntegrationDatabases(application, migration);
  assert.deepEqual(result.application, {
    database: "intuecho_test",
    host: "::1",
    password: "app+password",
    port: 5432,
    user: "intuecho_app"
  });
  assert.equal(result.migration.password, "migrator+password");
  assert.equal("connectionString" in result.application, false);
  assert.equal("connectionString" in result.migration, false);
});
