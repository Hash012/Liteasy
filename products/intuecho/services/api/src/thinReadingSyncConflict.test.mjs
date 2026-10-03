import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { thinReadingSyncPayload } from "./thinReadingSyncPayload.mjs";

const owner = { id: "sync-owner", name: "Synthetic Owner", initials: "SO" };
const timestamp = "2026-10-03T01:00:00.000Z";
const target = { kind: "source_passage", literature: { literatureId: "literature-1" },
  anchorHash: "synthetic-anchor", excerpt: "Synthetic evidence", page: 1, rects: [{ left: 1, top: 2, width: 3, height: 4 }] };
const operation = { annotationId: "local-1", queueKey: "queue-1", body: "Original note", createdAt: timestamp, updatedAt: timestamp, targets: [target] };
function setup(t) {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db);
  t.after(() => db.close());
  db.prepare(`INSERT INTO literature_records_v2(id,title,authors_json,publication_year,version_kind,record_source,source_provider,
    confirmed_at,revision,confirmation_status,created_at,updated_at) VALUES ('literature-1','Synthetic source','[]',2026,
    'journal_article','public_registry','crossref',?,1,'confirmed',?,?)`).run(timestamp, timestamp, timestamp);
  db.prepare(`INSERT INTO literature_identifiers_v2(id,literature_id,identifier_kind,identifier_role,normalized_value,is_legacy_alias,created_at)
    VALUES ('identifier-1','literature-1','doi','confirmable','10.1000/synthetic',0,?)`).run(timestamp);
  db.prepare(`INSERT INTO literature_identity_claims_v2(id,identifier_id,provider,provider_record_id,verification_status,evidence_json,observed_at,created_at)
    VALUES ('claim-1','identifier-1','crossref','10.1000/synthetic','confirmed','{}',?,?)`).run(timestamp, timestamp);
  const [first] = repository.syncDesktopAnnotations(owner, [operation]);
  return { db, repository, first };
}

test("rejects same-version body and target divergence without changing the prior community content", (t) => {
  const { db, repository, first } = setup(t);
  for (const changed of [
    { ...operation, body: "Conflicting body" },
    { ...operation, targets: [{ ...target, excerpt: "Conflicting evidence" }] },
    { ...operation, targets: [{ ...target, rects: [{ ...target.rects[0], left: 9 }] }] }
  ]) {
    const [result] = repository.syncDesktopAnnotations(owner, [changed]);
    assert.equal(result.status, "failed");
    assert.equal(result.error, "ANNOTATION_PUBLICATION_VERSION_CONFLICT");
  }
  assert.deepEqual(db.prepare("SELECT body,revision FROM annotations_v2 WHERE id=?").get(first.intuechoAnnotationId), { body: "Original note", revision: 1 });
});

test("keeps same-instant exact replay idempotent while ignoring hydrated non-wire metadata", (t) => {
  const { db, repository, first } = setup(t);
  const [again] = repository.syncDesktopAnnotations(owner, [{ ...operation, updatedAt: "2026-10-03T01:00:00.0000Z",
    targets: [{ ...target, literature: { literatureId: "literature-1", literatureRecord: { title: "Hydrated display metadata" } },
      displayLabel: "Display only", rects: [{ height: 4, width: 3, top: 2, left: 1 }] }] }]);
  assert.deepEqual(again, first);
  assert.equal(db.prepare("SELECT revision FROM annotations_v2 WHERE id=?").get(first.intuechoAnnotationId).revision, 1);
});

test("rejects source annotation substitution and stale versions on an existing queue key", (t) => {
  const { db, repository, first } = setup(t);
  assert.equal(repository.syncDesktopAnnotations(owner, [{ ...operation, annotationId: "forged", updatedAt: "2027-10-03T01:00:00Z" }])[0].error,
    "ANNOTATION_PUBLICATION_QUEUE_CONFLICT");
  assert.equal(repository.syncDesktopAnnotations(owner, [{ ...operation, updatedAt: "2026-10-02T01:00:00Z" }])[0].error,
    "STALE_ANNOTATION_PUBLICATION");
  assert.equal(db.prepare("SELECT revision FROM annotations_v2 WHERE id=?").get(first.intuechoAnnotationId).revision, 1);
});

test("canonicalizes derived evidence wire fields without equating changed provenance or evidence", () => {
  const derived = { kind: "derived_passage", literature: { literatureId: "literature-1" }, evidence: [target],
    derivedContent: { artifactId: "artifact-1", nodeId: "node-1", excerpt: "Derived excerpt", version: "version-1" } };
  const plain = { body: "Reader note", targets: [derived] };
  const hydrated = { ...plain, targets: [{ ...derived, literature: { ...derived.literature, literatureRecord: { title: "Display only" } },
    evidence: [{ ...target, literature: { ...target.literature, literatureRecord: { title: "Hydrated source" } } }] }] };
  assert.equal(thinReadingSyncPayload(plain), thinReadingSyncPayload(hydrated));
  for (const changed of [
    { ...derived, derivedContent: { ...derived.derivedContent, version: "version-2" } },
    { ...derived, evidence: [{ ...target, excerpt: "Different evidence" }] }
  ]) assert.notEqual(thinReadingSyncPayload(plain), thinReadingSyncPayload({ ...plain, targets: [changed] }));
});


test("looks up an unknown committed create by owner and original source without mutating it", (t) => {
  const { db, repository, first } = setup(t);
  const query = { annotationId: operation.annotationId, queueKey: operation.queueKey, updatedAt: operation.updatedAt,
    payloadDigest: createHash("sha256").update(thinReadingSyncPayload(operation)).digest("hex") };
  const before = db.serialize();
  assert.deepEqual(repository.lookupDesktopAnnotations(owner, [query]), [{ ...query, status: "matched",
    remoteAnnotationId: first.intuechoAnnotationId, publicationRevision: 1 }]);
  assert.deepEqual(db.serialize(), before);
  assert.deepEqual(repository.lookupDesktopAnnotations({ ...owner, id: "another-owner" }, [query]),
    [{ annotationId: query.annotationId, queueKey: query.queueKey, status: "not_found" }]);
});

test("lookup holds absent, stale, substituted and divergent originals without exposing content", (t) => {
  const { db, repository } = setup(t);
  const query = { annotationId: operation.annotationId, queueKey: operation.queueKey, updatedAt: operation.updatedAt,
    payloadDigest: createHash("sha256").update(thinReadingSyncPayload(operation)).digest("hex") };
  const before = db.serialize();
  for (const changed of [{ ...query, annotationId: "another-source" }, { ...query, payloadDigest: "0".repeat(64) },
    { ...query, updatedAt: "2026-10-02T01:00:00.000Z" }]) {
    const [result] = repository.lookupDesktopAnnotations(owner, [changed]);
    assert.equal(result.status, "conflict");
    assert.equal(result.remoteAnnotationId, undefined);
    assert.equal(result.body, undefined);
  }
  assert.equal(repository.lookupDesktopAnnotations(owner, [{ ...query, queueKey: "missing" }])[0].status, "not_found");
  assert.deepEqual(db.serialize(), before);
});
