import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";

const owner = { id: "synthetic-owner", initials: "SO", name: "Synthetic Owner" };
const createdAt = "2026-10-03T01:00:00.000Z";
const updatedAt = "2026-10-03T02:00:00.000Z";
const operation = { annotationId: "local-1", queueKey: "artifact-1:local-1", remoteAnnotationId: "remote-1",
  operation: "retract", revision: 2, updatedAt };

function setup(t) {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  t.after(() => db.close());
  db.prepare(`INSERT INTO annotations_v2(id,body,author_id,author_name,author_initials,author_profile_snapshot_json,
    visibility,share_to_plaza,revision,created_at,updated_at) VALUES ('remote-1','Synthetic original',?,?,?,'{}','public',1,1,?,?)`)
    .run(owner.id, owner.name, owner.initials, createdAt, createdAt);
  db.prepare(`INSERT INTO desktop_annotation_syncs_v2(owner_id,queue_key,source_annotation_id,annotation_id,
    source_created_at,source_updated_at,updated_at) VALUES (?,?,'local-1','remote-1',?,?,?)`)
    .run(owner.id, operation.queueKey, createdAt, createdAt, createdAt);
  db.prepare(`INSERT INTO annotation_replies_v2(id,parent_annotation_id,body,author_id,author_name,author_initials,
    author_profile_snapshot_json,visibility,revision,created_at,updated_at) VALUES ('reply-1','remote-1','Preserved reply','other','Other','O','{}','public',1,?,?)`)
    .run(createdAt, createdAt);
  return { db, repository };
}

test("bridges an owned legacy thin-reading withdrawal into the existing publication ledger once", (t) => {
  const { db, repository } = setup(t);
  const [receipt] = repository.applyDesktopAnnotationPublications(owner, [operation]);
  assert.equal(receipt.state, "retracted");
  assert.equal(receipt.remoteAnnotationId, "remote-1");
  assert.equal(receipt.remoteRevision, 2);
  assert.deepEqual(repository.applyDesktopAnnotationPublications(owner, [operation]), [receipt]);
  assert.equal(db.prepare("SELECT count(*) count FROM desktop_annotation_publications_v2").get().count, 1);
  assert.deepEqual(db.prepare("SELECT visibility,share_to_plaza,revision,withdrawn_at FROM annotations_v2").get(),
    { visibility: "private", share_to_plaza: 0, revision: 2, withdrawn_at: null });
  assert.equal(db.prepare("SELECT body FROM annotation_replies_v2").get().body, "Preserved reply");
  assert.equal(db.prepare("SELECT deleted_at FROM annotation_replies_v2").get().deleted_at, null);
});

test("requires the exact owner, source annotation and remote identity before adopting a legacy mapping", (t) => {
  const { db, repository } = setup(t);
  for (const [actor, pending] of [
    [{ ...owner, id: "other" }, operation], [owner, { ...operation, annotationId: "forged" }],
    [owner, { ...operation, remoteAnnotationId: "forged" }], [owner, { ...operation, updatedAt: "2026-10-02T00:00:00.000Z" }]
  ]) assert.equal(repository.applyDesktopAnnotationPublications(actor, [pending])[0].state, undefined);
  assert.equal(db.prepare("SELECT visibility FROM annotations_v2").get().visibility, "public");
  assert.equal(db.prepare("SELECT count(*) count FROM desktop_annotation_publications_v2").get().count, 0);
});

test("rejects every legacy upsert after withdrawal and rejects divergent same-version withdrawal", (t) => {
  const { db, repository } = setup(t);
  repository.applyDesktopAnnotationPublications(owner, [operation]);
  for (const date of [createdAt, "2027-10-03T00:00:00.000Z"]) {
    const [result] = repository.syncDesktopAnnotations(owner, [{ annotationId: operation.annotationId, queueKey: operation.queueKey,
      body: "Must not resurrect", targets: [], createdAt, updatedAt: date }]);
    assert.equal(result.status, "failed");
    assert.equal(result.error, "ANNOTATION_PUBLICATION_RETRACTED");
  }
  assert.equal(repository.applyDesktopAnnotationPublications(owner, [{ ...operation, remoteAnnotationId: "changed" }])[0].error,
    "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  assert.equal(db.prepare("SELECT visibility FROM annotations_v2").get().visibility, "private");
  assert.equal(db.prepare("SELECT body FROM annotations_v2").get().body, "Synthetic original");
});

test("rolls back privacy changes if the bridge receipt cannot commit", (t) => {
  const { db, repository } = setup(t);
  db.exec("CREATE TRIGGER fail_bridge BEFORE INSERT ON desktop_annotation_publications_v2 BEGIN SELECT RAISE(ABORT, 'synthetic commit failure'); END");
  assert.throws(() => repository.applyDesktopAnnotationPublications(owner, [operation]), /synthetic commit failure/u);
  assert.equal(db.prepare("SELECT visibility FROM annotations_v2").get().visibility, "public");
  assert.equal(db.prepare("SELECT count(*) count FROM desktop_annotation_publications_v2").get().count, 0);
});
