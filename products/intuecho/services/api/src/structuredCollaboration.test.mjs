import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";

const host = { id: "pack-host", name: "Synthetic host", initials: "SH" };
const reader = { id: "pack-reader", name: "Synthetic reader", initials: "SR" };
async function fixture(run) {
  const db = new Database(":memory:"); let allowed = true;
  const repository = new SqliteAnnotationCommunityRepository(db, { authorizeOrganizationVisibility: async () => allowed });
  const literature = await repository.confirmRefetchedLiterature(host, { candidateKey: "crossref:doi:10.1000/reading-sources", provider: "crossref", record: { title: "Synthetic first reading source", authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/reading-sources" }], year: 2026 } });
  const base = { body: "First pack with no magic label", visibility: "organization", organizationId: "org-first", shareToPlaza: false, tags: [], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }] };
  const collaboration = { schemaVersion: 1, kind: "reading_pack", sourceRefs: [{ sourceNamespace: "intuecho.literature", sourceId: literature.literatureId, revision: literature.revision }], discussionDueAt: "2026-11-01T00:00:00Z" };
  try { await run({ db, repository, base, collaboration, revoke: () => { allowed = false; } }); } finally { db.close(); }
}

test("zero-data organization selects confirmed sources and pack semantics survive labels", async () => fixture(async ({ db, repository, base, collaboration }) => {
  const sources = await repository.readingSources("org-first", host, "Synthetic");
  assert.equal(sources.length, 1); assert.equal(db.prepare("SELECT count(*) n FROM annotations_v2").get().n, 0);
  const pack = await repository.createAnnotation(host, { ...base, collaboration, notificationIntent: "reading_task" });
  assert.equal(pack.collaboration.kind, "reading_pack");
  const changed = await repository.updateAnnotation(pack.id, host, { body: "Renamed and translated", tags: ["Other label"], expectedRevision: 1 });
  assert.equal(changed.collaboration.kind, "reading_pack");
  const legacy = await repository.createAnnotation(host, { ...base, tags: ["读书包"] });
  assert.equal(legacy.collaboration, null);
  await assert.rejects(repository.createAnnotation(host, { ...base, visibility: "public", organizationId: undefined, collaboration }), { code: "INVALID_COLLABORATION_SCOPE" });
}));

test("references check actual source revision and current access before exposing historical bodies", async () => fixture(async ({ repository, base, collaboration, revoke }) => {
  const pack = await repository.createAnnotation(host, { ...base, collaboration });
  const question = await repository.createReply(pack.id, reader, { body: "Original question", publishAsAnnotation: false, tags: [], targets: [], collaboration: { schemaVersion: 1, kind: "question", parentPackId: pack.id, sourceRefs: [] } });
  const sourceRef = { sourceNamespace: "intuecho.reply", sourceId: question.reply.id, revision: 1 };
  const summary = { body: "Host synthesis", publishAsAnnotation: false, tags: [], targets: [], collaboration: { schemaVersion: 1, kind: "host_summary", parentPackId: pack.id, sourceRefs: [sourceRef] } };
  await repository.updateReply(question.reply.id, reader, { body: "Corrected question", expectedRevision: 1 });
  await assert.rejects(repository.createReply(pack.id, host, summary), { code: "SOURCE_REVISION_CONFLICT" });
  await assert.rejects(repository.createReply(pack.id, reader, { ...summary, collaboration: { ...summary.collaboration, sourceRefs: [] } }), { code: "HOST_SUMMARY_AUTHOR_REQUIRED" });
  const historical = await repository.communitySourceRevision(reader, "intuecho.reply", question.reply.id, 1);
  assert.equal(historical.body, "Original question"); assert.equal(historical.currentRevision, 2); assert.equal(historical.historical, true);
  const valid = await repository.createReply(pack.id, host, { ...summary, collaboration: { ...summary.collaboration, sourceRefs: [{ ...sourceRef, revision: 2 }] } });
  assert.equal(valid.reply.collaboration.kind, "host_summary");
  revoke();
  await assert.rejects(repository.communitySourceRevision(reader, "intuecho.reply", question.reply.id, 1), { code: "ANNOTATION_NOT_FOUND" });
  await assert.rejects(repository.readingSources("org-first", reader, "Synthetic"), { code: "ORGANIZATION_ACCESS_DENIED" });
}));

test("public reply history handles nullable organization scope and private history stays private after promotion", async () => fixture(async ({ repository, base }) => {
  const publicInput = { ...base, visibility: "public", organizationId: undefined };
  const annotation = await repository.createAnnotation(host, publicInput);
  const reply = (await repository.createReply(annotation.id, reader, { body: "Original public reply", publishAsAnnotation: false, tags: [], targets: [] })).reply;
  await repository.updateReply(reply.id, reader, { body: "Current public reply", expectedRevision: 1 });
  const old = await repository.communitySourceRevision(host, "intuecho.reply", reply.id, 1);
  assert.equal(old.body, "Original public reply"); assert.equal(old.currentRevision, 2); assert.equal(old.organizationId, null);
  const privateAnnotation = await repository.createAnnotation(host, { ...base, visibility: "private", organizationId: undefined, body: "Private old body" });
  await repository.updateAnnotation(privateAnnotation.id, host, { visibility: "public", body: "Explicit public replacement", expectedRevision: 1 });
  await assert.rejects(repository.communitySourceRevision(reader, "intuecho.annotation", privateAnnotation.id, 1), { code: "SOURCE_NOT_FOUND" });
}));
