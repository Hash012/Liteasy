import assert from "node:assert/strict";
import { PostgresAnnotationCommunityRepository } from "../src/postgresAnnotationCommunityRepository.mjs";
import { PostgresCommunityGovernanceRepository, recordPostgresCommunitySourceEvent } from "../src/communityGovernanceRepository.mjs";

// Invoked only by the disposable PostgreSQL harness with synthetic identities.
// Source actions and notifications stay in this isolated database; no delivery API.
export async function verifyStructuredCommunityEvents({ pool, literatureId }) {
  const host = { id: "structured-events-host", name: "Synthetic task host", initials: "SH" };
  const reader = { id: "structured-events-reader", name: "Synthetic reader", initials: "SR" };
  const moderator = { id: "structured-events-moderator", name: "Synthetic reviewer", initials: "SM" };
  let organizationAllowed = true;
  const authorizeOrganizationAccess = async () => ({ allowed: organizationAllowed, role: "admin" });
  const annotations = new PostgresAnnotationCommunityRepository(pool, { authorizeOrganizationAccess, authorizeOrganizationVisibility: async () => true });
  const governance = new PostgresCommunityGovernanceRepository(pool, { annotationRepository: annotations, authorizeOrganizationAccess });
  const input = { body: "Synthetic structured reading task", visibility: "organization", organizationId: "structured-events-org", shareToPlaza: false, tags: ["读书包"], targets: [{ kind: "whole_document", literature: { literatureId } }] };
  const subscribe = (viewer, targetKind, targetId) => governance.setPreference(viewer, { targetKind, targetId, subscribed: true, muted: false, blocked: false });
  await subscribe(reader, "organization", input.organizationId);
  await annotations.createAnnotation(host, input);
  assert.equal((await governance.notifications(reader)).length, 0);
  const pack = await annotations.createAnnotation(host, { ...input, notificationIntent: "reading_task" });
  const task = (await governance.notifications(reader))[0];
  assert.equal(task.kind, "reading_task"); assert.equal(task.target.annotationId, pack.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await recordPostgresCommunitySourceEvent(client, { kind: "reading_task", sourceId: pack.id, annotationId: pack.id, actorId: host.id });
    await client.query("COMMIT");
  } finally { await client.query("ROLLBACK"); client.release(); }
  assert.equal((await governance.notifications(reader)).length, 1);
  await assert.rejects(annotations.createAnnotation(host, { ...input, visibility: "public", organizationId: undefined, notificationIntent: "reading_task" }), (error) => error.code === "INVALID_READING_TASK_INTENT");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM annotations WHERE author_id = $1", [host.id])).rows[0].count, 2);
  await subscribe(host, "thread", pack.id);
  const reply = await annotations.createReply(pack.id, reader, { body: "Synthetic explicit mention without parsing names", publishAsAnnotation: false, tags: [], targets: [], mentionedUserIds: [host.id], expectedParent: { revision: pack.revision, visibility: "organization", organizationId: input.organizationId } });
  const mention = (await governance.notifications(host))[0];
  assert.equal(mention.kind, "mention");
  assert.equal((await pool.query("SELECT source_id FROM community_notification_events WHERE id = $1", [`mention:${reply.reply.id}:${host.id}`])).rows[0].source_id, reply.reply.id);
  assert.equal((await governance.notifications(host)).length, 1);
  await assert.rejects(annotations.createReply(pack.id, reader, { body: "Invalid target must roll back the reply", publishAsAnnotation: false, tags: [], targets: [], mentionedUserIds: ["not-a-thread-participant"] }), (error) => error.code === "MENTION_TARGET_NOT_IN_THREAD");
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM annotation_replies WHERE parent_annotation_id = $1", [pack.id])).rows[0].count, 1);
  organizationAllowed = false;
  assert.deepEqual((await governance.notifications(reader))[0], { id: task.id, available: false });
  assert.deepEqual((await governance.notifications(host))[0], { id: mention.id, available: false });
  await governance.markRead(host, mention.id);
  organizationAllowed = true;

  const publicAnnotation = await annotations.createAnnotation(host, { ...input, visibility: "public", organizationId: undefined });
  await subscribe(reader, "thread", publicAnnotation.id);
  await subscribe(host, "thread", publicAnnotation.id);
  const report = await governance.submitReport(reader, publicAnnotation.id, { revision: publicAnnotation.revision, reason: "other", detail: "Synthetic confidential report material." });
  await governance.resolveReport(moderator, report.id, { status: "resolved", reason: "reviewed" }, { platformAdmin: true });
  const reportResult = (await governance.notifications(reader)).find((item) => item.kind === "report_result");
  assert.equal(reportResult.target.reportId, report.id);
  assert.equal((await governance.notifications(host)).some((item) => item.kind === "report_result"), false);
  const tagId = "structured-events-platform-tag";
  await pool.query("INSERT INTO tags(id, slug, name) VALUES ($1, 'structured-events-label', 'Synthetic events label')", [tagId]);
  await pool.query("INSERT INTO annotation_tags(annotation_id, tag_id, origin, state) VALUES ($1, $2, 'platform', 'active')", [publicAnnotation.id, tagId]);
  const appeal = await annotations.appealPlatformTag(publicAnnotation.id, "structured-events-label", host.id, "Synthetic confidential appeal material.");
  await annotations.resolveTagAppeal(appeal.appealId, moderator.id, { decision: "accepted", reason: "Synthetic review resolution" }, "synthetic-event-review");
  const appealResult = (await governance.notifications(host)).find((item) => item.kind === "tag_appeal_result");
  assert.equal(appealResult.target.appealId, appeal.appealId);
  await annotations.moderateAnnotation({ annotationId: publicAnnotation.id, adminId: moderator.id, action: "withdraw", reason: "Synthetic moderation verification", traceId: "synthetic-events-withdraw" });
  assert.deepEqual((await governance.notifications(reader)).find((item) => item.id === reportResult.id), { id: reportResult.id, available: false });
  assert.deepEqual((await governance.notifications(host)).find((item) => item.id === appealResult.id), { id: appealResult.id, available: false });
  await annotations.moderateAnnotation({ annotationId: publicAnnotation.id, adminId: moderator.id, action: "restore", reason: "Synthetic moderation restoration", traceId: "synthetic-events-restore" });
  const restored = await governance.notifications(host);
  assert.equal(restored.filter((item) => item.kind === "moderation").length, 2);
  assert.equal(JSON.stringify(restored).includes("confidential"), false);
  return { explicitReadingTask: true, stableSourceDedupe: true, participantMentions: true, invalidMentionRollback: true, reportResults: true, appealResults: true, moderationResults: true, revokedAccessRedaction: true };
}
