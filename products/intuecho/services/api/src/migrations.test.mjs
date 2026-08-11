import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { initializeAnnotationCommunitySqlite } from "./annotationCommunitySqlite.mjs";
import { readIntuechoMigrations, verifyIntuechoMigrations } from "./migrations.mjs";

test("loads ordered immutable forum migrations", () => {
  const migrations = readIntuechoMigrations();
  assert.deepEqual(migrations.map((item) => item.name), [
    "001_forum_core.sql",
    "002_account_lifecycle.sql",
    "003_desktop_community_integration.sql",
    "004_annotation_community.sql",
    "005_annotation_tag_appeal_governance.sql",
    "006_distinct_append_only_audit_errors.sql",
    "007_reply_rating_and_profile_names.sql",
    "008_account_deletion_annotation_history.sql",
    "009_detach_deleted_annotation_audit.sql",
    "010_direct_message_read_state.sql",
    "011_literature_resolution_provenance.sql",
    "012_desktop_annotation_publications.sql",
    "013_desktop_annotation_publication_digest.sql",
    "014_correct_legacy_literature_snapshots.sql",
    "015_reply_projection_lifecycle.sql",
    "016_source_confirmed_literature_identity.sql",
    "017_constrain_legacy_aggregate_confirmation.sql",
    "018_align_literature_identity_model.sql",
    "019_classify_literature_identifiers.sql"
  ]);
  assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[0].sql, /CREATE TABLE moderation_audit/);
  assert.match(migrations[0].sql, /moderation_audit_append_only/);
  assert.match(migrations[1].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[1].sql, /CREATE TABLE account_deletion_jobs/);
  assert.match(migrations[1].sql, /account_lifecycle_audit_append_only/);
  assert.match(migrations[2].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[2].sql, /CREATE TABLE desktop_draft_handoffs/);
  assert.match(migrations[2].sql, /CREATE TABLE community_annotations/);
  assert.match(migrations[3].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[3].sql, /CREATE TABLE annotations/);
  assert.match(migrations[3].sql, /CREATE TABLE annotation_targets/);
  assert.match(migrations[3].sql, /CREATE TABLE direct_messages/);
  assert.match(migrations[4].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[4].sql, /CREATE TABLE annotation_tag_appeal_audit/);
  assert.match(migrations[4].sql, /annotation_tag_appeal_audit_append_only/);
  assert.match(migrations[6].sql, /CREATE TABLE annotation_replies/);
  assert.match(migrations[6].sql, /CREATE TABLE annotation_ratings/);
  assert.match(migrations[7].sql, /guard_annotation_version_mutation/);
  assert.match(migrations[7].sql, /ON DELETE CASCADE/);
  assert.match(migrations[8].sql, /validate_annotation_moderation_audit_reference/);
  assert.match(migrations[9].sql, /CREATE TABLE direct_conversation_reads/);
  assert.match(migrations[10].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[11].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[11].sql, /CREATE TABLE desktop_annotation_publications/);
  assert.match(migrations[12].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[12].sql, /ADD COLUMN operation_digest/);
  assert.match(migrations[15].sql, /CREATE TABLE literature_identifiers/);
  assert.match(migrations[15].sql, /CREATE TABLE literature_identity_claims/);
  assert.match(migrations[15].sql, /CREATE TABLE literature_relations/);
  assert.match(migrations[15].sql, /legacy_literature_identity_is_read_only/);
  assert.match(migrations[16].sql, /identity_status = 'legacy_unverified'/);
  assert.match(migrations[16].sql, /confirmationBasis/);
  assert.match(migrations[17].sql, /RENAME COLUMN document_type TO version_kind/);
  assert.match(migrations[17].sql, /ADD COLUMN identifier_id/);
  assert.match(migrations[18].sql, /ADD COLUMN identifier_role/);
  assert.match(migrations[18].sql, /candidate_alias/);
});

