import assert from "node:assert/strict";
import test from "node:test";
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
    "010_direct_message_read_state.sql"
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
});

test("readiness rejects missing, changed and unknown migrations", async () => {
  const migrations = readIntuechoMigrations();
  const rows = migrations.map((migration) => ({
    checksum_sha256: migration.checksum,
    name: migration.name
  }));
  assert.deepEqual(await verifyIntuechoMigrations({
    async query() { return { rows }; }
  }), { count: 10, current: true });
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
