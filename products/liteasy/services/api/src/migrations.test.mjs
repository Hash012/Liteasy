import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migratePostgres, readMigrations, verifyPostgresMigrations } from "./migrations.mjs";

function migrationDirectory(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-cloud-migrations-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), body);
  return directory;
}

function fakePool(existing = []) {
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql: sql.trim(), values });
      if (sql.includes("SELECT name, checksum_sha256")) return { rows: existing };
      return { rows: [] };
    },
    release() {
      queries.push({ sql: "RELEASE" });
    }
  };
  return { client, pool: { async connect() { return client; } }, queries };
}

test("orders immutable SQL migrations and hashes their content", () => {
  const directory = migrationDirectory({
    "002_second.sql": "SELECT 2;\n",
    "001_first.sql": "SELECT 1;\n",
    "notes.txt": "ignored"
  });
  const migrations = readMigrations(directory);
  assert.deepEqual(migrations.map((item) => item.name), ["001_first.sql", "002_second.sql"]);
  assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
});

test("serializes migration runners and commits each new migration", async () => {
  const directory = migrationDirectory({ "001_first.sql": "CREATE TABLE example(id text);\n" });
  const harness = fakePool();
  const result = await migratePostgres(harness.pool, { directory });
  assert.deepEqual(result.applied, ["001_first.sql"]);
  assert.ok(harness.queries.some((entry) => entry.sql.includes("pg_advisory_lock")));
  assert.ok(harness.queries.some((entry) => entry.sql === "BEGIN"));
  assert.ok(harness.queries.some((entry) => entry.sql === "COMMIT"));
  assert.ok(harness.queries.some((entry) => entry.sql.includes("pg_advisory_unlock")));
  assert.equal(harness.queries.at(-1).sql, "RELEASE");
});

test("grants only runtime data privileges to a validated application role", async () => {
  const directory = migrationDirectory({ "001_first.sql": "CREATE TABLE example(id text);\n" });
  const harness = fakePool();
  await migratePostgres(harness.pool, { applicationRole: "liteasy_app", directory });
  const grants = harness.queries.map((entry) => entry.sql).filter((sql) => /^(GRANT|ALTER DEFAULT)/.test(sql));
  assert.ok(grants.some((sql) => sql.includes("SELECT, INSERT, UPDATE, DELETE")));
  assert.equal(grants.some((sql) => /GRANT (ALL|CREATE)/.test(sql)), false);
  await assert.rejects(
    () => migratePostgres(fakePool().pool, { applicationRole: "bad-role", directory }),
    /postgres_application_role_invalid/
  );
});

test("rejects a migration whose applied content was changed", async () => {
  const directory = migrationDirectory({ "001_first.sql": "SELECT 'changed';\n" });
  const checksum = "0".repeat(64);
  const harness = fakePool([{ checksum_sha256: checksum, name: "001_first.sql" }]);
  await assert.rejects(() => migratePostgres(harness.pool, { directory }), /postgres_migration_changed/);
  assert.ok(harness.queries.some((entry) => entry.sql.includes("pg_advisory_unlock")));
});

test("runtime verification requires the exact immutable migration set", async () => {
  const directory = migrationDirectory({ "001_first.sql": "SELECT 1;\n" });
  const expected = readMigrations(directory)[0];
  assert.deepEqual(
    await verifyPostgresMigrations({
      async query() { return { rows: [{ checksum_sha256: expected.checksum, name: expected.name }] }; }
    }, { directory }),
    { count: 1, current: true }
  );
  await assert.rejects(
    () => verifyPostgresMigrations({ async query() { return { rows: [] }; } }, { directory }),
    /postgres_migration_missing/
  );
  await assert.rejects(
    () => verifyPostgresMigrations({
      async query() { return { rows: [{ checksum_sha256: expected.checksum, name: "999_unknown.sql" }] }; }
    }, { directory }),
    /postgres_migration_missing/
  );
});
