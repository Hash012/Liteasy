import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import Database from "better-sqlite3";
import { communityCommandPayload } from "@intuecho/contracts";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";

const actor = { id: "command-actor", name: "Synthetic", initials: "SY" };
export function commandInput(type, target, input, operationId = randomUUID()) {
  return { ...input, command: { protocolVersion: 1, operationId, bodyDigest: createHash("sha256").update(communityCommandPayload(type, target, input)).digest("hex") } };
}
async function fixture(run) {
  const db = new Database(":memory:");
  const repository = new SqliteAnnotationCommunityRepository(db, { authorizeOrganizationVisibility: async () => true });
  const literature = await repository.confirmRefetchedLiterature(actor, { candidateKey: "crossref:doi:10.1000/commands", provider: "crossref", record: { title: "Commands fixture", authors: ["Synthetic"], identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/commands" }], year: 2026 } });
  const base = { body: "A synthetic command body", visibility: "public", shareToPlaza: false, tags: [], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }] };
  try { await run({ db, repository, base }); } finally { db.close(); }
}

test("SQLite commit then lost response replays one annotation and actor-bound receipt", async () => fixture(async ({ db, repository, base }) => {
  const input = commandInput("create_annotation", null, base);
  const first = await repository.createAnnotation(actor, input);
  const retry = await repository.createAnnotation(actor, input);
  assert.equal(retry.id, first.id);
  assert.equal(db.prepare("SELECT count(*) AS count FROM annotations_v2").get().count, 1);
  assert.equal((await repository.lookupCommunityCommand(actor, "create_annotation", input.command.operationId)).result.annotation.id, first.id);
  assert.deepEqual(await repository.lookupCommunityCommand({ id: "other" }, "create_annotation", input.command.operationId), { status: "not_found" });
  await assert.rejects(repository.createAnnotation(actor, commandInput("create_annotation", null, { ...base, body: "Changed body" }, input.command.operationId)), { code: "COMMAND_PAYLOAD_CONFLICT" });
  assert.notEqual((await repository.createAnnotation(actor, commandInput("create_annotation", null, base))).id, first.id);
  await repository.withdraw(first.id, actor);
  const lookup = await repository.lookupCommunityCommand(actor, "create_annotation", input.command.operationId);
  assert.equal(lookup.available, false); assert.equal(lookup.result, undefined);
  await assert.rejects(repository.createAnnotation(actor, input), { code: "COMMAND_RESULT_UNAVAILABLE" });
}));

test("SQLite replies replay once and annotation/reply edits reject stale revisions", async () => fixture(async ({ db, repository, base }) => {
  const annotation = await repository.createAnnotation(actor, base);
  const replyInput = commandInput("create_reply", annotation.id, { body: "Reply evidence", tags: [], targets: [], publishAsAnnotation: false, expectedParent: { revision: 1, visibility: "public", organizationId: null } });
  const first = await repository.createReply(annotation.id, actor, replyInput);
  const retry = await repository.createReply(annotation.id, actor, replyInput);
  assert.equal(first.reply.id, retry.reply.id);
  assert.equal(db.prepare("SELECT count(*) AS count FROM community_notification_events WHERE kind='reply'").get().count, 1);
  await repository.updateAnnotation(annotation.id, actor, { body: "Version two", expectedRevision: 1 });
  await assert.rejects(repository.updateAnnotation(annotation.id, actor, { body: "Stale", expectedRevision: 1 }), { code: "ANNOTATION_REVISION_CONFLICT" });
  await repository.updateReply(first.reply.id, actor, { body: "Reply version two", expectedRevision: 1 });
  await assert.rejects(repository.updateReply(first.reply.id, actor, { body: "Stale reply", expectedRevision: 1 }), { code: "REPLY_REVISION_CONFLICT" });
}));

test("failed command transaction rolls back content, event and receipt", async () => fixture(async ({ db, repository, base }) => {
  const annotation = await repository.createAnnotation(actor, base);
  const input = commandInput("create_reply", annotation.id, { body: "Rejected mention", tags: [], targets: [], publishAsAnnotation: false, mentionedUserIds: ["unknown"] });
  await assert.rejects(repository.createReply(annotation.id, actor, input), { code: "MENTION_TARGET_NOT_IN_THREAD" });
  assert.deepEqual(await repository.lookupCommunityCommand(actor, "create_reply", input.command.operationId), { status: "not_found" });
  assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_replies_v2").get().count, 0);
}));

test("profile and reply-publication snapshots are enforced without invalidating command replay", async () => fixture(async ({ repository, base }) => {
  const profile = await repository.profile(actor.id);
  const input = commandInput("create_annotation", null, { ...base, expectedAuthorProfileRevision: profile.revision });
  const annotation = await repository.createAnnotation(actor, input);
  await repository.updateProfile(actor.id, { educationStage: "Synthetic revised", institutions: [] });
  assert.equal((await repository.createAnnotation(actor, input)).id, annotation.id);
  await assert.rejects(repository.updateAnnotation(annotation.id, actor, { body: "Stale author preview", expectedRevision: 1, expectedAuthorProfileRevision: profile.revision }), { code: "AUTHOR_PROFILE_CHANGED" });
  await assert.rejects(repository.createReply(annotation.id, actor, { body: "Stale reply author preview", tags: [], targets: [], publishAsAnnotation: false, expectedAuthorProfileRevision: profile.revision }), { code: "AUTHOR_PROFILE_CHANGED" });
  const reply = (await repository.createReply(annotation.id, actor, { body: "Reply", tags: [], targets: [], publishAsAnnotation: false })).reply;
  await assert.rejects(repository.updateReplyPublication(reply.id, actor, { published: true, tags: [], targets: base.targets, expectedRevision: 1, expectedAuthorProfileRevision: profile.revision }), { code: "AUTHOR_PROFILE_CHANGED" });
  await assert.rejects(repository.updateReplyPublication(reply.id, actor, { published: true, tags: [], targets: base.targets, expectedRevision: 1, expectedParent: { revision: 2, visibility: "public", organizationId: null } }), { code: "PARENT_ANNOTATION_REVISION_CONFLICT" });
}));
