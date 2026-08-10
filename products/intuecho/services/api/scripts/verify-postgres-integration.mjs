import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { PostgresAccountLifecycleRepository } from "../src/accountLifecycleRepository.mjs";
import { migrateIntuecho, readIntuechoMigrations, verifyIntuechoMigrations } from "../src/migrations.mjs";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";
import { PostgresForumRepository } from "../src/postgresForumRepository.mjs";

const applicationUrl = process.env.INTUECHO_TEST_DATABASE_URL;
const migrationUrl = process.env.INTUECHO_TEST_MIGRATION_DATABASE_URL;
const migration014Only = process.env.INTUECHO_MIGRATION_014_ONLY === "1";
if (!applicationUrl || !migrationUrl) {
  throw new Error("INTUECHO_TEST_DATABASE_URL and INTUECHO_TEST_MIGRATION_DATABASE_URL are required");
}
const application = new URL(applicationUrl);
const migration = new URL(migrationUrl);
if (
  !new Set(["127.0.0.1", "::1", "localhost"]).has(application.hostname) ||
  migration.hostname !== application.hostname ||
  application.pathname !== migration.pathname ||
  !application.pathname.endsWith("_test") ||
  application.username === migration.username
) {
  throw new Error("intuecho_integration_database_forbidden");
}

const { Pool } = pg;
const pool = new Pool({ connectionString: applicationUrl, max: 4, ssl: false });
const migrationPool = new Pool({ connectionString: migrationUrl, max: 1, ssl: false });

async function waitForAdvisoryWait(minimum, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waiting = await pool.query(`
      SELECT count(*)::int AS count
        FROM pg_stat_activity
       WHERE wait_event_type = 'Lock'
         AND wait_event = 'advisory'
         AND query LIKE '%pg_advisory_xact_lock(hashtextextended%'
    `);
    if (waiting.rows[0].count >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`intuecho_advisory_wait_timeout:${minimum}`);
}