test("readiness rejects missing, changed and unknown migrations", async () => {
  const migrations = readIntuechoMigrations();
  const rows = migrations.map((migration) => ({
    checksum_sha256: migration.checksum,
    name: migration.name
  }));
  assert.deepEqual(await verifyIntuechoMigrations({
    async query() { return { rows }; }
  }), { count: 19, current: true });
  await assert.rejects(
    () => verifyIntuechoMigrations({
      async query() { return { rows: [
        { ...rows[0], checksum_sha256: "0".repeat(64) },
        rows[1]
      ] }; }
    }),
    /intuecho_migration_changed/
  );
  await assert.rejects(
    () => verifyIntuechoMigrations({
      async query() { return { rows: [
        ...rows,
        { name: "999_unknown.sql", checksum_sha256: "0".repeat(64) }
      ] }; }
    }),
    /intuecho_migration_unknown/
  );
});

test("upgrades SQLite literature provenance schema with snapshots and guarded constraints", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE literature_records_v2 (id TEXT PRIMARY KEY, title TEXT NOT NULL, authors_json TEXT NOT NULL, publication_year INTEGER, document_type TEXT, record_source TEXT NOT NULL DEFAULT 'legacy_metadata', source_provider TEXT, confirmed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
  db.exec("CREATE TABLE literature_identities_v2 (literature_id TEXT NOT NULL, identity_kind TEXT NOT NULL, identity_value TEXT NOT NULL, identity_source TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(literature_id, identity_kind, identity_value), UNIQUE(identity_kind, identity_value))");
  db.prepare("INSERT INTO literature_records_v2(id, title, authors_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("legacy", "Legacy", "[]", "2026-08-09T00:00:00.000Z", "2026-08-09T00:00:00.000Z");
  db.prepare("INSERT INTO literature_records_v2(id, title, authors_json, record_source, source_provider, confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("registry-confirmed", "Registry Confirmed", "[]", "public_registry", "crossref", "2026-08-09T00:00:00.000Z", "2026-08-09T00:00:00.000Z", "2026-08-09T00:00:00.000Z");
  db.prepare("INSERT INTO literature_records_v2(id, title, authors_json, record_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("registry-without-evidence", "Registry Without Evidence", "[]", "public_registry", "2026-08-09T00:00:00.000Z", "2026-08-09T00:00:00.000Z");
  db.prepare("INSERT INTO literature_records_v2(id, title, authors_json, publication_year, record_source, source_provider, confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("aggregate-without-refetch-evidence", "Aggregate Legacy", JSON.stringify(["Aggregate Author"]), 2026, "public_registry", "openalex", "2026-08-09T00:00:00.000Z", "2026-08-09T00:00:00.000Z", "2026-08-09T00:00:00.000Z");
  db.prepare("INSERT INTO literature_identities_v2(literature_id, identity_kind, identity_value, identity_source, created_at) VALUES (?, ?, ?, ?, ?)").run("legacy", "doi", "https://doi.org/10.1000/legacy", "metadata", "2026-08-09T00:00:00.000Z");
  db.prepare("INSERT INTO literature_identities_v2(literature_id, identity_kind, identity_value, identity_source, created_at) VALUES (?, ?, ?, ?, ?)").run("registry-confirmed", "doi", "https://doi.org/10.1000/confirmed", "public_registry", "2026-08-09T00:00:00.000Z");
  db.prepare("INSERT INTO literature_identities_v2(literature_id, identity_kind, identity_value, identity_source, created_at) VALUES (?, ?, ?, ?, ?)").run("aggregate-without-refetch-evidence", "openalex_id", "W123", "public_registry", "2026-08-09T00:00:00.000Z");
  initializeAnnotationCommunitySqlite(db);
  const literatureColumns = new Set(db.prepare("PRAGMA table_info(literature_records_v2)").all().map((column) => column.name));
  assert.ok(literatureColumns.has("version_kind"));
  assert.ok(literatureColumns.has("confirmation_status"));
  assert.deepEqual(db.prepare("SELECT identifier_kind, identifier_role, normalized_value, is_legacy_alias FROM literature_identifiers_v2 WHERE literature_id = 'legacy'").all(), [{
    identifier_kind: "doi",
    identifier_role: "confirmable",
    is_legacy_alias: 0,
    normalized_value: "10.1000/legacy"
  }]);
  assert.equal(db.prepare("SELECT confirmation_status FROM literature_records_v2 WHERE id = 'legacy'").get().confirmation_status, "legacy_unverified");
  assert.equal(db.prepare("SELECT confirmation_status FROM literature_records_v2 WHERE id = 'registry-confirmed'").get().confirmation_status, "confirmed");
  assert.equal(db.prepare("SELECT confirmation_status FROM literature_records_v2 WHERE id = 'registry-without-evidence'").get().confirmation_status, "legacy_unverified");
  assert.equal(db.prepare("SELECT confirmation_status FROM literature_records_v2 WHERE id = 'aggregate-without-refetch-evidence'").get().confirmation_status, "legacy_unverified");
  assert.equal(db.prepare(`SELECT count(*) AS count FROM literature_identity_claims_v2 claim JOIN literature_identifiers_v2 identifier ON identifier.id = claim.identifier_id WHERE identifier.literature_id = 'registry-confirmed'`).get().count, 1);
  assert.equal(db.prepare("SELECT count(*) AS count FROM literature_record_versions_v2 WHERE literature_id = 'legacy'").get().count, 1);
  const legacySnapshot = JSON.parse(db.prepare("SELECT snapshot_json FROM literature_record_versions_v2 WHERE literature_id = 'legacy'").get().snapshot_json);
  assert.equal(legacySnapshot.recordSource, "legacy_metadata");
  assert.equal(legacySnapshot.identifiers[0].source, "metadata");
  assert.throws(() => db.prepare("INSERT INTO literature_records_v2(id, title, authors_json, record_source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("bad-source", "Bad", "[]", "invalid", "now", "now"), /literature_record_source_invalid/);
  assert.throws(() => db.prepare("INSERT INTO literature_identities_v2(literature_id, identity_kind, identity_value, identity_source, created_at) VALUES (?, ?, ?, ?, ?)").run("legacy", "invalid", "id", "metadata", "now"), /legacy_literature_identity_is_read_only/);
  assert.throws(() => db.prepare("INSERT INTO literature_identities_v2(literature_id, identity_kind, identity_value, identity_source, created_at) VALUES (?, ?, ?, ?, ?)").run("legacy", "doi", "10.1000/new", "metadata", "now"), /legacy_literature_identity_is_read_only/);
  assert.throws(() => db.prepare("INSERT OR REPLACE INTO literature_record_versions_v2(id, literature_id, revision, snapshot_json, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("replacement", "legacy", 1, "{}", "replace", "now"), /literature_record_version_is_append_only|UNIQUE/);
  db.close();
});

test("initializes the source-confirmed SQLite schema on an empty database", () => {
  const db = new Database(":memory:");
  initializeAnnotationCommunitySqlite(db);
  initializeAnnotationCommunitySqlite(db);
  assert.deepEqual(new Set([
    "literature_identifiers_v2",
    "literature_identity_claims_v2",
    "literature_relations_v2"
  ]), new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('literature_identifiers_v2', 'literature_identity_claims_v2', 'literature_relations_v2')").all().map((row) => row.name)));
  const claimColumns = db.prepare("PRAGMA table_info(literature_identity_claims_v2)").all().map((column) => column.name);
  assert.deepEqual(claimColumns, ["id", "identifier_id", "provider", "provider_record_id", "verification_status", "evidence_json", "observed_at", "created_at"]);
  const identifierColumns = db.prepare("PRAGMA table_info(literature_identifiers_v2)").all();
  assert.equal(identifierColumns.find((column) => column.name === "id")?.pk, 1);
  assert.ok(identifierColumns.some((column) => column.name === "identifier_role"));
  const identifierTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'literature_identifiers_v2'").get().sql;
  assert.match(identifierTableSql, /identifier_role/);
  assert.match(identifierTableSql, /candidate_alias/);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'literature_identities_v2'").get(), undefined);
  db.close();
});

test("rebuilds the previous SQLite identifier and claim tables around identifier ids", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE literature_records_v2 (id TEXT PRIMARY KEY, title TEXT NOT NULL, authors_json TEXT NOT NULL, publication_year INTEGER, document_type TEXT, record_source TEXT NOT NULL DEFAULT 'legacy_metadata', source_provider TEXT, confirmed_at TEXT, revision INTEGER NOT NULL DEFAULT 1, identity_status TEXT NOT NULL DEFAULT 'legacy_unverified', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE literature_identities_v2 (literature_id TEXT NOT NULL, identity_kind TEXT NOT NULL, identity_value TEXT NOT NULL, identity_source TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(literature_id, identity_kind, identity_value), UNIQUE(identity_kind, identity_value));
    CREATE TABLE literature_identifiers_v2 (literature_id TEXT NOT NULL REFERENCES literature_records_v2(id) ON DELETE CASCADE, identifier_kind TEXT NOT NULL, normalized_value TEXT NOT NULL, is_legacy_alias INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, PRIMARY KEY(literature_id, identifier_kind, normalized_value), UNIQUE(identifier_kind, normalized_value));
    CREATE TABLE literature_identity_claims_v2 (id TEXT PRIMARY KEY, literature_id TEXT NOT NULL REFERENCES literature_records_v2(id) ON DELETE CASCADE, provider TEXT NOT NULL, provider_record_id TEXT NOT NULL, verification_status TEXT NOT NULL, evidence_json TEXT NOT NULL, observed_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(provider, provider_record_id));
    INSERT INTO literature_records_v2(id, title, authors_json, record_source, source_provider, confirmed_at, identity_status, created_at, updated_at) VALUES ('confirmed', 'Confirmed', '["Author"]', 'public_registry', 'crossref', '2026-08-09T00:00:00.000Z', 'confirmed', '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z');
    INSERT INTO literature_identifiers_v2(literature_id, identifier_kind, normalized_value, created_at) VALUES ('confirmed', 'doi', '10.1000/confirmed', '2026-08-09T00:00:00.000Z');
    INSERT INTO literature_identity_claims_v2(id, literature_id, provider, provider_record_id, verification_status, evidence_json, observed_at, created_at) VALUES ('claim', 'confirmed', 'crossref', '10.1000/confirmed', 'confirmed', '{}', '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z');
  `);

  initializeAnnotationCommunitySqlite(db);

  const identifierColumns = db.prepare("PRAGMA table_info(literature_identifiers_v2)").all();
  assert.equal(identifierColumns.find((column) => column.name === "id")?.pk, 1);
  const claimColumns = db.prepare("PRAGMA table_info(literature_identity_claims_v2)").all().map((column) => column.name);
  assert.ok(claimColumns.includes("identifier_id"));
  assert.ok(!claimColumns.includes("literature_id"));
  assert.deepEqual(db.prepare(`
    SELECT identifier.literature_id, claim.provider, claim.provider_record_id
      FROM literature_identity_claims_v2 claim
      JOIN literature_identifiers_v2 identifier ON identifier.id = claim.identifier_id
  `).get(), {
    literature_id: "confirmed",
    provider: "crossref",
    provider_record_id: "10.1000/confirmed"
  });
  db.close();
});

test("upgrades existing SQLite desktop publication mappings with a legacy digest sentinel", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE desktop_annotation_publications_v2 (owner_id TEXT NOT NULL, queue_key TEXT NOT NULL, source_annotation_id TEXT NOT NULL, annotation_id TEXT NOT NULL UNIQUE, source_revision INTEGER NOT NULL, source_updated_at TEXT NOT NULL, state TEXT NOT NULL, remote_revision INTEGER NOT NULL, synced_at TEXT NOT NULL, PRIMARY KEY(owner_id, queue_key))");
  db.prepare("INSERT INTO desktop_annotation_publications_v2(owner_id, queue_key, source_annotation_id, annotation_id, source_revision, source_updated_at, state, remote_revision, synced_at) VALUES (?, ?, ?, ?, 1, ?, 'published', 1, ?)")
    .run("owner", "queue", "source", "remote", "2026-08-09T01:00:00.000Z", "2026-08-09T01:00:01.000Z");
  initializeAnnotationCommunitySqlite(db);
  const row = db.prepare("SELECT operation_digest FROM desktop_annotation_publications_v2 WHERE owner_id = 'owner'").get();
  assert.equal(row.operation_digest, "0".repeat(64));
  db.close();
});
