import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "./database.mjs";
import { createLibraryStorageRepository } from "./libraryStorageRepository.mjs";
import Database from "better-sqlite3";

test("mobile session migration preserves existing sessions, indexes and user deletion cascades", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-mobile-migration-"));
  const databasePath = path.join(root, "existing.sqlite");
  let db = new Database(databasePath);
  try {
    db.pragma("foreign_keys = ON");
    db.exec(fs.readFileSync(new URL("./migrations/001_identity_and_content.sql", import.meta.url), "utf8"));
    db.exec(fs.readFileSync(new URL("./migrations/011_admin_identity_security.sql", import.meta.url), "utf8"));
    db.exec("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES('owner','a@example.com','A','now','now')");
    db.exec("INSERT INTO auth_sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at,mfa_verified_at) VALUES('desktop','owner','hash1','now','later','now','mfa')");
    const before = db.prepare("SELECT * FROM auth_sessions").get();
    db.transaction(() => db.exec(fs.readFileSync(new URL("./migrations/023_mobile_sessions.sql", import.meta.url), "utf8")))();
    assert.deepEqual(db.prepare("SELECT * FROM auth_sessions WHERE id = 'desktop'").get(), before);
    db.exec("INSERT INTO auth_sessions(id,user_id,token_hash,created_at,expires_at,last_seen_at,audience) VALUES('mobile','owner','hash2','now','later','now','liteasy-mobile')");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='index' AND name LIKE 'auth_sessions_%_idx'").get().count, 2);
    db.exec("DELETE FROM users WHERE id='owner'");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM auth_sessions").get().count, 0);
  } finally { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

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
