import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabasePath } from "./dataPaths.mjs";
import { assertDevCloudDeploymentBoundary } from "../deploymentBoundary.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(currentDir, "migrations");

function resolveDatabasePath(customPath) {
  return (
    customPath ||
    getDatabasePath()
  );
}

function readMigrations() {
  return fs
    .readdirSync(migrationsDir)
    .filter((filename) => /^\d+.*\.sql$/.test(filename))
    .sort()
    .map((filename) => ({
      name: filename,
      sql: fs.readFileSync(path.join(migrationsDir, filename), "utf8")
    }));
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const hasMigration = database.prepare(
    "SELECT 1 FROM schema_migrations WHERE name = ?"
  );
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
  );

  for (const migration of readMigrations()) {
    if (hasMigration.get(migration.name)) {
      continue;
    }

    database.transaction(() => {
      database.exec(migration.sql);
      recordMigration.run(migration.name, new Date().toISOString());
    })();
  }
}

export function createDatabase({ databasePath } = {}) {
  assertDevCloudDeploymentBoundary();
  const resolvedPath = resolveDatabasePath(databasePath);
  const isMemoryDatabase = resolvedPath === ":memory:";

  if (!isMemoryDatabase) {
    const dataDirectory = path.dirname(resolvedPath);
    fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    fs.chmodSync(dataDirectory, 0o700);
  }

  const database = new Database(resolvedPath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("synchronous = NORMAL");
  migrate(database);

  if (!isMemoryDatabase) {
    for (const filename of [resolvedPath, `${resolvedPath}-wal`, `${resolvedPath}-shm`]) {
      if (fs.existsSync(filename)) {
        fs.chmodSync(filename, 0o600);
      }
    }
  }

  return database;
}
