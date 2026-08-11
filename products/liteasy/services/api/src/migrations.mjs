import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const migrationDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrationNamePattern = /^\d{3}_[a-z0-9_]+\.sql$/;
const advisoryLockName = "liteasy-cloud-schema-migrations-v1";

function quotedIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value ?? "")) {
    throw new Error("postgres_application_role_invalid");
  }
  return `"${value}"`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function readMigrations(directory = migrationDirectory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && migrationNamePattern.test(entry.name))
    .map((entry) => {
      const sql = fs.readFileSync(path.join(directory, entry.name), "utf8");
      return { checksum: sha256(sql), name: entry.name, sql };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function migratePostgres(pool, { applicationRole, directory = migrationDirectory } = {}) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [advisoryLockName]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const existingResult = await client.query("SELECT name, checksum_sha256 FROM schema_migrations ORDER BY name");
    const existing = new Map(existingResult.rows.map((row) => [row.name, row.checksum_sha256]));
    for (const migration of readMigrations(directory)) {
      const priorChecksum = existing.get(migration.name);
      if (priorChecksum && priorChecksum !== migration.checksum) {
        throw new Error(`postgres_migration_changed: ${migration.name}`);
      }
      if (priorChecksum) continue;

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations(name, checksum_sha256) VALUES ($1, $2)",
          [migration.name, migration.checksum]
        );
        await client.query("COMMIT");
        applied.push(migration.name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    if (applicationRole) {
      const role = quotedIdentifier(applicationRole);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
      await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
      await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);
      await client.query(`REVOKE INSERT, UPDATE, DELETE ON schema_migrations FROM ${role}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${role}`);
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [advisoryLockName]);
    } finally {
      client.release();
    }
  }
  return { applied };
}

export async function verifyPostgresMigrations(pool, { directory = migrationDirectory } = {}) {
  let result;
  try {
    result = await pool.query("SELECT name, checksum_sha256 FROM schema_migrations ORDER BY name");
  } catch (error) {
    if (error?.code === "42P01") throw new Error("postgres_migrations_missing: schema_migrations does not exist");
    throw error;
  }
  const applied = new Map(result.rows.map((row) => [row.name, row.checksum_sha256]));
  const expected = readMigrations(directory);
  for (const migration of expected) {
    const checksum = applied.get(migration.name);
    if (!checksum) throw new Error(`postgres_migration_missing: ${migration.name}`);
    if (checksum !== migration.checksum) throw new Error(`postgres_migration_changed: ${migration.name}`);
  }
  const unknown = [...applied.keys()].filter((name) => !expected.some((migration) => migration.name === name));
  if (unknown.length > 0) throw new Error(`postgres_migration_unknown: ${unknown.join(",")}`);
  return { count: expected.length, current: true };
}