try {
  await migrationPool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  const allMigrations = readIntuechoMigrations();
  const migration015 = allMigrations.find((item) => item.name === "015_reply_projection_lifecycle.sql");
  assert.ok(migration015);
  const legacyMigrations = allMigrations.filter((item) => item.name < migration015.name);
  const legacyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "intuecho-migration-015-legacy-"));
  const projectionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "intuecho-migration-015-projection-"));
  for (const item of legacyMigrations) fs.writeFileSync(path.join(legacyDirectory, item.name), item.sql);
  fs.writeFileSync(path.join(projectionDirectory, migration015.name), migration015.sql);
  let migrated;
  try {
    const legacyMigration = await migrateIntuecho(migrationPool, {
      applicationRole: application.username,
      directory: legacyDirectory
    });
    assert.deepEqual(legacyMigration.applied, legacyMigrations.map((item) => item.name));
    await migrationPool.query(`
      BEGIN;
      INSERT INTO literature_records(id, title, authors)
      VALUES ('migration-015-literature', 'Legacy migration literature.', '[]'::jsonb);
      INSERT INTO annotations(
        id, body, author_id, author_name, author_initials, author_profile_snapshot,
        visibility, share_to_plaza
      ) VALUES (
        'migration-015-parent', 'Legacy reply parent.', 'legacy-author', 'Legacy Author', 'LA',
        '{}'::jsonb, 'public', false
      );
      INSERT INTO annotation_targets(id, annotation_id, literature_id, target_kind, position, target)
      VALUES (
        'migration-015-parent-target', 'migration-015-parent', 'migration-015-literature',
        'whole_document', 0, '{"kind":"whole_document"}'::jsonb
      );
      COMMIT;
    `);
    await migrationPool.query(`
      INSERT INTO annotation_replies(
        id, parent_annotation_id, body, author_id, author_name, author_initials,
        author_profile_snapshot, visibility
      ) VALUES (
        'migration-015-existing-reply', 'migration-015-parent', 'Existing active reply.',
        'legacy-author', 'Legacy Author', 'LA', '{}'::jsonb, 'public'
      )
    `);
    migrated = await migrateIntuecho(migrationPool, {
      applicationRole: application.username,
      directory: projectionDirectory
    });
  } finally {
    fs.rmSync(legacyDirectory, { force: true, recursive: true });
    fs.rmSync(projectionDirectory, { force: true, recursive: true });
  }
  assert.deepEqual(migrated.applied, [migration015.name]);
  const upgradedReply = await migrationPool.query(`
    SELECT deleted_at, moderated_at, moderated_by, moderation_reason
      FROM annotation_replies
     WHERE id = 'migration-015-existing-reply'
  `);
  assert.deepEqual(upgradedReply.rows, [{
    deleted_at: null,
    moderated_at: null,
    moderated_by: null,
    moderation_reason: null
  }]);
  const expectedMigrations = [
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
    "018_align_literature_identity_model.sql"
  ];
  assert.equal(migrated.applied.every((name) => expectedMigrations.includes(name)), true);
  const stagedMigrationRows = await pool.query("SELECT name FROM schema_migrations ORDER BY name");
  assert.deepEqual(stagedMigrationRows.rows.map((row) => row.name), expectedMigrations.slice(0, 15));
  const historicalLiteratureId = `migration-014-historical-${randomUUID()}`;
  const historicalVersionId = `migration-014-historical-version-${randomUUID()}`;
  const manualLiteratureId = `migration-014-manual-${randomUUID()}`;
  const manualVersionId = `migration-014-manual-version-${randomUUID()}`;
  const registryLiteratureId = `migration-014-registry-${randomUUID()}`;
  const registryVersionId = `migration-014-registry-version-${randomUUID()}`;
  const nonMigrationVersionId = `migration-014-non-migration-version-${randomUUID()}`;
  await migrationPool.query(`
    INSERT INTO literature_records(
      id, title, authors, publication_year, document_type, record_source, revision
    ) VALUES
      ($1, 'Current title', '["Current Author"]'::jsonb, 2026, 'report', 'legacy_metadata', 2),
      ($2, 'Current manual title', '["Current Manual Author"]'::jsonb, 2025, 'article', 'manual', 2),
      ($3, 'Current registry title', '["Current Registry Author"]'::jsonb, 2024, 'article', 'public_registry', 2)
  `, [historicalLiteratureId, manualLiteratureId, registryLiteratureId]);
  await migrationPool.query(`
    INSERT INTO literature_identities(literature_id, identity_kind, identity_value, identity_source)
    VALUES ($1, 'doi', $2, 'metadata')
  `, [historicalLiteratureId, `10.1000/current-${randomUUID()}`]);
  await migrationPool.query(`
    INSERT INTO literature_record_versions(id, literature_id, revision, snapshot, changed_by)
    VALUES
      ($1, $2, 1, $3::jsonb, 'migration_011'),
      ($4, $5, 1, $6::jsonb, 'migration_011'),
      ($7, $8, 1, $9::jsonb, 'migration_011'),
      ($10, $5, 2, $11::jsonb, 'manual_correction')
  `, [
    historicalVersionId,
    historicalLiteratureId,
    JSON.stringify({
      authors: ["Historical Author", "Second Historical Author"],
      documentType: "book",
      identifiers: [
        { kind: "doi", source: "metadata", value: "10.1000/historical-identity" },
        { kind: "title_authors_year_hash", source: "inferred", value: "historical-hash" }
      ],
      literatureId: historicalLiteratureId,
      provenance: { confirmedAt: null, mode: "manual", provider: null },
      title: "Historical title",
      year: 1998
    }),
    manualVersionId,
    manualLiteratureId,
    JSON.stringify({
      authors: ["Original Manual Author"],
      documentType: "preprint",
      identifiers: [{ kind: "arxiv_id", source: "metadata", value: "2401.00001" }],
      literatureId: manualLiteratureId,
      provenance: { confirmedAt: null, mode: "manual", provider: null },
      title: "Original manual title",
      year: 2023
    }),
    registryVersionId,
    registryLiteratureId,
    JSON.stringify({
      authors: ["Original Registry Author"],
      documentType: "article",
      identifiers: [{ kind: "openalex_id", source: "metadata", value: "W123456789" }],
      literatureId: registryLiteratureId,
      provenance: { confirmedAt: null, mode: "manual", provider: null },
      title: "Original registry title",
      year: 2022
    }),
    nonMigrationVersionId,
    JSON.stringify({
      literatureId: manualLiteratureId,
      provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual", provider: null },
      title: "Later manual correction"
    })
  ]);
  const correctiveMigration = readIntuechoMigrations().find((item) => item.name === "014_correct_legacy_literature_snapshots.sql");
  assert.ok(correctiveMigration);
  await migrationPool.query(correctiveMigration.sql);
  const correctedHistoricalSnapshot = await migrationPool.query(
    "SELECT snapshot, xmin::text AS xmin FROM literature_record_versions WHERE id = $1",
    [historicalVersionId]
  );
  assert.deepEqual(correctedHistoricalSnapshot.rows[0].snapshot, {
    authors: ["Historical Author", "Second Historical Author"],
    documentType: "book",
    identifiers: [
      { kind: "doi", source: "metadata", value: "10.1000/historical-identity" },
      { kind: "title_authors_year_hash", source: "inferred", value: "historical-hash" }
    ],
    literatureId: historicalLiteratureId,
    recordSource: "legacy_metadata",
    title: "Historical title",
    year: 1998
  }, "migration 014 must not rebuild historical revision 1 fields from current literature rows");
  const correctedUpgradedSnapshots = await migrationPool.query(`
    SELECT id, snapshot FROM literature_record_versions
     WHERE id = ANY($1::text[])
     ORDER BY id
  `, [[manualVersionId, registryVersionId]]);
  const upgradedSnapshotsById = new Map(correctedUpgradedSnapshots.rows.map((row) => [row.id, row.snapshot]));
  assert.deepEqual(upgradedSnapshotsById.get(manualVersionId), {
    authors: ["Original Manual Author"],
    documentType: "preprint",
    identifiers: [{ kind: "arxiv_id", source: "metadata", value: "2401.00001" }],
    literatureId: manualLiteratureId,
    recordSource: "legacy_metadata",
    title: "Original manual title",
    year: 2023
  }, "migration 014 must correct migration_011 history after the current source becomes manual");
  assert.deepEqual(upgradedSnapshotsById.get(registryVersionId), {
    authors: ["Original Registry Author"],
    documentType: "article",
    identifiers: [{ kind: "openalex_id", source: "metadata", value: "W123456789" }],
    literatureId: registryLiteratureId,
    recordSource: "legacy_metadata",
    title: "Original registry title",
    year: 2022
  }, "migration 014 must correct migration_011 history after the current source becomes public_registry");
  const untouchedNonMigrationSnapshot = await migrationPool.query(
    "SELECT snapshot FROM literature_record_versions WHERE id = $1",
    [nonMigrationVersionId]
  );
  assert.deepEqual(untouchedNonMigrationSnapshot.rows[0].snapshot, {
    literatureId: manualLiteratureId,
    provenance: { confirmedAt: "2026-08-09T00:00:00.000Z", mode: "manual", provider: null },
    title: "Later manual correction"
  }, "migration 014 must not alter snapshots written outside migration_011");
  await migrationPool.query(correctiveMigration.sql);
  const rerunHistoricalSnapshot = await migrationPool.query(
    "SELECT snapshot, xmin::text AS xmin FROM literature_record_versions WHERE id = $1",
    [historicalVersionId]
  );
  assert.deepEqual(rerunHistoricalSnapshot.rows[0].snapshot, correctedHistoricalSnapshot.rows[0].snapshot);
  assert.equal(rerunHistoricalSnapshot.rows[0].xmin, correctedHistoricalSnapshot.rows[0].xmin);
  const restoredLiteratureVersionTrigger = await migrationPool.query(`
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'literature_record_versions_append_only'
       AND NOT tgisinternal
  `);
  assert.equal(restoredLiteratureVersionTrigger.rowCount, 1);
  await assert.rejects(
    () => migrationPool.query("UPDATE literature_record_versions SET changed_by = 'tampered' WHERE id = $1", [historicalVersionId]),
    /literature_record_version_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query("DELETE FROM literature_record_versions WHERE id = $1", [historicalVersionId]),
    /literature_record_version_is_append_only/
  );
  if (migration014Only) {
    process.stdout.write(`${JSON.stringify({ migration014: true, verified: true })}\n`);
    await pool.end();
    await migrationPool.end();
    process.exit(0);
  }
  const legacyAggregateId = `migration-017-aggregate-${randomUUID()}`;
  await migrationPool.query(`
    INSERT INTO literature_records(
      id, title, authors, publication_year, document_type, record_source,
      source_provider, confirmed_at, revision
    ) VALUES ($1, 'Legacy aggregate title', '["Aggregate Author"]'::jsonb, 2026,
      'article', 'public_registry', 'openalex', now(), 1)
  `, [legacyAggregateId]);
  await migrationPool.query(`
    INSERT INTO literature_identities(
      literature_id, identity_kind, identity_value, identity_source
    ) VALUES ($1, 'openalex_id', 'W170000001', 'public_registry')
  `, [legacyAggregateId]);
  const sourceConfirmedMigration = await migrateIntuecho(migrationPool, {
    applicationRole: application.username
  });
  assert.deepEqual(sourceConfirmedMigration.applied, [
    "016_source_confirmed_literature_identity.sql",
    "017_constrain_legacy_aggregate_confirmation.sql",
    "018_align_literature_identity_model.sql"
  ]);
  assert.deepEqual(await verifyIntuechoMigrations(pool), { count: 18, current: true });
  const constrainedLegacyAggregate = await migrationPool.query(
    "SELECT confirmation_status FROM literature_records WHERE id = $1",
    [legacyAggregateId]
  );
  assert.equal(constrainedLegacyAggregate.rows[0].confirmation_status, "legacy_unverified");
  await migrationPool.query(`
    DO $$
    DECLARE tables text;
    BEGIN
      SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
        INTO tables
        FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> 'schema_migrations';
      IF tables IS NOT NULL THEN
        EXECUTE 'TRUNCATE TABLE ' || tables || ' RESTART IDENTITY CASCADE';
      END IF;
    END
    $$
  `);
  await assert.rejects(
    () => pool.query("CREATE TABLE application_role_must_not_create(id text)"),
    /permission denied/
  );

  const provenanceColumns = await migrationPool.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'literature_records'
       AND column_name IN ('record_source', 'source_provider', 'confirmed_at', 'revision', 'confirmation_status', 'version_kind')
     ORDER BY column_name
  `);
  assert.deepEqual(provenanceColumns.rows.map((row) => row.column_name), ["confirmation_status", "confirmed_at", "record_source", "revision", "source_provider", "version_kind"]);
  const identityModelColumns = await migrationPool.query(`
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (
         (table_name = 'literature_identifiers' AND column_name = 'id')
         OR (table_name = 'literature_identity_claims' AND column_name = 'identifier_id')
       )
     ORDER BY table_name, column_name
  `);
  assert.deepEqual(identityModelColumns.rows, [
    { column_name: "id", table_name: "literature_identifiers" },
    { column_name: "identifier_id", table_name: "literature_identity_claims" }
  ]);
  const versionTrigger = await migrationPool.query(`
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'literature_record_versions_append_only'
       AND NOT tgisinternal
  `);
  assert.equal(versionTrigger.rowCount, 1);
  const provenanceConstraints = await migrationPool.query(`
    SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE conrelid IN ('literature_records'::regclass, 'literature_identities'::regclass)
       AND conname IN (
         'literature_records_record_source_check',
         'literature_records_revision_check',
         'literature_identities_identity_kind_check',
         'literature_identities_identity_source_check'
       )
     ORDER BY conname
  `);
  assert.equal(provenanceConstraints.rowCount, 4);
  assert.match(provenanceConstraints.rows.find((row) => row.conname === "literature_records_record_source_check").definition, /public_registry/);
  assert.match(provenanceConstraints.rows.find((row) => row.conname === "literature_identities_identity_kind_check").definition, /openalex_id/);
  assert.match(provenanceConstraints.rows.find((row) => row.conname === "literature_identities_identity_source_check").definition, /manual/);
  await migrationPool.query(`
    INSERT INTO literature_records(id, title, authors, record_source, confirmed_at)
    VALUES ('migration-provenance-record', 'Migration provenance', '[]'::jsonb, 'manual', now())
  `);
  await migrationPool.query(`
    INSERT INTO literature_record_versions(id, literature_id, revision, snapshot, changed_by)
    VALUES ('migration-provenance-version', 'migration-provenance-record', 1, '{"title":"Migration provenance"}', 'integration')
  `);
  await assert.rejects(
    () => migrationPool.query("UPDATE literature_records SET record_source = 'invalid' WHERE id = 'migration-provenance-record'"),
    /literature_records_record_source_check/
  );
  await assert.rejects(
    () => migrationPool.query("INSERT INTO literature_identities(literature_id, identity_kind, identity_value, identity_source) VALUES ('migration-provenance-record', 'doi', '10.1000/read-only', 'manual')"),
    /legacy_literature_identity_is_read_only/
  );
  await assert.rejects(
    () => migrationPool.query("UPDATE literature_record_versions SET changed_by = 'tampered' WHERE id = 'migration-provenance-version'"),
    /literature_record_version_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query("DELETE FROM literature_record_versions WHERE id = 'migration-provenance-version'"),
    /literature_record_version_is_append_only/
  );

  const empty = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM topics) AS topics,
      (SELECT count(*)::int FROM works) AS works,
      (SELECT count(*)::int FROM posts) AS posts,
      (SELECT count(*)::int FROM drafts) AS drafts,
      (SELECT count(*)::int FROM feedback) AS feedback,
      (SELECT count(*)::int FROM annotations) AS annotations,
      (SELECT count(*)::int FROM annotation_tag_appeals) AS tag_appeals
  `);
  assert.deepEqual(empty.rows[0], {
    annotations: 0,
    drafts: 0,
    feedback: 0,
    posts: 0,
    tag_appeals: 0,
    topics: 0,
    works: 0
  });

  const repository = new PostgresForumRepository(pool);
  const topic = await repository.createTopic({
    description: "研究真实生产论坛的事务与身份边界。",
    name: "可靠研究协作"
  });
  await pool.query(`
    INSERT INTO works(id, topic_id, title, authors, year, venue, identifier, abstract)
    VALUES ('work-1', $1, 'Transactional Forums', 'Research Team', 2026, 'Systems',
            'doi:10.1000/forum', 'A production integration fixture inserted only by this test.')
  `, [topic.id]);

  const draft = await repository.createContextualDraft("user-1", {
    anchorHash: "anchor-hash-1",
    citationEnabled: true,
    excerpt: "Evidence from a real PostgreSQL transaction.",
    language: "zh-CN",
    page: 3,
    topicId: topic.id,
    workId: "work-1"
  });
  await repository.updateDraft(draft.draftId, "user-1", {
    body: "这是一条由正式 PostgreSQL 仓库发布的帖子。",
    citationEnabled: true,
    tags: ["事务", "审计", "事务"],
    title: "正式论坛边界"
  });
  const author = { id: "user-1", initials: "同名", name: "同名研究者" };
  const published = await repository.publishDraft(draft.draftId, author);
  assert.equal(published.replayed, false);
  assert.deepEqual(await repository.publishDraft(draft.draftId, author), {
    ...published,
    replayed: true
  });

  const posts = await repository.listPosts("user-1", { topicId: topic.id });
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].tags, ["事务", "审计"]);
  assert.equal(posts[0].viewer_is_author, true);
  assert.equal((await repository.search("PostgreSQL", "事务", undefined)).length, 1);
  await assert.rejects(
    () => repository.withdrawPost(published.postId, "user-2"),
    /NOT_POST_AUTHOR/
  );

  assert.deepEqual(await repository.toggleFollow(topic.id, "user-1"), {
    followerCount: 1,
    following: true
  });
  assert.deepEqual(await repository.toggleSave("topic", topic.id, "user-1"), { saved: true });
  assert.deepEqual(await repository.toggleSave("post", published.postId, "user-1"), { saved: true });
  assert.deepEqual(await repository.toggleSignal(published.postId, "user-1", "helpful"), {
    helpful: 1,
    ok: true,
    selectedSignal: "helpful"
  });
  const comment = await repository.createComment(published.postId, author, "补充一条可保存的评论。");
  assert.equal(comment.author_id, "user-1");
  assert.deepEqual(await repository.toggleSave("comment", comment.id, "user-1"), { saved: true });
  const saved = await repository.listSaved("user-1");
  assert.deepEqual(saved.topics.map((item) => item.id), [topic.id]);
  assert.deepEqual(saved.posts.map((item) => item.id), [published.postId]);
  assert.deepEqual(saved.comments.map((item) => item.id), [comment.id]);
  assert.deepEqual(await repository.listSaved("user-2"), { comments: [], posts: [], topics: [] });

  const withdrawn = await repository.moderatePost({
    action: "withdraw",
    adminId: "admin-1",
    postId: published.postId,
    reason: "生产集成测试治理动作",
    traceId: "trace-moderation-1"
  });
  assert.equal(withdrawn.action, "withdraw");
  assert.equal((await repository.listPosts(undefined, { topicId: topic.id })).length, 0);
  await repository.moderatePost({
    action: "restore",
    adminId: "admin-1",
    postId: published.postId,
    reason: "生产集成测试恢复动作",
    traceId: "trace-moderation-2"
  });
  assert.equal((await repository.listPosts(undefined, { topicId: topic.id })).length, 1);

  const audit = await pool.query(
    "SELECT action, admin_user_id, trace_id FROM moderation_audit ORDER BY created_at, id"
  );
  assert.deepEqual(audit.rows, [
    { action: "withdraw", admin_user_id: "admin-1", trace_id: "trace-moderation-1" },
    { action: "restore", admin_user_id: "admin-1", trace_id: "trace-moderation-2" }
  ]);
  await assert.rejects(
    () => pool.query("UPDATE moderation_audit SET reason = 'tampered'"),
    /permission denied|moderation_audit_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query("UPDATE moderation_audit SET reason = 'tampered'"),
    /moderation_audit_is_append_only/
  );
  await assert.rejects(
    () => pool.query(`
      INSERT INTO works(id, topic_id, title, authors, year, venue, abstract)
      VALUES ('cross-topic-work', 'missing-topic', 'Invalid', 'Nobody', 2026, 'None', '')
    `),
    /foreign key constraint/
  );

  const organizationAuthorizations = [];
  const organizationInvitations = [];
  const organizationModerations = [];
  const annotations = new PostgresAnnotationCommunityRepository(pool, {
    async authorizeOrganizationAccess(input) {
      organizationModerations.push(input);
      return { allowed: input.organizationId === "org-integration" && input.userId === "user-2", role: "admin" };
    },
    async authorizeOrganizationInvitation(input) {
      organizationInvitations.push(input);
      assert.equal(input.organizationId, "org-integration");
      assert.equal(input.inviterId, "user-1");
      assert.equal(input.invitedUserId, "user-2");
      return { invitationId: "orginvite-integration", organizationRevision: 8 };
    },
    async authorizeOrganizationVisibility(input) {
      organizationAuthorizations.push(input);
      return input.organizationId === "org-integration" && input.userId === "user-1";
    },
    async listOrganizations(userId) {
      return userId === "user-2" ? [{ name: "证据研究组织", organizationId: "org-integration", role: "admin" }] : [];
    }
  });
  const literatureOwner = { id: "literature-integration-owner", initials: "LO", name: "Literature Owner" };
  const confirmedLiteratureCandidate = {
    candidateKey: "crossref:doi:10.1000/integration-confirmed",
    provider: "crossref",
    record: {
      authors: ["Ada Lovelace"],
      documentType: "journal_article",
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/integration-confirmed" }],
      title: "Integration Confirmed Literature",
      year: 1843
    }
  };
  const confirmedLiterature = await annotations.confirmRefetchedLiterature(
    literatureOwner,
    confirmedLiteratureCandidate
  );
  assert.equal(confirmedLiterature.status, "confirmed");
  assert.equal(confirmedLiterature.provenance.mode, "public_registry");
  const concurrentLiterature = await Promise.all([
    annotations.confirmRefetchedLiterature(literatureOwner, confirmedLiteratureCandidate),
    annotations.confirmRefetchedLiterature({ id: "literature-integration-second-owner" }, confirmedLiteratureCandidate)
  ]);
  assert.deepEqual(concurrentLiterature.map((item) => item.literatureId), [
    confirmedLiterature.literatureId,
    confirmedLiterature.literatureId
  ]);
  const identityCorrectedLiterature = await annotations.confirmRefetchedLiterature(literatureOwner, {
    candidateKey: confirmedLiteratureCandidate.candidateKey,
    provider: "crossref",
    record: {
      authors: ["Ada Lovelace"],
      documentType: "journal_article",
      identifiers: [
        { kind: "doi", source: "public_registry", value: "10.1000/integration-confirmed" },
        { kind: "openalex_id", source: "public_registry", value: "w424242" }
      ],
      title: "Integration Confirmed Literature",
      year: 1843
    }
  });
  assert.deepEqual(identityCorrectedLiterature.identifiers.map((identifier) => `${identifier.kind}:${identifier.value}`), [
    "doi:10.1000/integration-confirmed",
    "openalex_id:W424242"
  ]);
  const identityCorrectionState = await pool.query(`
    SELECT
      record.revision,
      version.snapshot -> 'identifiers' AS prior_identifiers
      FROM literature_records AS record
      JOIN literature_record_versions AS version
        ON version.literature_id = record.id AND version.revision = 1
     WHERE record.id = $1
  `, [confirmedLiterature.literatureId]);
  assert.equal(Number(identityCorrectionState.rows[0].revision), 2);
  assert.deepEqual(identityCorrectionState.rows[0].prior_identifiers, [
    { kind: "doi", source: "public_registry", value: "10.1000/integration-confirmed" }
  ]);
  const secondLiterature = await annotations.confirmRefetchedLiterature(literatureOwner, {
    candidateKey: "crossref:doi:10.1000/integration-other",
    provider: "crossref",
    record: {
      authors: ["Grace Hopper"],
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/integration-other" }],
      title: "Integration Other Literature",
      year: 1952
    }
  });
  const relatedPreprint = await annotations.confirmRefetchedLiterature(literatureOwner, {
    candidateKey: "arxiv:arxiv_id:2401.01234",
    provider: "arxiv",
    record: {
      authors: ["Evidence Author"],
      documentType: "preprint",
      identifiers: [{ kind: "arxiv_id", source: "public_registry", value: "2401.01234" }],
      title: "Evidenced Version Relation",
      year: 2024
    },
    relations: [{
      direction: "from_current",
      evidence: { sourceField: "arxiv:doi" },
      relationType: "is_preprint_of",
      targetIdentifier: { kind: "doi", value: "10.1000/evidenced-publication" }
    }]
  });
  const relatedPublication = await annotations.confirmRefetchedLiterature(literatureOwner, {
    candidateKey: "crossref:doi:10.1000/evidenced-publication",
    provider: "crossref",
    record: {
      authors: ["Evidence Author"],
      documentType: "journal_article",
      identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/evidenced-publication" }],
      title: "Evidenced Version Relation",
      year: 2024
    }
  });
  assert.deepEqual((await annotations.findLiteratureRelations(relatedPreprint.literatureId)).map((relation) => ({
    ...relation,
    createdAt: "timestamp"
  })), [{
    createdAt: "timestamp",
    evidence: {
      candidateKey: "arxiv:arxiv_id:2401.01234",
      sourceField: "arxiv:doi",
      targetIdentifier: { kind: "doi", value: "10.1000/evidenced-publication" }
    },
    fromLiteratureId: relatedPreprint.literatureId,
    provider: "arxiv",
    relationType: "is_preprint_of",
    toLiteratureId: relatedPublication.literatureId,
    verificationStatus: "confirmed"
  }]);
  await assert.rejects(
    () => annotations.confirmRefetchedLiterature(literatureOwner, {
      candidateKey: confirmedLiteratureCandidate.candidateKey,
      provider: "crossref",
      record: {
        authors: ["Ada Lovelace"],
        identifiers: [
          { kind: "doi", source: "public_registry", value: "10.1000/integration-confirmed" },
          { kind: "doi", source: "public_registry", value: "10.1000/integration-other" }
        ],
        title: "Integration Conflict",
        year: 1843
      }
    }),
    /LITERATURE_IDENTITY_CONFLICT/
  );
  assert.equal((await annotations.findLiteratureByIdentifiers(secondLiterature.identifiers)).literatureId, secondLiterature.literatureId);
  const userOne = { id: "user-1", initials: "同名", name: "同名研究者" };
  const userTwo = { id: "user-2", initials: "证据", name: "证据复核者" };
  assert.deepEqual(await annotations.updateProfile(userOne.id, {
    educationStage: "博士研究生",
    institutions: [{ name: "证据研究院" }]
  }), {
    educationStage: "博士研究生",
    institutions: [{ name: "证据研究院" }],
    revision: 1
  });
  const literature = { literatureId: confirmedLiterature.literatureId };
  const wholeDocument = { kind: "whole_document", literature };
  const sourcePassage = {
    anchorHash: "sha256:postgres-source-evidence",
    excerpt: "PostgreSQL preserves the cited source passage.",
    kind: "source_passage",
    literature,
    page: 4,
    rects: []
  };
  const derivedPassage = {
    derivedContent: {
      artifactId: "artifact-postgres-integration",
      excerpt: "薄读生成内容必须携带原始文献证据。",
      nodeId: "node-evidence",
      version: "thin-reading-v1"
    },
    evidence: [{
      anchorHash: sourcePassage.anchorHash,
      excerpt: sourcePassage.excerpt,
      literature,
      page: sourcePassage.page,
      rects: []
    }],
    kind: "derived_passage",
    literature
  };
  const sharedBody = "正式 PostgreSQL 批注保存薄读证据、事务边界与语义标签。";
  const semanticSeed = await annotations.createAnnotation(userTwo, {
    body: sharedBody,
    shareToPlaza: true,
    tags: ["证据分类"],
    targets: [wholeDocument],
    visibility: "public"
  });
  const publicAnnotation = await annotations.createAnnotation(userOne, {
    body: sharedBody,
    shareToPlaza: true,
    tags: ["生产验证"],
    targets: [wholeDocument, derivedPassage],
    visibility: "public"
  });
  assert.equal(publicAnnotation.targets.length, 2);
  assert.equal(publicAnnotation.targets.find((target) => target.kind === "derived_passage").evidence.length, 1);
  assert.deepEqual(publicAnnotation.author.profile, {
    educationStage: "博士研究生",
    institutions: [{ name: "证据研究院" }]
  });
  assert.equal(publicAnnotation.tags.some((tag) =>
    tag.name === "证据分类" && tag.origin === "platform" && tag.state === "active"
  ), true);
  const canonicalReference = { literatureId: confirmedLiterature.literatureId };
  const canonicalRead = await annotations.createAnnotation(literatureOwner, {
    body: "Canonical display data is hydrated only at the read boundary.",
    shareToPlaza: true,
    tags: [],
    targets: [{
      derivedContent: {
        artifactId: "artifact-canonical-hydration",
        excerpt: "Canonical hydration includes derived evidence.",
        nodeId: "node-canonical-hydration",
        version: "thin-reading-v1"
      },
      evidence: [{
        anchorHash: "sha256:canonical-hydration-evidence",
        excerpt: "Canonical evidence preserves its source record.",
        literature: canonicalReference,
        rects: []
      }],
      kind: "derived_passage",
      literature: canonicalReference
    }],
    visibility: "public"
  });
  assert.equal(canonicalRead.targets[0].literature.literatureRecord.title, "Integration Confirmed Literature");
  assert.equal(canonicalRead.targets[0].evidence[0].literature.literatureRecord.title, "Integration Confirmed Literature");
  const storedCanonicalTarget = await pool.query("SELECT target FROM annotation_targets WHERE annotation_id = $1", [canonicalRead.id]);
  const storedCanonicalEvidence = await pool.query("SELECT evidence FROM annotation_target_evidence WHERE target_id = (SELECT id FROM annotation_targets WHERE annotation_id = $1)", [canonicalRead.id]);
  assert.equal(storedCanonicalTarget.rows[0].target.literature.literatureRecord, undefined);
  assert.equal(storedCanonicalEvidence.rows[0].evidence.literature.literatureRecord, undefined);
  const titleSearch = await annotations.plaza(userOne, { query: "Integration Confirmed Literature" });
  assert.equal(titleSearch.some((annotation) => annotation.id === canonicalRead.id), true);
  await annotations.updateAnnotation(publicAnnotation.id, userOne, {
    body: `${sharedBody} 编辑后保留历史版本。`
  });

  const authoredPublicReply = await annotations.createReply(publicAnnotation.id, userOne, {
    body: "公开回复在账号注销时保留正文并去除身份信息。",
    publishAsAnnotation: false,
    tags: [],
    targets: []
  });
  await annotations.updateReply(authoredPublicReply.reply.id, userOne, {
    body: "公开回复编辑后仍需保留匿名历史。"
  });

  const publicReply = await annotations.createReply(publicAnnotation.id, userTwo, {
    body: "回复原批注，并以自己的文献字句同步进入广场。",
    publishAsAnnotation: true,
    tags: ["回复证据"],
    targets: [sourcePassage]
  });
  assert.equal(publicReply.reply.parentAnnotationId, publicAnnotation.id);
  assert.equal(publicReply.reply.derivedAnnotationId, publicReply.annotation.id);
  assert.deepEqual((await annotations.replies(publicAnnotation.id, userOne)).map((item) => item.id), [
    authoredPublicReply.reply.id,
    publicReply.reply.id
  ]);
  const replyModerationColumns = await migrationPool.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'annotation_replies'
       AND column_name IN ('moderated_at', 'moderation_reason', 'moderated_by')
     ORDER BY column_name
  `);
  assert.deepEqual(replyModerationColumns.rows.map((row) => row.column_name), [
    'moderated_at',
    'moderated_by',
    'moderation_reason'
  ]);
  const auditLinkColumns = await migrationPool.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'annotation_moderation_audit'
       AND column_name = 'linked_reply_id'
  `);
  assert.deepEqual(auditLinkColumns.rows.map((row) => row.column_name), ['linked_reply_id']);
  const activeReply = await migrationPool.query(`
    SELECT deleted_at, moderated_at, moderated_by, moderation_reason
      FROM annotation_replies
     WHERE id = $1
  `, [authoredPublicReply.reply.id]);
  assert.deepEqual(activeReply.rows, [{
    deleted_at: null,
    moderated_at: null,
    moderated_by: null,
    moderation_reason: null
  }]);
  const linkedReplyAudit = await migrationPool.query(`
    INSERT INTO annotation_moderation_audit(
      id, annotation_id, linked_reply_id, action, reason, admin_user_id, trace_id
    ) VALUES (
      'linked-reply-audit', $1, $2, 'withdraw',
      'Linked reply moderation audit.', 'admin-1', 'trace-linked-reply-audit'
    )
    RETURNING annotation_id, linked_reply_id
  `, [publicReply.annotation.id, publicReply.reply.id]);
  assert.deepEqual(linkedReplyAudit.rows, [{
    annotation_id: publicReply.annotation.id,
    linked_reply_id: publicReply.reply.id
  }]);
  await assert.rejects(
    () => migrationPool.query(`
      INSERT INTO annotation_moderation_audit(
        id, annotation_id, linked_reply_id, action, reason, admin_user_id, trace_id
      ) VALUES (
        'invalid-linked-reply-audit', $1, $2, 'withdraw',
        'An unrelated reply cannot be audited as a projection.', 'admin-1', 'trace-invalid-linked-reply'
      )
    `, [publicReply.annotation.id, authoredPublicReply.reply.id]),
    /annotation_moderation_audit_linked_reply_invalid/
  );
  await assert.rejects(
    () => migrationPool.query(
      "UPDATE annotation_moderation_audit SET reason = 'tampered' WHERE id = 'linked-reply-audit'"
    ),
    /annotation_moderation_audit_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query(
      "DELETE FROM annotation_moderation_audit WHERE id = 'linked-reply-audit'"
    ),
    /annotation_moderation_audit_is_append_only/
  );

  const lifecycleAnnotations = new PostgresAnnotationCommunityRepository(pool, {
    async authorizeOrganizationAccess({ organizationId, userId }) {
      return {
        allowed: new Set(["org-lifecycle", "org-lifecycle-other"]).has(organizationId) && new Set(["scope-user-1", "scope-user-2", "scope-user-3"]).has(userId),
        role: userId === "scope-user-3" ? "admin" : "member"
      };
    },
    async authorizeOrganizationVisibility({ organizationId, userId }) {
      return new Set(["org-lifecycle", "org-lifecycle-other"]).has(organizationId) && new Set(["scope-user-1", "scope-user-2", "scope-user-3"]).has(userId);
    }
  });
  const scopeUserOne = { id: "scope-user-1", initials: "S1", name: "Scope User One" };
  const scopeUserTwo = { id: "scope-user-2", initials: "S2", name: "Scope User Two" };
  const scopeUserThree = { id: "scope-user-3", initials: "S3", name: "Scope User Three" };
  const scopeUserFour = { id: "scope-user-4", initials: "S4", name: "Scope User Four" };
  const scopeUserFive = { id: "scope-user-5", initials: "S5", name: "Scope User Five" };
  await lifecycleAnnotations.toggleFollow(scopeUserOne.id, scopeUserTwo.id);
  await lifecycleAnnotations.toggleFollow(scopeUserTwo.id, scopeUserOne.id);
  await lifecycleAnnotations.toggleFollow(scopeUserTwo.id, scopeUserThree.id);
  await lifecycleAnnotations.toggleFollow(scopeUserThree.id, scopeUserTwo.id);
  await lifecycleAnnotations.toggleFollow(scopeUserOne.id, scopeUserFour.id);
  await lifecycleAnnotations.toggleFollow(scopeUserFour.id, scopeUserOne.id);
  await lifecycleAnnotations.toggleFollow(scopeUserFive.id, scopeUserTwo.id);
  await lifecycleAnnotations.toggleFollow(scopeUserTwo.id, scopeUserFive.id);
  await lifecycleAnnotations.toggleFollow(scopeUserFive.id, scopeUserFour.id);
  await lifecycleAnnotations.toggleFollow(scopeUserFour.id, scopeUserFive.id);
  const scopeCases = [
    { author: scopeUserOne, name: "public", replyAuthor: scopeUserTwo, shareToPlaza: true, viewer: scopeUserOne },
    {
      author: scopeUserOne,
      name: "organization",
      organizationId: "org-lifecycle",
      replyAuthor: scopeUserTwo,
      shareToPlaza: false,
      viewer: scopeUserOne
    },
    {
      author: scopeUserOne,
      name: "mutual_followers",
      replyAuthor: scopeUserTwo,
      shareToPlaza: false,
      viewer: scopeUserOne
    },
    { author: scopeUserOne, name: "private", replyAuthor: scopeUserOne, shareToPlaza: false, viewer: scopeUserOne }
  ];
  const scopedProjectionIds = [];
  for (const scope of scopeCases) {
    const parent = await lifecycleAnnotations.createAnnotation(scope.author, {
      body: `${scope.name} lifecycle parent`,
      organizationId: scope.organizationId,
      shareToPlaza: scope.name === "public",
      tags: [],
      targets: [wholeDocument],
      visibility: scope.name
    });
    const projected = await lifecycleAnnotations.createReply(parent.id, scope.replyAuthor, {
      body: `${scope.name} lifecycle projection`,
      publishAsAnnotation: true,
      tags: ["scope"],
      targets: [sourcePassage]
    });
    assert.equal(projected.annotation.visibility, scope.name);
    assert.equal(projected.annotation.organizationId, scope.organizationId ?? null);
    assert.equal(projected.annotation.shareToPlaza, scope.shareToPlaza);
    assert.equal(projected.reply.derivedAnnotationState, "published");
    assert.equal((await lifecycleAnnotations.annotation(projected.annotation.id, scope.viewer)).id, projected.annotation.id);
    scopedProjectionIds.push({ id: projected.annotation.id, name: scope.name });
    if (scope.name !== "public") {
      await assert.rejects(
        () => lifecycleAnnotations.updateAnnotation(projected.annotation.id, scope.replyAuthor, {
          shareToPlaza: true,
          visibility: "public"
        }),
        (error) => error.code === "REPLY_VISIBILITY_MISMATCH"
      );
    }
    if (scope.name === "mutual_followers") {
      await assert.rejects(
        () => lifecycleAnnotations.annotation(parent.id, scopeUserThree),
        (error) => error.code === "ANNOTATION_NOT_FOUND"
      );
      await assert.rejects(
        () => lifecycleAnnotations.annotation(projected.annotation.id, scopeUserThree),
        (error) => error.code === "ANNOTATION_NOT_FOUND"
      );
    }
  }
  const scopedPlazaIds = new Set((await lifecycleAnnotations.plaza(scopeUserOne)).map((annotation) => annotation.id));
  assert.deepEqual(
    scopedProjectionIds.filter(({ id }) => scopedPlazaIds.has(id)).map(({ name }) => name),
    ["public"]
  );

  const scopeLockedPublic = await lifecycleAnnotations.createAnnotation(scopeUserOne, {
    body: "PostgreSQL public scope lock",
    shareToPlaza: true,
    tags: [],
    targets: [wholeDocument],
    visibility: "public"
  });
  const scopeLockedPureReply = await lifecycleAnnotations.createReply(scopeLockedPublic.id, scopeUserTwo, {
    body: "PostgreSQL pure reply locks parent scope",
    publishAsAnnotation: false,
    tags: [],
    targets: []
  });
  await assert.rejects(
    () => lifecycleAnnotations.updateAnnotation(scopeLockedPublic.id, scopeUserOne, {
      organizationId: null,
      shareToPlaza: false,
      visibility: "private"
    }),
    (error) => error.code === "ANNOTATION_SCOPE_LOCKED_BY_REPLIES" && error.status === 409
  );
  await pool.query("UPDATE annotations SET visibility = 'private', share_to_plaza = false WHERE id = $1", [scopeLockedPublic.id]);
  await assert.rejects(
    () => lifecycleAnnotations.updateReplyPublication(scopeLockedPureReply.reply.id, scopeUserTwo, {
      published: true,
      tags: [],
      targets: [sourcePassage]
    }),
    (error) => error.code === "REPLY_VISIBILITY_MISMATCH"
  );
  assert.equal(Number((await pool.query("SELECT count(*) FROM annotations WHERE source_reply_id = $1", [scopeLockedPureReply.reply.id])).rows[0].count), 0);

  const scopeLockedOrganization = await lifecycleAnnotations.createAnnotation(scopeUserOne, {
    body: "PostgreSQL organization scope lock",
    organizationId: "org-lifecycle",
    shareToPlaza: false,
    tags: [],
    targets: [wholeDocument],
    visibility: "organization"
  });
  await lifecycleAnnotations.createReply(scopeLockedOrganization.id, scopeUserTwo, {
    body: "PostgreSQL organization reply locks reassignment",
    publishAsAnnotation: false,
    tags: [],
    targets: []
  });
  await assert.rejects(
    () => lifecycleAnnotations.updateAnnotation(scopeLockedOrganization.id, scopeUserOne, { organizationId: "org-lifecycle-other" }),
    (error) => error.code === "ANNOTATION_SCOPE_LOCKED_BY_REPLIES" && error.status === 409
  );

  const nestedRoot = await lifecycleAnnotations.createAnnotation(scopeUserOne, {
    body: "PostgreSQL transitive audience root",
    shareToPlaza: false,
    tags: [],
    targets: [wholeDocument],
    visibility: "mutual_followers"
  });
  const nestedProjectionB = await lifecycleAnnotations.createReply(nestedRoot.id, scopeUserTwo, {
    body: "PostgreSQL nested projection B",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  const nestedProjectionC = await lifecycleAnnotations.createReply(nestedProjectionB.annotation.id, scopeUserFour, {
    body: "PostgreSQL nested projection C",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  assert.equal((await lifecycleAnnotations.annotation(nestedProjectionC.annotation.id, scopeUserOne)).id, nestedProjectionC.annotation.id);
  await assert.rejects(
    () => lifecycleAnnotations.annotation(nestedProjectionC.annotation.id, scopeUserFive),
    (error) => error.code === "ANNOTATION_NOT_FOUND"
  );
  assert.equal((await lifecycleAnnotations.followingFeed(scopeUserFive)).some((annotation) => annotation.id === nestedProjectionC.annotation.id), false);
  await assert.rejects(
    () => lifecycleAnnotations.rateAnnotation(nestedProjectionC.annotation.id, scopeUserFive, 5),
    (error) => error.code === "ANNOTATION_NOT_FOUND"
  );
  await assert.rejects(
    () => lifecycleAnnotations.toggleSave(nestedProjectionC.annotation.id, scopeUserFive),
    (error) => error.code === "ANNOTATION_NOT_FOUND"
  );
  await assert.rejects(
    () => lifecycleAnnotations.createReply(nestedProjectionC.annotation.id, scopeUserFive, {
      body: "Must not attach outside the root audience",
      publishAsAnnotation: false,
      tags: [],
      targets: []
    }),
    (error) => error.code === "PARENT_ANNOTATION_NOT_FOUND"
  );
  await pool.query("UPDATE annotation_replies SET derived_annotation_id = NULL WHERE id = $1", [nestedProjectionC.reply.id]);
  await assert.rejects(
    () => lifecycleAnnotations.annotation(nestedProjectionC.annotation.id, scopeUserFour),
    (error) => error.code === "ANNOTATION_NOT_FOUND"
  );

  const organizationGovernedParent = await lifecycleAnnotations.createAnnotation(scopeUserOne, {
    body: "PostgreSQL organization governed parent",
    organizationId: "org-lifecycle",
    shareToPlaza: false,
    tags: [],
    targets: [wholeDocument],
    visibility: "organization"
  });
  const organizationGovernedProjection = await lifecycleAnnotations.createReply(organizationGovernedParent.id, scopeUserTwo, {
    body: "PostgreSQL organization governed projection",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  await lifecycleAnnotations.moderateOrganizationAnnotation({
    action: "withdraw",
    annotationId: organizationGovernedProjection.annotation.id,
    reason: "Organization withdraws linked projection.",
    traceId: "trace-org-linked-withdraw",
    userId: scopeUserThree.id
  });
  assert.equal((await lifecycleAnnotations.replies(organizationGovernedParent.id, scopeUserOne)).length, 0);
  const organizationLinkedAudit = await pool.query("SELECT linked_reply_id FROM annotation_moderation_audit WHERE annotation_id = $1", [organizationGovernedProjection.annotation.id]);
  assert.deepEqual(organizationLinkedAudit.rows, [{ linked_reply_id: organizationGovernedProjection.reply.id }]);
  await lifecycleAnnotations.moderateOrganizationAnnotation({
    action: "restore",
    annotationId: organizationGovernedProjection.annotation.id,
    reason: "Organization restores linked projection.",
    traceId: "trace-org-linked-restore",
    userId: scopeUserThree.id
  });

  const provenanceParent = await lifecycleAnnotations.createAnnotation(scopeUserOne, {
    body: "PostgreSQL moderation provenance parent",
    organizationId: "org-lifecycle",
    shareToPlaza: false,
    tags: [],
    targets: [wholeDocument],
    visibility: "organization"
  });
  const platformProvenanceProjection = await lifecycleAnnotations.createReply(provenanceParent.id, scopeUserTwo, {
    body: "Platform withdrawal superseded by author",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  await lifecycleAnnotations.moderateAnnotation({
    action: "withdraw",
    adminId: "admin-1",
    annotationId: platformProvenanceProjection.annotation.id,
    reason: "Platform withdraws before author override.",
    traceId: "trace-platform-author-override-withdraw"
  });
  await lifecycleAnnotations.updateReplyPublication(platformProvenanceProjection.reply.id, scopeUserTwo, { published: false });
  await assert.rejects(
    () => lifecycleAnnotations.moderateAnnotation({
      action: "restore",
      adminId: "admin-1",
      annotationId: platformProvenanceProjection.annotation.id,
      reason: "Platform must not restore after author override.",
      traceId: "trace-platform-author-override-restore"
    }),
    (error) => error.code === "ANNOTATION_MODERATION_CONFLICT"
  );
  assert.equal((await lifecycleAnnotations.replies(provenanceParent.id, scopeUserOne)).length, 0);

  const directlyWithdrawnProjection = await lifecycleAnnotations.createReply(provenanceParent.id, scopeUserTwo, {
    body: "Platform withdrawal superseded by direct author withdrawal",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  await lifecycleAnnotations.moderateAnnotation({
    action: "withdraw",
    adminId: "admin-1",
    annotationId: directlyWithdrawnProjection.annotation.id,
    reason: "Platform withdraws before direct author override.",
    traceId: "trace-platform-direct-author-override-withdraw"
  });
  await lifecycleAnnotations.withdraw(directlyWithdrawnProjection.annotation.id, scopeUserTwo);
  assert.equal(
    (await pool.query("SELECT moderated_by FROM annotation_replies WHERE id = $1", [directlyWithdrawnProjection.reply.id])).rows[0].moderated_by,
    `author:${scopeUserTwo.id}`
  );
  await assert.rejects(
    () => lifecycleAnnotations.moderateAnnotation({
      action: "restore",
      adminId: "admin-1",
      annotationId: directlyWithdrawnProjection.annotation.id,
      reason: "Platform must not restore after direct author override.",
      traceId: "trace-platform-direct-author-override-restore"
    }),
    (error) => error.code === "ANNOTATION_MODERATION_CONFLICT"
  );
  assert.equal((await lifecycleAnnotations.replies(provenanceParent.id, scopeUserOne)).some((reply) => reply.id === directlyWithdrawnProjection.reply.id), false);

  const platformOnlyProjection = await lifecycleAnnotations.createReply(provenanceParent.id, scopeUserTwo, {
    body: "Platform governance cannot become organization governance",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  await lifecycleAnnotations.moderateAnnotation({
    action: "withdraw",
    adminId: "admin-1",
    annotationId: platformOnlyProjection.annotation.id,
    reason: "Platform-only withdrawal.",
    traceId: "trace-platform-only-withdraw"
  });
  await assert.rejects(
    () => lifecycleAnnotations.moderateOrganizationAnnotation({
      action: "restore",
      annotationId: platformOnlyProjection.annotation.id,
      reason: "Organization must not restore platform withdrawal.",
      traceId: "trace-org-platform-restore",
      userId: scopeUserThree.id
    }),
    (error) => error.code === "ANNOTATION_MODERATION_CONFLICT"
  );

  const lifecycleParent = await lifecycleAnnotations.createAnnotation(scopeUserOne, {
    body: "PostgreSQL reply lifecycle parent",
    shareToPlaza: true,
    tags: [],
    targets: [wholeDocument],
    visibility: "public"
  });
  const lifecyclePure = await lifecycleAnnotations.createReply(lifecycleParent.id, scopeUserTwo, {
    body: "PostgreSQL pure canonical reply",
    publishAsAnnotation: false,
    tags: [],
    targets: []
  });
  assert.equal(lifecyclePure.annotation, null);
  assert.equal(lifecyclePure.reply.derivedAnnotationId, null);
  assert.equal(lifecyclePure.reply.derivedAnnotationState, "none");
  const lifecyclePublished = await lifecycleAnnotations.updateReplyPublication(lifecyclePure.reply.id, scopeUserTwo, {
    published: true,
    tags: ["lifecycle"],
    targets: [sourcePassage]
  });
  assert.equal(lifecyclePublished.annotation.visibility, "public");
  assert.equal(lifecyclePublished.annotation.shareToPlaza, true);
  assert.equal(lifecyclePublished.reply.derivedAnnotationState, "published");
  const lifecycleDerivedId = lifecyclePublished.annotation.id;

  await lifecycleAnnotations.updateProfile(scopeUserTwo.id, {
    educationStage: "硕士研究生",
    institutions: [{ name: "PostgreSQL Evidence Lab" }]
  });
  const lifecycleEdited = await lifecycleAnnotations.updateReply(lifecyclePure.reply.id, scopeUserTwo, {
    body: "PostgreSQL canonical reply after editing"
  });
  const lifecycleDerivedAfterEdit = await lifecycleAnnotations.annotation(lifecycleDerivedId, scopeUserTwo);
  assert.equal(lifecycleEdited.body, "PostgreSQL canonical reply after editing");
  assert.equal(lifecycleDerivedAfterEdit.body, lifecycleEdited.body);
  assert.equal(lifecycleEdited.revision, 2);
  assert.equal(lifecycleDerivedAfterEdit.revision, lifecycleEdited.revision);
  assert.deepEqual(lifecycleEdited.author.profile, {
    educationStage: "硕士研究生",
    institutions: [{ name: "PostgreSQL Evidence Lab" }]
  });
  assert.deepEqual(lifecycleDerivedAfterEdit.author.profile, lifecycleEdited.author.profile);
  const lifecycleSnapshots = await pool.query(`
    SELECT
      (SELECT body FROM annotation_reply_versions WHERE reply_id = $1 AND revision = 1) AS reply_body,
      (SELECT body FROM annotation_versions WHERE annotation_id = $2 AND revision = 1) AS annotation_body
  `, [lifecyclePure.reply.id, lifecycleDerivedId]);
  assert.deepEqual(lifecycleSnapshots.rows[0], {
    annotation_body: "PostgreSQL pure canonical reply",
    reply_body: "PostgreSQL pure canonical reply"
  });
  await assert.rejects(
    () => lifecycleAnnotations.updateAnnotation(lifecycleDerivedId, scopeUserTwo, { body: "Invalid derived body edit" }),
    (error) => error.code === "DERIVED_BODY_READ_ONLY"
  );
  const lifecycleMetadataEdit = await lifecycleAnnotations.updateAnnotation(lifecycleDerivedId, scopeUserTwo, {
    tags: ["direct metadata revision"]
  });
  assert.equal(lifecycleMetadataEdit.revision, 3);

  const lifecycleWithdrawn = await lifecycleAnnotations.updateReplyPublication(lifecyclePure.reply.id, scopeUserTwo, {
    published: false
  });
  assert.equal(lifecycleWithdrawn.annotation, null);
  assert.equal(lifecycleWithdrawn.reply.derivedAnnotationState, "withdrawn");
  assert.equal((await lifecycleAnnotations.replies(lifecycleParent.id, scopeUserOne))[0].id, lifecyclePure.reply.id);
  await assert.rejects(
    () => lifecycleAnnotations.moderateAnnotation({
      action: "restore",
      adminId: "admin-1",
      annotationId: lifecycleDerivedId,
      reason: "User withdrawal is not platform moderation.",
      traceId: "trace-user-withdrawal-restore"
    }),
    (error) => error.code === "ANNOTATION_MODERATION_CONFLICT"
  );
  const lifecycleRestored = await lifecycleAnnotations.updateReplyPublication(lifecyclePure.reply.id, scopeUserTwo, {
    published: true,
    tags: ["restored"],
    targets: [sourcePassage]
  });
  assert.equal(lifecycleRestored.annotation.id, lifecycleDerivedId);
  assert.equal(lifecycleRestored.annotation.revision, 4);
  assert.equal(lifecycleRestored.reply.derivedAnnotationState, "published");
  await lifecycleAnnotations.withdraw(lifecycleDerivedId, scopeUserTwo);
  assert.equal((await lifecycleAnnotations.replies(lifecycleParent.id, scopeUserOne))[0].derivedAnnotationState, "withdrawn");
  const lifecycleUserRestored = await lifecycleAnnotations.updateReplyPublication(lifecyclePure.reply.id, scopeUserTwo, {
    published: true,
    tags: ["restored"],
    targets: [sourcePassage]
  });
  assert.equal(lifecycleUserRestored.annotation.revision, 5);
  const lifecycleEditedAfterMetadata = await lifecycleAnnotations.updateReply(lifecyclePure.reply.id, scopeUserTwo, {
    body: "PostgreSQL canonical reply remains editable after metadata changes"
  });
  const lifecycleDerivedAfterMetadata = await lifecycleAnnotations.annotation(lifecycleDerivedId, scopeUserTwo);
  assert.equal(lifecycleEditedAfterMetadata.revision, 3);
  assert.equal(lifecycleDerivedAfterMetadata.revision, 6);
  assert.equal(lifecycleDerivedAfterMetadata.body, lifecycleEditedAfterMetadata.body);

  const lifecycleParentBeforeEngagement = await lifecycleAnnotations.annotation(lifecycleParent.id, scopeUserOne);
  const lifecycleSourceBeforeEngagement = await pool.query(
    "SELECT body, revision FROM annotation_replies WHERE id = $1",
    [lifecyclePure.reply.id]
  );
  assert.deepEqual(await lifecycleAnnotations.rateAnnotation(lifecycleDerivedId, scopeUserOne, 5), {
    ratingAverage: 5,
    ratingCount: 1,
    viewerRating: 5
  });
  assert.deepEqual(await lifecycleAnnotations.toggleSave(lifecycleDerivedId, scopeUserOne), { saved: true });
  const projectionEngagementReply = await lifecycleAnnotations.createReply(lifecycleDerivedId, scopeUserOne, {
    body: "PostgreSQL engagement reply",
    publishAsAnnotation: false,
    tags: [],
    targets: []
  });
  assert.equal(projectionEngagementReply.annotation, null);
  const lifecycleSourceAfterEngagement = await pool.query(
    "SELECT body, revision FROM annotation_replies WHERE id = $1",
    [lifecyclePure.reply.id]
  );
  assert.deepEqual(lifecycleSourceAfterEngagement.rows, lifecycleSourceBeforeEngagement.rows);
  const lifecycleParentAfterEngagement = await lifecycleAnnotations.annotation(lifecycleParent.id, scopeUserOne);
  assert.equal(lifecycleParentAfterEngagement.ratingCount, lifecycleParentBeforeEngagement.ratingCount);
  assert.equal(lifecycleParentAfterEngagement.viewerSaved, lifecycleParentBeforeEngagement.viewerSaved);
  assert.equal((await lifecycleAnnotations.replies(lifecycleParent.id, scopeUserOne)).length, 1);
  assert.equal((await lifecycleAnnotations.replies(lifecycleDerivedId, scopeUserOne)).length, 1);

  await lifecycleAnnotations.moderateAnnotation({
    action: "withdraw",
    adminId: "admin-1",
    annotationId: lifecycleDerivedId,
    reason: "Withdraw linked lifecycle reply.",
    traceId: "trace-lifecycle-reply-withdraw"
  });
  assert.equal((await lifecycleAnnotations.replies(lifecycleParent.id, scopeUserOne)).length, 0);
  const lifecycleModeratedReply = await pool.query(`
    SELECT moderated_at IS NOT NULL AS moderated, moderated_by, moderation_reason
      FROM annotation_replies
     WHERE id = $1
  `, [lifecyclePure.reply.id]);
  assert.deepEqual(lifecycleModeratedReply.rows, [{
    moderated: true,
    moderated_by: "platform:admin-1",
    moderation_reason: "Withdraw linked lifecycle reply."
  }]);
  await lifecycleAnnotations.moderateAnnotation({
    action: "restore",
    adminId: "admin-1",
    annotationId: lifecycleDerivedId,
    reason: "Restore linked lifecycle reply.",
    traceId: "trace-lifecycle-reply-restore"
  });
  assert.equal((await lifecycleAnnotations.replies(lifecycleParent.id, scopeUserOne))[0].id, lifecyclePure.reply.id);
  const replyLifecycleAudit = await pool.query(`
    SELECT action, linked_reply_id
      FROM annotation_moderation_audit
     WHERE annotation_id = $1
     ORDER BY created_at, id
  `, [lifecycleDerivedId]);
  assert.deepEqual(replyLifecycleAudit.rows, [
    { action: "withdraw", linked_reply_id: lifecyclePure.reply.id },
    { action: "restore", linked_reply_id: lifecyclePure.reply.id }
  ]);
  assert.deepEqual(await lifecycleAnnotations.deleteReply(lifecyclePure.reply.id, scopeUserTwo), {
    ok: true,
    replyId: lifecyclePure.reply.id
  });
  assert.equal((await lifecycleAnnotations.replies(lifecycleParent.id, scopeUserOne)).length, 0);
  await assert.rejects(
    () => lifecycleAnnotations.annotation(lifecycleDerivedId, scopeUserTwo),
    (error) => error.code === "ANNOTATION_NOT_FOUND"
  );
  await assert.rejects(
    () => lifecycleAnnotations.moderateAnnotation({
      action: "restore",
      adminId: "admin-1",
      annotationId: lifecycleDerivedId,
      reason: "A deleted canonical reply must stay withdrawn.",
      traceId: "trace-deleted-reply-restore"
    }),
    (error) => error.code === "ANNOTATION_MODERATION_CONFLICT"
  );
  await assert.rejects(
    () => lifecycleAnnotations.annotation(lifecycleDerivedId, scopeUserTwo),
    (error) => error.code === "ANNOTATION_NOT_FOUND"
  );

  const parentDeletionRoot = await lifecycleAnnotations.createAnnotation(scopeUserOne, {
    body: "PostgreSQL parent deletion context",
    shareToPlaza: true,
    tags: [],
    targets: [wholeDocument],
    visibility: "public"
  });
  const parentDeletionProjection = await lifecycleAnnotations.createReply(parentDeletionRoot.id, scopeUserTwo, {
    body: "PostgreSQL projection survives parent deletion",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  await lifecycleAnnotations.withdraw(parentDeletionRoot.id, scopeUserOne);
  assert.deepEqual(
    (await lifecycleAnnotations.annotation(parentDeletionProjection.annotation.id, scopeUserOne)).originalReply,
    { replyId: parentDeletionProjection.reply.id, status: "parent_deleted" }
  );
  await lifecycleAnnotations.moderateAnnotation({
    action: "withdraw",
    adminId: "admin-1",
    annotationId: parentDeletionProjection.annotation.id,
    reason: "Withdraw projection after its parent was deleted.",
    traceId: "trace-parent-deleted-projection-withdraw"
  });
  await assert.rejects(
    () => lifecycleAnnotations.annotation(parentDeletionProjection.annotation.id, scopeUserOne),
    (error) => error.code === "ANNOTATION_NOT_FOUND"
  );
  await lifecycleAnnotations.moderateAnnotation({
    action: "restore",
    adminId: "admin-1",
    annotationId: parentDeletionProjection.annotation.id,
    reason: "Restore projection after its parent was deleted.",
    traceId: "trace-parent-deleted-projection-restore"
  });
  assert.deepEqual(
    (await lifecycleAnnotations.annotation(parentDeletionProjection.annotation.id, scopeUserOne)).originalReply,
    { replyId: parentDeletionProjection.reply.id, status: "parent_deleted" }
  );

  const rollbackParent = await lifecycleAnnotations.createAnnotation(scopeUserOne, {
    body: "PostgreSQL rollback parent",
    shareToPlaza: true,
    tags: [],
    targets: [wholeDocument],
    visibility: "public"
  });
  const rollbackProjection = await lifecycleAnnotations.createReply(rollbackParent.id, scopeUserTwo, {
    body: "PostgreSQL rollback source",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  await migrationPool.query(`
    INSERT INTO annotation_versions(
      id, annotation_id, revision, body, author_profile_snapshot, visibility,
      organization_id, share_to_plaza, targets, tags, changed_by
    ) VALUES ($1, $2, 1, $3, $4::jsonb, 'public', NULL, true, $5::jsonb, '[]'::jsonb, $6)
  `, [
    `forced-rollback-version-${randomUUID()}`,
    rollbackProjection.annotation.id,
    rollbackProjection.annotation.body,
    JSON.stringify(rollbackProjection.annotation.author.profile),
    JSON.stringify(rollbackProjection.annotation.targets),
    scopeUserTwo.id
  ]);
  await assert.rejects(
    () => lifecycleAnnotations.updateReply(rollbackProjection.reply.id, scopeUserTwo, {
      body: "PostgreSQL update must roll back"
    }),
    /annotation_versions_annotation_id_revision_key/
  );
  const rollbackState = await pool.query(`
    SELECT
      (SELECT body FROM annotation_replies WHERE id = $1) AS reply_body,
      (SELECT revision::int FROM annotation_replies WHERE id = $1) AS reply_revision,
      (SELECT body FROM annotations WHERE id = $2) AS annotation_body,
      (SELECT revision::int FROM annotations WHERE id = $2) AS annotation_revision,
      (SELECT count(*)::int FROM annotation_reply_versions WHERE reply_id = $1) AS reply_versions
  `, [rollbackProjection.reply.id, rollbackProjection.annotation.id]);
  assert.deepEqual(rollbackState.rows[0], {
    annotation_body: "PostgreSQL rollback source",
    annotation_revision: 1,
    reply_body: "PostgreSQL rollback source",
    reply_revision: 1,
    reply_versions: 0
  });
  const plaza = await annotations.plaza(userOne, {
    documentType: "journal_article",
    educationStage: "博士研究生",
    institution: "证据研究院",
    literatureIdentityKind: "doi",
    literatureIdentityValue: "10.1000/integration-confirmed",
    query: "/PostgreSQL",
    sort: "recommended"
  });
  assert.equal(plaza.some((item) => item.id === publicAnnotation.id), true);

  assert.deepEqual(await annotations.toggleSave(publicAnnotation.id, userOne), { saved: true });
  assert.deepEqual(await annotations.rateAnnotation(semanticSeed.id, userOne, 5), {
    ratingAverage: 5,
    ratingCount: 1,
    viewerRating: 5
  });
  const handoff = await annotations.createHandoff(userOne.id, {
    body: "待发布批注",
    shareToPlaza: true,
    tags: [],
    targets: [wholeDocument],
    visibility: "public"
  });
  assert.match(handoff.handoffId, /^handoff_/);
  const synced = await annotations.syncDesktopAnnotations(userOne, [{
    annotationId: "desktop-annotation-1",
    body: "来自桌面端同步的公开批注。",
    createdAt: "2026-08-07T01:00:00.000Z",
    queueKey: "desktop-queue-1",
    targets: [sourcePassage],
    updatedAt: "2026-08-07T01:05:00.000Z"
  }]);
  assert.equal(synced[0].status, "synced");

  const publicationOperation = {
    annotationId: "desktop-publication-1",
    body: "来自桌面端、只引用已确认文献的公开批注。",
    literatureId: confirmedLiterature.literatureId,
    operation: "upsert",
    queueKey: "desktop-publication-queue-1",
    revision: 1,
    sourcePassage: {
      anchorHash: "sha256:postgres-publication-source",
      excerpt: "The desktop publication retains this source passage.",
      page: 5,
      rects: []
    },
    updatedAt: "2026-08-09T01:00:00.0000Z"
  };
  const [publicationCreated] = await annotations.applyDesktopAnnotationPublications(userOne, [publicationOperation]);
  assert.equal(publicationCreated.state, "published");
  assert.equal(publicationCreated.remoteRevision, 1);
  const [publicationReplayed] = await annotations.applyDesktopAnnotationPublications(userOne, [{
    ...publicationOperation,
    updatedAt: "2026-08-09T01:00:00.000Z"
  }]);
  assert.deepEqual(publicationReplayed, publicationCreated);
  const [publicationVersionConflict] = await annotations.applyDesktopAnnotationPublications(userOne, [{
    ...publicationOperation,
    body: "同一来源版本不能静默接受不同正文。",
    updatedAt: "2026-08-09T01:00:00.000Z"
  }]);
  assert.equal(publicationVersionConflict.error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  const [publicationOperationConflict] = await annotations.applyDesktopAnnotationPublications(userOne, [{
    annotationId: publicationOperation.annotationId,
    operation: "retract",
    queueKey: publicationOperation.queueKey,
    remoteAnnotationId: publicationCreated.remoteAnnotationId,
    revision: publicationOperation.revision,
    updatedAt: "2026-08-09T01:00:00.000Z"
  }]);
  assert.equal(publicationOperationConflict.error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  const intraBatchPublication = {
    ...publicationOperation,
    annotationId: "desktop-publication-intra-batch",
    queueKey: "desktop-publication-intra-batch",
    updatedAt: "2026-08-09T01:30:00.000Z"
  };
  const intraBatchResults = await annotations.applyDesktopAnnotationPublications(userTwo, [
    intraBatchPublication,
    { ...intraBatchPublication, body: "同批次内的冲突正文。" }
  ]);
  assert.equal(intraBatchResults[0].state, "published");
  assert.equal(intraBatchResults[1].error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  const publicationDigest = await pool.query("SELECT operation_digest FROM desktop_annotation_publications WHERE owner_id = $1 AND queue_key = $2", [userOne.id, publicationOperation.queueKey]);
  assert.match(publicationDigest.rows[0].operation_digest, /^[a-f0-9]{64}$/);
  const [publicationUpdated] = await annotations.applyDesktopAnnotationPublications(userOne, [{
    ...publicationOperation,
    body: "桌面批注的第二个来源修订。",
    revision: 2,
    updatedAt: "2026-08-09T02:00:00.000Z"
  }]);
  assert.equal(publicationUpdated.remoteAnnotationId, publicationCreated.remoteAnnotationId);
  assert.equal(publicationUpdated.remoteRevision, publicationCreated.remoteRevision + 1);
  const [publicationStale] = await annotations.applyDesktopAnnotationPublications(userOne, [{
    ...publicationOperation,
    body: "过期来源修订不能覆盖远端批注。",
    updatedAt: "2026-08-09T03:00:00.000Z"
  }]);
  assert.equal(publicationStale.error, "STALE_ANNOTATION_PUBLICATION");
  const [publicationStaleTimestamp] = await annotations.applyDesktopAnnotationPublications(userOne, [{
    ...publicationOperation,
    body: "时间倒退的来源修订不能覆盖远端批注。",
    revision: 3,
    updatedAt: "2026-08-09T01:30:00.000Z"
  }]);
  assert.equal(publicationStaleTimestamp.error, "STALE_ANNOTATION_PUBLICATION");
  const retractOperation = {
    annotationId: publicationOperation.annotationId,
    operation: "retract",
    queueKey: publicationOperation.queueKey,
    remoteAnnotationId: publicationCreated.remoteAnnotationId,
    revision: 4,
    updatedAt: "2026-08-09T04:00:00.000Z"
  };
  const [publicationRetracted] = await annotations.applyDesktopAnnotationPublications(userOne, [retractOperation]);
  assert.equal(publicationRetracted.state, "retracted");
  assert.deepEqual((await annotations.applyDesktopAnnotationPublications(userOne, [retractOperation]))[0], publicationRetracted);
  const [otherOwnerPublication] = await annotations.applyDesktopAnnotationPublications(userTwo, [publicationOperation]);
  assert.notEqual(otherOwnerPublication.remoteAnnotationId, publicationCreated.remoteAnnotationId);
  const publicationRow = await pool.query("SELECT visibility, share_to_plaza FROM annotations WHERE id = $1", [publicationCreated.remoteAnnotationId]);
  assert.deepEqual(publicationRow.rows[0], { share_to_plaza: false, visibility: "private" });
  const publicationTarget = await pool.query("SELECT literature_id, target FROM annotation_targets WHERE annotation_id = $1", [publicationCreated.remoteAnnotationId]);
  assert.equal(publicationTarget.rows[0].literature_id, confirmedLiterature.literatureId);
  assert.deepEqual(publicationTarget.rows[0].target.literature, { literatureId: confirmedLiterature.literatureId });
  assert.equal((await pool.query("SELECT title FROM literature_records WHERE id = $1", [confirmedLiterature.literatureId])).rows[0].title, "Integration Confirmed Literature");
  const [publishedDeletionPublication] = await annotations.applyDesktopAnnotationPublications(userOne, [{
    ...publicationOperation,
    annotationId: "desktop-publication-account-deletion",
    queueKey: "desktop-publication-account-deletion",
    updatedAt: "2026-08-09T05:00:00.000Z"
  }]);
  assert.equal(publishedDeletionPublication.state, "published");
  const concurrentPublicationA = {
    ...publicationOperation,
    annotationId: "desktop-publication-concurrent-a",
    queueKey: "desktop-publication-concurrent-a",
    updatedAt: "2026-08-09T06:00:00.000Z"
  };
  const concurrentPublicationB = {
    ...publicationOperation,
    annotationId: "desktop-publication-concurrent-b",
    queueKey: "desktop-publication-concurrent-b",
    updatedAt: "2026-08-09T06:00:00.000Z"
  };
  const [forwardPublicationBatch, reversePublicationBatch] = await Promise.all([
    annotations.applyDesktopAnnotationPublications(userTwo, [concurrentPublicationA, concurrentPublicationB]),
    annotations.applyDesktopAnnotationPublications(userTwo, [concurrentPublicationB, concurrentPublicationA])
  ]);
  const forwardPublicationIds = Object.fromEntries(forwardPublicationBatch.map((result) => [result.queueKey, result.remoteAnnotationId]));
  const reversePublicationIds = Object.fromEntries(reversePublicationBatch.map((result) => [result.queueKey, result.remoteAnnotationId]));
  assert.deepEqual(reversePublicationIds, forwardPublicationIds);

  const mixedPublicationOwner = { id: "mixed-publication-owner", initials: "MP", name: "Mixed Publication Owner" };
  const mixedPublicationResults = await annotations.applyDesktopAnnotationPublications(mixedPublicationOwner, [
    {
      ...publicationOperation,
      annotationId: "mixed-publication-a",
      queueKey: "mixed-publication-a",
      updatedAt: "2026-08-09T06:10:00.000Z"
    },
    {
      ...publicationOperation,
      annotationId: "mixed-publication-missing",
      literatureId: "missing-mixed-publication-literature",
      queueKey: "mixed-publication-missing",
      updatedAt: "2026-08-09T06:10:00.000Z"
    },
    {
      ...publicationOperation,
      annotationId: "mixed-publication-b",
      queueKey: "mixed-publication-b",
      updatedAt: "2026-08-09T06:10:00.000Z"
    }
  ]);
  assert.deepEqual(mixedPublicationResults.map((result) => result.state ?? result.error), [
    "published",
    "LITERATURE_NOT_FOUND",
    "published"
  ]);
  assert.equal((await pool.query(
    "SELECT count(*)::int AS count FROM desktop_annotation_publications WHERE owner_id = $1",
    [mixedPublicationOwner.id]
  )).rows[0].count, 2);

  const rollbackPublicationOwner = { id: "rollback-publication-owner", initials: "RP", name: "Rollback Publication Owner" };
  const rollbackBaseline = (await pool.query(`
    SELECT
      (SELECT count(*)::int FROM annotations) AS annotations,
      (SELECT count(*)::int FROM annotation_targets) AS targets,
      (SELECT count(*)::int FROM desktop_annotation_publications) AS publications
  `)).rows[0];
  await migrationPool.query(`
    CREATE OR REPLACE FUNCTION inject_late_desktop_publication_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'injected_late_desktop_publication_failure';
    END;
    $$;
    DROP TRIGGER IF EXISTS inject_late_desktop_publication_failure ON desktop_annotation_publications;
    CREATE TRIGGER inject_late_desktop_publication_failure
    BEFORE INSERT ON desktop_annotation_publications
    FOR EACH ROW
    WHEN (NEW.queue_key = 'rollback-publication-b')
    EXECUTE FUNCTION inject_late_desktop_publication_failure();
  `);
  try {
    await assert.rejects(
      () => annotations.applyDesktopAnnotationPublications(rollbackPublicationOwner, [
        {
          ...publicationOperation,
          annotationId: "rollback-publication-a",
          queueKey: "rollback-publication-a",
          updatedAt: "2026-08-09T06:20:00.000Z"
        },
        {
          ...publicationOperation,
          annotationId: "rollback-publication-b",
          queueKey: "rollback-publication-b",
          updatedAt: "2026-08-09T06:20:00.000Z"
        }
      ]),
      /injected_late_desktop_publication_failure/
    );
  } finally {
    await migrationPool.query(`
      DROP TRIGGER IF EXISTS inject_late_desktop_publication_failure ON desktop_annotation_publications;
      DROP FUNCTION IF EXISTS inject_late_desktop_publication_failure();
    `);
  }
  const rollbackAfter = (await pool.query(`
    SELECT
      (SELECT count(*)::int FROM annotations) AS annotations,
      (SELECT count(*)::int FROM annotation_targets) AS targets,
      (SELECT count(*)::int FROM desktop_annotation_publications) AS publications
  `)).rows[0];
  assert.deepEqual(rollbackAfter, rollbackBaseline);

  const raceOwner = { id: "publication-deletion-race-user", initials: "RD", name: "Race Deletion User" };
  const raceOperation = {
    ...publicationOperation,
    annotationId: "desktop-publication-deletion-race",
    queueKey: "desktop-publication-deletion-race",
    updatedAt: "2026-08-09T07:00:00.000Z"
  };
  const raceDeletionInput = {
    idempotencyKey: "delete-publication-race-user:intuecho",
    reason: "Barrier controlled publication account deletion race",
    requestedBy: "admin-1",
    subjectId: raceOwner.id,
    traceId: "trace-publication-delete-race"
  };
  const raceLifecycleKey = `intuecho-account-deletion:${raceOwner.id}`;
  const barrier = await pool.connect();
  let barrierLocked = false;
  let racingPublication;
  let racingDeletion;
  let raceSetupError;
  try {
    await barrier.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [raceLifecycleKey]);
    barrierLocked = true;
    racingPublication = annotations.applyDesktopAnnotationPublications(raceOwner, [raceOperation]);
    await waitForAdvisoryWait(1);
    racingDeletion = new PostgresAccountLifecycleRepository(pool).deleteAccount(raceDeletionInput);
    await waitForAdvisoryWait(2);
    await barrier.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [raceLifecycleKey]);
    barrierLocked = false;
  } catch (error) {
    raceSetupError = error;
  } finally {
    if (barrierLocked) await barrier.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [raceLifecycleKey]);
    barrier.release();
  }
  if (raceSetupError) {
    await Promise.allSettled([racingPublication, racingDeletion].filter(Boolean));
    throw raceSetupError;
  }
  const [[racePublicationResult], raceDeletionResult] = await Promise.all([racingPublication, racingDeletion]);
  assert.equal(raceDeletionResult.replayed, false);
  if (racePublicationResult.state === "published") {
    assert.equal(raceDeletionResult.result.deletedAnnotationPublications, 1);
  } else {
    assert.equal(racePublicationResult.error, "ANNOTATION_PUBLICATION_OWNER_DELETED");
    assert.equal(raceDeletionResult.result.deletedAnnotationPublications, 0);
  }
  const raceResidue = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM desktop_annotation_publications WHERE owner_id = $1) AS publications,
      (SELECT count(*)::int FROM annotations WHERE author_id = $1) AS annotations
  `, [raceOwner.id]);
  assert.deepEqual(raceResidue.rows[0], { annotations: 0, publications: 0 });

  const legacyRaceOwner = { id: "legacy-sync-deletion-race-user", initials: "LR", name: "Legacy Race User" };
  const legacyRaceItem = {
    annotationId: "legacy-sync-deletion-race",
    body: "Compatibility sync must serialize with account deletion.",
    createdAt: "2026-08-09T07:10:00.000Z",
    queueKey: "legacy-sync-deletion-race",
    targets: [{ kind: "whole_document", literature: { literatureId: confirmedLiterature.literatureId } }],
    updatedAt: "2026-08-09T07:10:00.000Z"
  };
  const legacyRaceDeletionInput = {
    idempotencyKey: "delete-legacy-sync-race-user:intuecho",
    reason: "Barrier controlled legacy sync account deletion race",
    requestedBy: "admin-1",
    subjectId: legacyRaceOwner.id,
    traceId: "trace-legacy-sync-delete-race"
  };
  const legacyRaceLifecycleKey = `intuecho-account-deletion:${legacyRaceOwner.id}`;
  const legacyBarrier = await pool.connect();
  let legacyBarrierLocked = false;
  let racingLegacySync;
  let racingLegacyDeletion;
  let legacyRaceSetupError;
  try {
    await legacyBarrier.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [legacyRaceLifecycleKey]);
    legacyBarrierLocked = true;
    racingLegacySync = annotations.syncDesktopAnnotations(legacyRaceOwner, [legacyRaceItem]);
    await waitForAdvisoryWait(1);
    racingLegacyDeletion = new PostgresAccountLifecycleRepository(pool).deleteAccount(legacyRaceDeletionInput);
    await waitForAdvisoryWait(2);
    await legacyBarrier.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [legacyRaceLifecycleKey]);
    legacyBarrierLocked = false;
  } catch (error) {
    legacyRaceSetupError = error;
  } finally {
    if (legacyBarrierLocked) {
      await legacyBarrier.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [legacyRaceLifecycleKey]);
    }
    legacyBarrier.release();
  }
  if (legacyRaceSetupError) {
    await Promise.allSettled([racingLegacySync, racingLegacyDeletion].filter(Boolean));
    throw legacyRaceSetupError;
  }
  const [[legacyRaceSyncResult], legacyRaceDeletionResult] = await Promise.all([racingLegacySync, racingLegacyDeletion]);
  assert.equal(legacyRaceDeletionResult.replayed, false);
  if (legacyRaceSyncResult.status === "synced") {
    assert.equal(legacyRaceDeletionResult.result.deletedAnnotationSyncs, 1);
  } else {
    assert.equal(legacyRaceSyncResult.error, "ANNOTATION_PUBLICATION_OWNER_DELETED");
    assert.equal(legacyRaceDeletionResult.result.deletedAnnotationSyncs, 0);
  }
  const legacyRaceResidue = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM desktop_annotation_syncs WHERE owner_id = $1) AS syncs,
      (SELECT count(*)::int FROM annotations WHERE author_id = $1) AS annotations
  `, [legacyRaceOwner.id]);
  assert.deepEqual(legacyRaceResidue.rows[0], { annotations: 0, syncs: 0 });

  const privateRoot = await annotations.createAnnotation(userOne, {
    body: "账号删除时必须移除的私有批注。",
    shareToPlaza: false,
    tags: [],
    targets: [wholeDocument],
    visibility: "private"
  });
  await annotations.updateAnnotation(privateRoot.id, userOne, {
    body: "账号删除时必须移除的已编辑私有批注。"
  });
  await assert.rejects(
    () => pool.query(`
      INSERT INTO annotations(
        id, parent_annotation_id, body, author_id, author_name, author_initials,
        author_profile_snapshot, visibility, share_to_plaza
      ) VALUES (
        'invalid-public-private-reply', $1, 'Invalid visibility', 'user-2',
        'Invalid Author', 'IA', '{}'::jsonb, 'public', false
      )
    `, [privateRoot.id]),
    /reply_visibility_mismatch/
  );
  const privateReply = await annotations.createReply(privateRoot.id, userOne, {
    body: "账号删除必须从子节点开始移除的私有回复。",
    publishAsAnnotation: false,
    tags: [],
    targets: []
  });
  await annotations.updateReply(privateReply.reply.id, userOne, {
    body: "账号删除必须同时移除私有回复的历史版本。"
  });
  await assert.rejects(
    () => migrationPool.query("UPDATE annotation_versions SET body = 'tampered' WHERE annotation_id = $1", [publicAnnotation.id]),
    /annotation_versions_are_append_only/
  );
  await assert.rejects(
    () => migrationPool.query("DELETE FROM annotation_reply_versions WHERE reply_id = $1", [authoredPublicReply.reply.id]),
    /annotation_reply_versions_are_append_only/
  );
  const organizationAnnotation = await annotations.createAnnotation(userOne, {
    body: "只对指定组织可见的批注。",
    organizationId: "org-integration",
    shareToPlaza: false,
    tags: [],
    targets: [wholeDocument],
    visibility: "organization"
  });
  assert.deepEqual(organizationAuthorizations, [{
    organizationId: "org-integration",
    userId: "user-1"
  }]);
  await annotations.moderateOrganizationAnnotation({ action: "withdraw", annotationId: organizationAnnotation.id, reason: "组织管理员执行 PostgreSQL 治理集成验证。", traceId: "trace-org-moderate-1", userId: userTwo.id });
  const organizationFeed = await annotations.organizationFeed(userTwo);
  assert.equal(organizationFeed[0].annotations[0].id, organizationAnnotation.id);
  assert.equal(organizationFeed[0].annotations[0].viewerCanModerate, true);
  assert.equal(organizationFeed[0].annotations[0].withdrawnAt !== null, true);
  await annotations.moderateOrganizationAnnotation({ action: "restore", annotationId: organizationAnnotation.id, reason: "组织管理员恢复 PostgreSQL 治理集成验证内容。", traceId: "trace-org-moderate-2", userId: userTwo.id });
  assert.equal(organizationModerations.length, 2);

  assert.deepEqual(await annotations.toggleFollow(userOne.id, userTwo.id), {
    following: true,
    mutual: false
  });
  assert.deepEqual(await annotations.toggleFollow(userTwo.id, userOne.id), {
    following: true,
    mutual: true
  });
  const conversation = await annotations.createConversation(userOne.id, userTwo.id);
  const invitationMessage = await annotations.sendMessage(conversation.id, userOne.id, {
    body: "加入证据研究组织",
    invitation: { organizationId: "org-integration", role: "member" },
    kind: "organization_invitation"
  });
  assert.equal(invitationMessage.invitation.invitationId, "orginvite-integration");
  assert.equal(organizationInvitations.length, 1);

  const appeal = await annotations.appealPlatformTag(
    publicAnnotation.id,
    "证据分类",
    userOne.id,
    "平台标签未准确描述这条批注的主要语义。"
  );
  assert.equal((await annotations.listTagAppeals("pending"))[0].appealId, appeal.appealId);
  const resolvedAppeal = await annotations.resolveTagAppeal(appeal.appealId, "admin-1", {
    decision: "accepted",
    reason: "复核文献证据后确认平台语义标签分类错误。"
  }, "trace-tag-appeal-1");
  assert.equal(resolvedAppeal.decision, "accepted");
  assert.equal((await annotations.listTagAppeals("accepted"))[0].appealId, appeal.appealId);

  await annotations.moderateAnnotation({
    action: "withdraw",
    adminId: "admin-1",
    annotationId: publicAnnotation.id,
    reason: "正式 PostgreSQL 集成测试治理动作",
    traceId: "trace-annotation-moderation-1"
  });
  await annotations.moderateAnnotation({
    action: "restore",
    adminId: "admin-1",
    annotationId: publicAnnotation.id,
    reason: "正式 PostgreSQL 集成测试恢复动作",
    traceId: "trace-annotation-moderation-2"
  });
  assert.equal((await annotations.listAdminAnnotations()).some((item) =>
    item.id === publicAnnotation.id && item.withdrawnAt === null
  ), true);
  await assert.rejects(
    () => migrationPool.query("UPDATE annotation_moderation_audit SET reason = 'tampered'"),
    /annotation_moderation_audit_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query("DELETE FROM annotation_tag_appeal_audit"),
    /annotation_tag_appeal_audit_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query(`
      INSERT INTO annotation_moderation_audit(
        id, annotation_id, action, reason, admin_user_id, trace_id
      ) VALUES (
        'invalid-missing-annotation-audit', 'missing-annotation', 'withdraw',
        'Missing annotation reference must fail.', 'admin-1', 'trace-invalid-audit'
      )
    `),
    /annotation_moderation_audit_annotation_not_found/
  );

  const deletionNestedRootUser = { id: "deletion-nested-root-user", initials: "DNR", name: "Deletion Nested Root User" };
  const deletionNestedReplyUser = { id: "deletion-nested-reply-user", initials: "DNP", name: "Deletion Nested Reply User" };
  const deletionNestedChildUser = { id: "deletion-nested-child-user", initials: "DNC", name: "Deletion Nested Child User" };
  await lifecycleAnnotations.toggleFollow(deletionNestedRootUser.id, deletionNestedReplyUser.id);
  await lifecycleAnnotations.toggleFollow(deletionNestedReplyUser.id, deletionNestedRootUser.id);
  await lifecycleAnnotations.toggleFollow(deletionNestedRootUser.id, deletionNestedChildUser.id);
  await lifecycleAnnotations.toggleFollow(deletionNestedChildUser.id, deletionNestedRootUser.id);
  const deletionNestedRoot = await lifecycleAnnotations.createAnnotation(deletionNestedRootUser, {
    body: "Cross-author nested deletion root",
    shareToPlaza: false,
    tags: [],
    targets: [wholeDocument],
    visibility: "mutual_followers"
  });
  const deletionNestedProjection = await lifecycleAnnotations.createReply(deletionNestedRoot.id, deletionNestedReplyUser, {
    body: "Reply author deletion must remove its projection tree",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  const deletionNestedChild = await lifecycleAnnotations.createReply(deletionNestedProjection.annotation.id, deletionNestedChildUser, {
    body: "Nested projection must not become an orphan",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  const nestedReplyDeletion = await new PostgresAccountLifecycleRepository(pool).deleteAccount({
    idempotencyKey: "delete-nested-reply-user-integration",
    reason: "Delete reply author and retire the complete projection tree.",
    requestedBy: "admin-1",
    subjectId: deletionNestedReplyUser.id,
    traceId: "trace-delete-nested-reply-user"
  });
  assert.equal(nestedReplyDeletion.result.deletedNonPublicAnnotations, 2);
  assert.equal(nestedReplyDeletion.result.deletedNonPublicReplies, 2);
  const nestedReplyDeletionState = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM annotations WHERE id = ANY($1::text[])) AS annotation_count,
      (SELECT count(*)::int FROM annotation_replies WHERE id = ANY($2::text[])) AS reply_count,
      (SELECT count(*)::int FROM annotations WHERE source_reply_id = ANY($2::text[])) AS orphan_count
  `, [
    [deletionNestedProjection.annotation.id, deletionNestedChild.annotation.id],
    [deletionNestedProjection.reply.id, deletionNestedChild.reply.id]
  ]);
  assert.deepEqual(nestedReplyDeletionState.rows[0], { annotation_count: 0, orphan_count: 0, reply_count: 0 });

  const deletionRootUser = { id: "deletion-root-user", initials: "DR", name: "Deletion Root User" };
  const deletionReplyUser = { id: "deletion-reply-user", initials: "DP", name: "Deletion Reply User" };
  await lifecycleAnnotations.toggleFollow(deletionRootUser.id, deletionReplyUser.id);
  await lifecycleAnnotations.toggleFollow(deletionReplyUser.id, deletionRootUser.id);
  const deletionRoot = await lifecycleAnnotations.createAnnotation(deletionRootUser, {
    body: "Dedicated account-deletion root audience",
    shareToPlaza: false,
    tags: [],
    targets: [wholeDocument],
    visibility: "mutual_followers"
  });
  const deletionProjection = await lifecycleAnnotations.createReply(deletionRoot.id, deletionReplyUser, {
    body: "Cross-author projection must not become an orphan",
    publishAsAnnotation: true,
    tags: [],
    targets: [sourcePassage]
  });
  const dedicatedDeletion = await new PostgresAccountLifecycleRepository(pool).deleteAccount({
    idempotencyKey: "delete-projection-root-integration",
    reason: "Delete dedicated root and retire cross-author projections.",
    requestedBy: "admin-1",
    subjectId: deletionRootUser.id,
    traceId: "trace-delete-projection-root"
  });
  assert.equal(dedicatedDeletion.result.deletedNonPublicAnnotations, 2);
  const retiredProjectionState = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM annotations WHERE id = $1) AS root_count,
      (SELECT count(*)::int FROM annotations WHERE id = $2) AS projection_count,
      (SELECT count(*)::int FROM annotation_replies WHERE id = $3) AS reply_count
  `, [deletionRoot.id, deletionProjection.annotation.id, deletionProjection.reply.id]);
  assert.deepEqual(retiredProjectionState.rows[0], { projection_count: 0, reply_count: 0, root_count: 0 });
  await assert.rejects(
    () => lifecycleAnnotations.updateAnnotation(deletionProjection.annotation.id, deletionReplyUser, {
      organizationId: null,
      shareToPlaza: true,
      visibility: "public"
    }),
    (error) => error.code === "ANNOTATION_NOT_FOUND"
  );

  const privateDraft = await repository.createContextualDraft("user-1", {
    anchorHash: "anchor-hash-private",
    citationEnabled: true,
    excerpt: "Private draft evidence removed during account deletion.",
    language: "zh-CN",
    page: 4,
    topicId: topic.id,
    workId: "work-1"
  });
  assert.match(privateDraft.draftId, /^draft_/);
  await repository.createFeedback({
    context: "account lifecycle integration",
    kind: "experience",
    message: "This private attribution must be detached during account deletion."
  }, "user-1");
  const publicBeforeDeletion = await pool.query(`
    SELECT post.body AS post_body, comment.body AS comment_body
      FROM posts post
      JOIN comments comment ON comment.post_id = post.id
     WHERE post.id = $1 AND comment.id = $2
  `, [published.postId, comment.id]);
  const accountLifecycle = new PostgresAccountLifecycleRepository(pool);
  const accountDeletionInput = {
    idempotencyKey: "delete-user-1-integration",
    reason: "Approved forum account deletion integration",
    requestedBy: "admin-1",
    subjectId: "user-1",
    traceId: "trace-account-delete-1"
  };
  const accountDeletion = await accountLifecycle.deleteAccount(accountDeletionInput);
  assert.equal(accountDeletion.replayed, false);
  assert.deepEqual(accountDeletion.result, {
    anonymizedAnnotations: 3,
    anonymizedAnnotationVersions: 1,
    anonymizedComments: 1,
    anonymizedPosts: 1,
    anonymizedReplies: 1,
    anonymizedReplyVersions: 1,
    deletedAnnotationHandoffs: 1,
    deletedAnnotationPublications: 2,
    deletedAnnotationRatings: 1,
    deletedAnnotationSaves: 1,
    deletedAnnotationSignals: 0,
    deletedAnnotationSyncs: 1,
    deletedCommunityAnnotations: 0,
    deletedCommentSaves: 1,
    deletedDesktopDraftHandoffs: 0,
    deletedDrafts: 2,
    deletedDirectConversations: 1,
    deletedNonPublicAnnotations: 3,
    deletedNonPublicReplies: 1,
    deletedPostSaves: 1,
    deletedProfile: 1,
    deletedSignals: 1,
    deletedTagAppeals: 1,
    deletedTopicFollows: 1,
    deletedTopicSaves: 1,
    deletedUserFollows: 2,
    detachedFeedback: 1
  });
  const privateAfterDeletion = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM drafts WHERE owner_id = 'user-1') AS drafts,
      (SELECT count(*)::int FROM topic_follows WHERE user_id = 'user-1') AS follows,
      (SELECT count(*)::int FROM topic_saves WHERE user_id = 'user-1') AS topic_saves,
      (SELECT count(*)::int FROM post_saves WHERE user_id = 'user-1') AS post_saves,
      (SELECT count(*)::int FROM comment_saves WHERE user_id = 'user-1') AS comment_saves,
      (SELECT count(*)::int FROM post_signals WHERE user_id = 'user-1') AS signals,
      (SELECT count(*)::int FROM feedback WHERE submitted_by = 'user-1') AS attributed_feedback,
      (SELECT count(*)::int FROM desktop_annotation_handoffs WHERE owner_id = 'user-1') AS annotation_handoffs,
      (SELECT count(*)::int FROM desktop_annotation_syncs WHERE owner_id = 'user-1') AS annotation_syncs,
      (SELECT count(*)::int FROM desktop_annotation_publications WHERE owner_id = 'user-1') AS annotation_publications,
      (SELECT count(*)::int FROM annotation_saves WHERE user_id = 'user-1') AS annotation_saves,
      (SELECT count(*)::int FROM annotation_signals WHERE user_id = 'user-1') AS annotation_signals,
      (SELECT count(*)::int FROM annotation_ratings WHERE user_id = 'user-1') AS annotation_ratings,
      (SELECT count(*)::int FROM annotation_tag_appeals WHERE submitted_by = 'user-1') AS tag_appeals,
      (SELECT count(*)::int FROM user_follows WHERE follower_id = 'user-1' OR followed_id = 'user-1') AS user_follows,
      (SELECT count(*)::int FROM direct_conversations WHERE first_user_id = 'user-1' OR second_user_id = 'user-1') AS conversations,
      (SELECT count(*)::int FROM community_user_profiles WHERE user_id = 'user-1') AS profiles,
      (SELECT count(*)::int FROM annotations WHERE author_id = 'user-1') AS attributed_annotations
  `);
  assert.deepEqual(privateAfterDeletion.rows[0], {
    annotation_handoffs: 0,
    annotation_publications: 0,
    annotation_ratings: 0,
    annotation_saves: 0,
    annotation_signals: 0,
    annotation_syncs: 0,
    attributed_feedback: 0,
    attributed_annotations: 0,
    comment_saves: 0,
    conversations: 0,
    drafts: 0,
    follows: 0,
    post_saves: 0,
    profiles: 0,
    signals: 0,
    tag_appeals: 0,
    topic_saves: 0,
    user_follows: 0
  });
  const annotationHistoryAfterDeletion = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM annotation_versions WHERE annotation_id = $1) AS private_annotation_versions,
      (SELECT count(*)::int FROM annotation_reply_versions WHERE reply_id = $2) AS private_reply_versions,
      (SELECT count(*)::int FROM annotation_versions WHERE changed_by = 'user-1') AS attributed_annotation_versions,
      (SELECT count(*)::int FROM annotation_reply_versions WHERE changed_by = 'user-1') AS attributed_reply_versions,
      (SELECT count(*)::int FROM annotation_versions WHERE annotation_id = $3 AND changed_by LIKE 'deleted:%' AND author_profile_snapshot = '{"educationStage":null,"institutions":[]}'::jsonb) AS anonymized_annotation_versions,
      (SELECT count(*)::int FROM annotation_reply_versions WHERE reply_id = $4 AND changed_by LIKE 'deleted:%' AND author_profile_snapshot = '{"educationStage":null,"institutions":[]}'::jsonb) AS anonymized_reply_versions
  `, [privateRoot.id, privateReply.reply.id, publicAnnotation.id, authoredPublicReply.reply.id]);
  assert.deepEqual(annotationHistoryAfterDeletion.rows[0], {
    anonymized_annotation_versions: 1,
    anonymized_reply_versions: 1,
    attributed_annotation_versions: 0,
    attributed_reply_versions: 0,
    private_annotation_versions: 0,
    private_reply_versions: 0
  });
  const publicAfterDeletion = await pool.query(`
    SELECT
      post.author_id AS post_author_id,
      post.author_name AS post_author_name,
      post.body AS post_body,
      post.helpful,
      post.misleading,
      comment.author_id AS comment_author_id,
      comment.author_name AS comment_author_name,
      comment.body AS comment_body,
      topic.follower_count
    FROM posts post
    JOIN comments comment ON comment.post_id = post.id
    JOIN topics topic ON topic.id = post.topic_id
    WHERE post.id = $1 AND comment.id = $2
  `, [published.postId, comment.id]);
  assert.equal(publicAfterDeletion.rows[0].post_body, publicBeforeDeletion.rows[0].post_body);
  assert.equal(publicAfterDeletion.rows[0].comment_body, publicBeforeDeletion.rows[0].comment_body);
  assert.equal(publicAfterDeletion.rows[0].post_author_name, "已注销用户");
  assert.equal(publicAfterDeletion.rows[0].comment_author_name, "已注销用户");
  assert.equal(publicAfterDeletion.rows[0].post_author_id, publicAfterDeletion.rows[0].comment_author_id);
  assert.match(publicAfterDeletion.rows[0].post_author_id, /^deleted:/);
  assert.equal(publicAfterDeletion.rows[0].helpful, "0");
  assert.equal(publicAfterDeletion.rows[0].misleading, "0");
  assert.equal(publicAfterDeletion.rows[0].follower_count, "0");
  const annotationAfterDeletion = await pool.query(`
    SELECT author_id, author_name, author_initials, author_profile_snapshot
      FROM annotations
     WHERE id = $1
  `, [publicAnnotation.id]);
  assert.match(annotationAfterDeletion.rows[0].author_id, /^deleted:/);
  assert.equal(annotationAfterDeletion.rows[0].author_name, "已注销用户");
  assert.equal(annotationAfterDeletion.rows[0].author_initials, "已");
  assert.deepEqual(annotationAfterDeletion.rows[0].author_profile_snapshot, {
    educationStage: null,
    institutions: []
  });
  assert.deepEqual(await accountLifecycle.deleteAccount(accountDeletionInput), {
    ...accountDeletion,
    replayed: true
  });
  await assert.rejects(
    () => accountLifecycle.deleteAccount({
      ...accountDeletionInput,
      idempotencyKey: "delete-user-1-integration-new-key"
    }),
    /IDEMPOTENCY_KEY_REUSED/
  );
  const lifecycleAudit = await pool.query(`
    SELECT event_id, action, subject_id, requested_by, trace_id
      FROM account_lifecycle_audit
     WHERE operation_id = $1
  `, [accountDeletionInput.idempotencyKey]);
  assert.deepEqual(lifecycleAudit.rows.map((row) => ({
    action: row.action,
    requestedBy: row.requested_by,
    subjectId: row.subject_id,
    traceId: row.trace_id
  })), [{
    action: "forum_account_data_deleted",
    requestedBy: "admin-1",
    subjectId: "user-1",
    traceId: "trace-account-delete-1"
  }]);
  await assert.rejects(
    () => migrationPool.query(
      "UPDATE account_lifecycle_audit SET reason = 'tampered' WHERE event_id = $1",
      [lifecycleAudit.rows[0].event_id]
    ),
    /account_lifecycle_audit_is_append_only/
  );
  await assert.rejects(
    () => migrationPool.query(
      "DELETE FROM account_lifecycle_audit WHERE event_id = $1",
      [lifecycleAudit.rows[0].event_id]
    ),
    /account_lifecycle_audit_is_append_only/
  );

  const counts = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM posts) AS posts,
      (SELECT count(*)::int FROM comments) AS comments,
      (SELECT count(*)::int FROM moderation_audit) AS legacy_audit,
      (SELECT count(*)::int FROM annotations) AS annotations,
      (SELECT count(*)::int FROM annotation_moderation_audit) AS annotation_audit,
      (SELECT count(*)::int FROM annotation_tag_appeal_audit) AS tag_appeal_audit
  `);
  process.stdout.write(`${JSON.stringify({
    ...counts.rows[0],
    accountDeletion: true,
    database: application.pathname.slice(1),
    migrations: migrated.applied.length,
    verified: true
  })}\n`);
} finally {
  await pool.end();
  await migrationPool.end();
}
