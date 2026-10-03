import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { desktopAnnotationPublicationDigest } from "../src/annotationCommunitySqlite.mjs";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";
import { validateIntuechoPostgresIntegrationDatabases } from "./postgresIntegrationGuard.mjs";

const { application } = validateIntuechoPostgresIntegrationDatabases(
  process.env.INTUECHO_TEST_DATABASE_URL, process.env.INTUECHO_TEST_MIGRATION_DATABASE_URL
);
const pool = new pg.Pool({ ...application, max: 3, ssl: false });
const suffix = randomUUID();
const owner = { id: `profile-owner-${suffix}`, name: "Synthetic Profile Owner", initials: "SP" };
const literatureId = `profile-literature-${suffix}`;
const identifierId = `profile-identifier-${suffix}`;
const timestamp = "2026-10-03T01:00:00.000Z";
try {
  await pool.query(`INSERT INTO literature_records(id,title,authors,record_source,source_provider,confirmed_at,confirmation_status)
    VALUES ($1,'Synthetic source','[]'::jsonb,'public_registry','crossref',now(),'confirmed')`, [literatureId]);
  await pool.query(`INSERT INTO literature_identifiers(id,literature_id,identifier_kind,identifier_role,normalized_value,is_legacy_alias)
    VALUES ($1,$2,'doi','confirmable',$3,false)`, [identifierId, literatureId, `10.1000/${suffix}`]);
  const repository = new PostgresAnnotationCommunityRepository(pool);
  const profile = await repository.updateProfile(owner.id, { educationStage: "undergraduate", institutions: [{ name: "Original University" }] });
  const thin = { annotationId: "thin-local", queueKey: `thin-${suffix}`, body: "Synthetic thin note", createdAt: timestamp, updatedAt: timestamp,
    targets: [{ kind: "whole_document", literature: { literatureId } }], expectedAuthorProfileRevision: profile.revision };
  const pdf = { annotationId: "pdf-local", queueKey: `pdf-${suffix}`, body: "Synthetic PDF note", updatedAt: timestamp, revision: 1, operation: "upsert",
    literatureId, sourcePassage: { anchorHash: "synthetic-anchor", excerpt: "Synthetic evidence", rects: [] }, expectedAuthorProfileRevision: profile.revision };
  const [thinReceipt] = await repository.syncDesktopAnnotations(owner, [thin]);
  const [pdfReceipt] = await repository.applyDesktopAnnotationPublications(owner, [pdf]);
  assert.equal(thinReceipt.status, "synced");
  assert.equal(pdfReceipt.state, "published");
  const lookupQuery = { annotationId: pdf.annotationId, queueKey: pdf.queueKey, revision: pdf.revision,
    updatedAt: pdf.updatedAt, operationDigest: desktopAnnotationPublicationDigest(pdf) };
  const reader = await pool.connect();
  try {
    await reader.query("BEGIN READ ONLY");
    const lookup = new PostgresAnnotationCommunityRepository(reader);
    assert.deepEqual(await lookup.lookupDesktopAnnotationPublications(owner, [lookupQuery]), [{ ...lookupQuery, status: "matched", receipt: pdfReceipt }]);
    assert.equal((await lookup.lookupDesktopAnnotationPublications({ ...owner, id: `other-${suffix}` }, [lookupQuery]))[0].status, "not_found");
    for (const changed of [{ ...lookupQuery, revision: 2 }, { ...lookupQuery, operationDigest: "0".repeat(64) }, { ...lookupQuery, annotationId: "another" }]) {
      assert.equal((await lookup.lookupDesktopAnnotationPublications(owner, [changed]))[0].status, "conflict");
    }
    await reader.query("COMMIT");
  } catch (error) { await reader.query("ROLLBACK"); throw error; }
  finally { reader.release(); }

  await repository.updateProfile(owner.id, { educationStage: null, institutions: [] });
  assert.equal((await repository.syncDesktopAnnotations(owner, [thin]))[0].intuechoAnnotationId, thinReceipt.intuechoAnnotationId);
  assert.deepEqual(await repository.applyDesktopAnnotationPublications(owner, [pdf]), [pdfReceipt]);
  assert.equal((await repository.syncDesktopAnnotations(owner, [{ ...thin, expectedAuthorProfileRevision: profile.revision + 1 }]))[0].error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  assert.equal((await repository.applyDesktopAnnotationPublications(owner, [{ ...pdf, expectedAuthorProfileRevision: profile.revision + 1 }]))[0].error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  assert.equal((await repository.syncDesktopAnnotations(owner, [{ ...thin, updatedAt: "2026-10-04T01:00:00.000Z" }]))[0].error, "AUTHOR_PROFILE_CHANGED");
  assert.equal((await repository.applyDesktopAnnotationPublications(owner, [{ ...pdf, revision: 2 }]))[0].error, "AUTHOR_PROFILE_CHANGED");
  const snapshots = (await pool.query("SELECT author_profile_snapshot,revision FROM annotations WHERE author_id=$1 ORDER BY id", [owner.id])).rows;
  assert.equal(snapshots.length, 2);
  for (const row of snapshots) {
    assert.equal(Number(row.revision), 1);
    assert.deepEqual(row.author_profile_snapshot.institutions, [{ name: "Original University" }]);
  }
  console.log(JSON.stringify({ verified: true, storage: "postgresql", cases: ["pdf-read-only-exact-operation-lookup", "thin-pdf-profile-fence", "immutable-committed-replay", "same-version-profile-conflict", "stale-profile-no-write"] }));
} finally {
  await pool.query("DELETE FROM desktop_annotation_publications WHERE owner_id=$1", [owner.id]);
  await pool.query("DELETE FROM desktop_annotation_syncs WHERE owner_id=$1", [owner.id]);
  await pool.query("DELETE FROM annotations WHERE author_id=$1", [owner.id]);
  await pool.query("DELETE FROM community_profile_institutions WHERE user_id=$1", [owner.id]);
  await pool.query("DELETE FROM community_user_profiles WHERE user_id=$1", [owner.id]);
  await pool.query("DELETE FROM literature_records WHERE id=$1", [literatureId]);
  await pool.end();
}
