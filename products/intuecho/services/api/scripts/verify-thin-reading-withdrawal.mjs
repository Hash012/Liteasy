import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";
import { validateIntuechoPostgresIntegrationDatabases } from "./postgresIntegrationGuard.mjs";

const { application } = validateIntuechoPostgresIntegrationDatabases(
  process.env.INTUECHO_TEST_DATABASE_URL, process.env.INTUECHO_TEST_MIGRATION_DATABASE_URL
);
const pool = new pg.Pool({ ...application, max: 3, ssl: false });
const suffix = randomUUID();
const owner = { id: `withdrawal-owner-${suffix}`, name: "Synthetic Withdrawal Owner", initials: "SW" };
const remoteId = `withdrawal-${suffix}`;
const queueKey = `withdrawal-queue-${suffix}`;
const literatureId = `withdrawal-literature-${suffix}`;
const createdAt = "2026-10-03T01:00:00.000Z";
const operation = { annotationId: "local-1", operation: "retract", queueKey, remoteAnnotationId: remoteId,
  revision: 2, updatedAt: "2026-10-03T02:00:00.000Z" };
try {
  const repository = new PostgresAnnotationCommunityRepository(pool);
  const fixture = await pool.connect();
  try {
    await fixture.query("BEGIN");
    await fixture.query("INSERT INTO literature_records(id,title,authors) VALUES ($1,'Synthetic withdrawal source','[]'::jsonb)", [literatureId]);
    await fixture.query(`INSERT INTO annotations(id,body,author_id,author_name,author_initials,author_profile_snapshot,
    visibility,share_to_plaza,created_at,updated_at) VALUES ($1,'Synthetic original',$2,$3,$4,'{}'::jsonb,'public',true,$5,$5)`,
    [remoteId, owner.id, owner.name, owner.initials, createdAt]);
    await fixture.query(`INSERT INTO annotation_targets(id,annotation_id,literature_id,target_kind,position,target)
      VALUES ($1,$2,$3,'whole_document',0,'{"kind":"whole_document"}'::jsonb)`, [`target-${suffix}`, remoteId, literatureId]);
    await fixture.query("COMMIT");
  } catch (error) { await fixture.query("ROLLBACK"); throw error; }
  finally { fixture.release(); }
  await pool.query(`INSERT INTO desktop_annotation_syncs(owner_id,queue_key,source_annotation_id,annotation_id,
    source_created_at,source_updated_at) VALUES ($1,$2,'local-1',$3,$4,$4)`, [owner.id, queueKey, remoteId, createdAt]);
  await pool.query(`INSERT INTO annotation_replies(id,parent_annotation_id,body,author_id,author_name,author_initials,
    author_profile_snapshot,visibility) VALUES ($1,$2,'Preserved reply','synthetic-other','Other','O','{}'::jsonb,'public')`,
    [`reply-${suffix}`, remoteId]);

  const original = { annotationId: "local-1", queueKey, body: "Synthetic original", createdAt, updatedAt: createdAt,
    targets: [{ kind: "whole_document", literature: { literatureId, literatureRecord: { title: "Display-only hydration" } } }] };
  assert.equal((await repository.syncDesktopAnnotations(owner, [original]))[0].status, "synced");
  assert.equal((await repository.syncDesktopAnnotations(owner, [{ ...original, body: "Same-version divergence" }]))[0].error,
    "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  assert.equal((await repository.syncDesktopAnnotations(owner, [{ ...original, annotationId: "forged-source" }]))[0].error,
    "ANNOTATION_PUBLICATION_QUEUE_CONFLICT");
  assert.equal((await pool.query("SELECT revision::int FROM annotations WHERE id = $1", [remoteId])).rows[0].revision, 1);

  for (const [actor, invalid] of [
    [{ ...owner, id: `other-${suffix}` }, operation], [owner, { ...operation, annotationId: "forged" }],
    [owner, { ...operation, remoteAnnotationId: `forged-${suffix}` }]
  ]) assert.equal((await repository.applyDesktopAnnotationPublications(actor, [invalid]))[0].state, undefined);
  assert.equal((await pool.query("SELECT visibility FROM annotations WHERE id = $1", [remoteId])).rows[0].visibility, "public");

  // Inject an application failure after the actual UPDATE, while allowing the
  // existing transaction helper to issue a real PostgreSQL ROLLBACK.
  const failing = new PostgresAnnotationCommunityRepository({
    connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, parameters) => {
        if (sql.startsWith("INSERT INTO desktop_annotation_publications")) throw new Error("synthetic ledger failure");
        return client.query(sql, parameters);
      } };
    }
  });
  await assert.rejects(() => failing.applyDesktopAnnotationPublications(owner, [operation]), /synthetic ledger failure/u);
  assert.equal((await pool.query("SELECT visibility FROM annotations WHERE id = $1", [remoteId])).rows[0].visibility, "public");

  const [first, concurrentReplay] = await Promise.all([
    repository.applyDesktopAnnotationPublications(owner, [operation]),
    repository.applyDesktopAnnotationPublications(owner, [operation])
  ]);
  assert.equal(first[0].state, "retracted");
  assert.equal(first[0].remoteRevision, 2);
  assert.deepEqual(concurrentReplay, first);
  assert.deepEqual(await repository.applyDesktopAnnotationPublications(owner, [operation]), first);
  for (const updatedAt of [createdAt, "2027-10-03T00:00:00.000Z"]) {
    const [blocked] = await repository.syncDesktopAnnotations(owner, [{ annotationId: "local-1", queueKey,
      body: "Must not resurrect", targets: [], createdAt, updatedAt }]);
    assert.equal(blocked.error, "ANNOTATION_PUBLICATION_RETRACTED");
    assert.equal(blocked.status, "failed");
  }
  assert.equal((await repository.applyDesktopAnnotationPublications(owner, [{ ...operation, remoteAnnotationId: "changed" }]))[0].error,
    "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  assert.deepEqual((await pool.query("SELECT visibility,share_to_plaza,revision::int,withdrawn_at FROM annotations WHERE id = $1", [remoteId])).rows[0],
    { visibility: "private", share_to_plaza: false, revision: 2, withdrawn_at: null });
  assert.equal((await pool.query("SELECT body FROM annotation_replies WHERE id = $1", [`reply-${suffix}`])).rows[0].body, "Preserved reply");
  console.log(JSON.stringify({ verified: true, storage: "postgresql", cases: ["exact-legacy-replay", "legacy-version-conflict", "owner-source-remote", "rollback", "concurrent-replay", "no-resurrection", "replies-preserved"] }));
} finally {
  await pool.query("DELETE FROM annotation_replies WHERE id = $1", [`reply-${suffix}`]);
  await pool.query("DELETE FROM desktop_annotation_publications WHERE owner_id = $1 AND queue_key = $2", [owner.id, queueKey]);
  await pool.query("DELETE FROM desktop_annotation_syncs WHERE owner_id = $1 AND queue_key = $2", [owner.id, queueKey]);
  await pool.query("DELETE FROM annotations WHERE id = $1 AND author_id = $2", [remoteId, owner.id]);
  await pool.query("DELETE FROM literature_records WHERE id = $1", [literatureId]);
  await pool.end();
}
