import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "./database.mjs";
import { createLibraryStorageRepository } from "./libraryStorageRepository.mjs";

test("adds append-only literature projections to an existing development database", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-dev-migration-test-"));
  const databasePath = path.join(root, "existing.sqlite");
  try {
    let database = createDatabase({ databasePath });
    const repository = createLibraryStorageRepository(database, {
      objectDirectory: path.join(root, "objects")
    });
    const existing = repository.createMetadataEntry({
      expectedRevision: 0,
      scopeId: "user:existing",
      scopeType: "user",
      title: "Existing library entry"
    });
    database.exec(`
      DROP TRIGGER literature_record_projections_reject_update;
      DROP TRIGGER literature_record_projections_reject_delete;
      DROP TABLE literature_record_projections;
      DELETE FROM schema_migrations WHERE name = '021_literature_record_projections.sql';
    `);
    database.close();

    database = createDatabase({ databasePath });
    assert.equal(database.prepare(
      "SELECT title FROM library_metadata_entries WHERE document_id = ?"
    ).get(existing.documentId).title, "Existing library entry");
    assert.equal(database.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'literature_record_projections'"
    ).get().count, 1);
    assert.deepEqual(database.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'literature_record_projections_reject_%'
      ORDER BY name
    `).all().map((row) => row.name), [
      "literature_record_projections_reject_delete",
      "literature_record_projections_reject_update"
    ]);
    database.close();
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
