import assert from "node:assert/strict";
import test from "node:test";
import { validateIntuechoRecoveryTestConfig } from "../scripts/postgresRecoveryGuard.mjs";

const config = {
  schema: "liteasy.postgres-recovery-test/v1",
  disposableTestInstance: true,
  adminDatabaseUrl: "postgresql://recovery_test_admin_fixture:synthetic-secret@127.0.0.1:46349/account_recovery_control_fixture_test",
  expectedSystemIdentifier: "1234567890123456789",
  binaryDirectory: "/synthetic/postgres/bin",
  evidenceDirectory: "/synthetic/evidence"
};
const rejects = (changes) => assert.throws(() => validateIntuechoRecoveryTestConfig({ ...config, ...changes }),
  (error) => error.message === "intuecho_recovery_test_configuration_forbidden" && !error.message.includes("synthetic-secret"));

test("requires explicit disposable-instance opt-in and complete configuration", () => {
  for (const value of [undefined, null, {}, [], { ...config, disposableTestInstance: false }]) {
    assert.throws(() => validateIntuechoRecoveryTestConfig(value), /configuration_forbidden/);
  }
  rejects({ schema: "production" });
  rejects({ unknownConnectionOverride: "production" });
  rejects({ expectedSystemIdentifier: "" });
});

test("rejects remote/default/forwarded-name endpoints and shared database targets", () => {
  for (const change of [
    (url) => url.replace("127.0.0.1", "database.example.invalid"),
    (url) => url.replace("127.0.0.1", "localhost"),
    (url) => url.replace(":46349", ""),
    (url) => url.replace(":46349", ":5432"),
    (url) => url.replace("account_recovery_control_fixture_test", "account_intuecho_test"),
    (url) => url.replace("account_recovery_control_fixture_test", "production"),
    (url) => url.replace("recovery_test_admin_fixture", "postgres")
  ]) rejects({ adminDatabaseUrl: change(config.adminDatabaseUrl) });
});

test("inherits the strict PostgreSQL URL and explicit credential guard", () => {
  for (const suffix of ["?host=production", "?database=production", "?sslmode=disable", "#other"]) {
    rejects({ adminDatabaseUrl: config.adminDatabaseUrl + suffix });
  }
  for (const value of ["not-a-url", config.adminDatabaseUrl.replace("postgresql:", "https:"),
    config.adminDatabaseUrl.replace(":synthetic-secret", ""), config.adminDatabaseUrl.replace("synthetic-secret", "%FF")]) {
    rejects({ adminDatabaseUrl: value });
  }
});

test("requires explicit absolute tool/evidence directories", () => {
  rejects({ binaryDirectory: "pg/bin" });
  rejects({ evidenceDirectory: "evidence" });
  rejects({ libraryDirectory: "lib" });
});

test("returns explicit pool settings for only the marked loopback control database", () => {
  const accepted = validateIntuechoRecoveryTestConfig(config);
  assert.equal(accepted.admin.database, "account_recovery_control_fixture_test");
  assert.equal(accepted.admin.host, "127.0.0.1");
  assert.equal(accepted.admin.port, 46349);
  assert.equal(accepted.expectedSystemIdentifier, config.expectedSystemIdentifier);
  assert.equal("connectionString" in accepted.admin, false);
  assert.equal("libraryDirectory" in accepted, false);
  const ipv6 = validateIntuechoRecoveryTestConfig({ ...config, adminDatabaseUrl: config.adminDatabaseUrl.replace("127.0.0.1", "[::1]") });
  assert.equal(ipv6.admin.host, "::1");
});
