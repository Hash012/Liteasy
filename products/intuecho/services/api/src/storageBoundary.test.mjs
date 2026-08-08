import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
  assertIntuechoDevelopmentBoundary,
  prepareIntuechoDatabasePath
} from "./storageBoundary.mjs";

test("rejects staging and production SQLite processes", () => {
  assert.equal(assertIntuechoDevelopmentBoundary("development"), "development");
  assert.equal(assertIntuechoDevelopmentBoundary("test"), "test");
  assert.throws(() => assertIntuechoDevelopmentBoundary("staging"), /intuecho_nonproduction_only/);
  assert.throws(() => assertIntuechoDevelopmentBoundary("production"), /intuecho_nonproduction_only/);
});

test("copies a legacy release database to an external data directory without deleting it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "intuecho-storage-boundary-"));
  const legacyPath = path.join(root, "legacy", "intuecho.db");
  const databasePath = path.join(root, "external", "intuecho.sqlite");
  fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
  const legacy = new Database(legacyPath);
  legacy.exec("CREATE TABLE marker (value TEXT NOT NULL); INSERT INTO marker VALUES ('preserved')");
  legacy.close();

  const result = prepareIntuechoDatabasePath({ defaultPath: databasePath, legacyPath });
  assert.equal(result.databasePath, databasePath);
  assert.equal(result.migratedFrom, legacyPath);
  assert.equal(fs.existsSync(legacyPath), true);
  const migrated = new Database(databasePath, { readonly: true });
  assert.equal(migrated.prepare("SELECT value FROM marker").get().value, "preserved");
  migrated.close();
});

test("does not overwrite an existing external database", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "intuecho-storage-boundary-"));
  const legacyPath = path.join(root, "legacy.db");
  const databasePath = path.join(root, "external.sqlite");
  for (const [filePath, value] of [[legacyPath, "legacy"], [databasePath, "current"]]) {
    const database = new Database(filePath);
    database.exec(`CREATE TABLE marker (value TEXT NOT NULL); INSERT INTO marker VALUES ('${value}')`);
    database.close();
  }
  const result = prepareIntuechoDatabasePath({ defaultPath: databasePath, legacyPath });
  assert.equal(result.migratedFrom, null);
  const current = new Database(databasePath, { readonly: true });
  assert.equal(current.prepare("SELECT value FROM marker").get().value, "current");
  current.close();
});
