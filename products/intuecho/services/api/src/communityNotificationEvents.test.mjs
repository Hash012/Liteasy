import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { SqliteCommunityGovernanceRepository, initializeSqliteCommunityGovernance, recordSqliteCommunitySourceEvent } from "./communityGovernanceRepository.mjs";

const author = { id: "host", name: "Synthetic host", initials: "SH" };
const reader = { id: "reader", name: "Synthetic reader", initials: "SR" };
async function fixture(run) {
  const db = new Database(":memory:");
  const access = async () => ({ allowed: true, role: "admin" });
  const annotations = new SqliteAnnotationCommunityRepository(db, { authorizeOrganizationAccess: access, authorizeOrganizationVisibility: async () => true });
  const governance = new SqliteCommunityGovernanceRepository(db, { annotationRepository: annotations, authorizeOrganizationAccess: access });
  const literature = await annotations.confirmRefetchedLiterature(author, { candidateKey: "crossref:doi:10.1000/event-fixture", provider: "crossref", record: { authors: ["Synthetic Author"], title: "Synthetic event material", identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/event-fixture" }], documentType: "journal_article", year: 2026 } });
  const input = { body: "Synthetic organization reading assignment.", visibility: "organization", organizationId: "org", shareToPlaza: false, tags: ["读书包"], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }] };
  const subscribe = (viewer, targetKind, targetId) => governance.setPreference(viewer, { targetKind, targetId, subscribed: true, muted: false, blocked: false });
  try { await run({ db, annotations, governance, input, subscribe }); } finally { db.close(); }
}

test("reading-task reminders require explicit structured intent and an actual organization reading pack", async () => fixture(async ({ db, annotations, governance, input, subscribe }) => {
  await subscribe(reader, "organization", "org");
  await annotations.createAnnotation(author, input);
  assert.equal((await governance.notifications(reader)).length, 0);
  const pack = await annotations.createAnnotation(author, { ...input, notificationIntent: "reading_task" });
  const inbox = await governance.notifications(reader);
  assert.equal(inbox.length, 1); assert.equal(inbox[0].kind, "reading_task");
  assert.equal(inbox[0].target.annotationId, pack.id);
  db.transaction(() => recordSqliteCommunitySourceEvent(db, { kind: "reading_task", sourceId: pack.id, annotationId: pack.id, actorId: author.id }))();
  assert.equal((await governance.notifications(reader)).length, 1);
  await assert.rejects(annotations.createAnnotation(author, { ...input, visibility: "public", organizationId: undefined, notificationIntent: "reading_task" }), (error) => error.code === "INVALID_READING_TASK_INTENT");
  assert.equal(db.prepare("SELECT count(*) AS count FROM annotations_v2").get().count, 2);
}));

test("structured mentions target existing participants, deduplicate the ordinary reply and roll back invalid targets", async () => fixture(async ({ db, annotations, governance, input, subscribe }) => {
  const pack = await annotations.createAnnotation(author, input);
  await subscribe(author, "thread", pack.id);
  const reply = await annotations.createReply(pack.id, reader, { body: "This text mentions no parsed names.", publishAsAnnotation: false, targets: [], tags: [], mentionedUserIds: [author.id], expectedParent: { revision: 1, visibility: "organization", organizationId: "org" } });
  const inbox = await governance.notifications(author);
  assert.equal(inbox.length, 1); assert.equal(inbox[0].kind, "mention");
  assert.equal(db.prepare("SELECT source_id FROM community_notification_events WHERE kind = 'mention'").get().source_id, reply.reply.id);
  await assert.rejects(annotations.createReply(pack.id, reader, { body: "An unknown target must not be persisted.", publishAsAnnotation: false, targets: [], tags: [], mentionedUserIds: ["outsider"] }), (error) => error.code === "MENTION_TARGET_NOT_IN_THREAD");
  assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_replies_v2").get().count, 1);
}));

test("report, appeal, and moderation results use persisted business IDs and current content access", async () => fixture(async ({ db, annotations, governance, input, subscribe }) => {
  const annotation = await annotations.createAnnotation(author, { ...input, visibility: "public", organizationId: undefined });
  await subscribe(reader, "thread", annotation.id);
  await subscribe(author, "thread", annotation.id);
  const report = await governance.submitReport(reader, annotation.id, { revision: 1, reason: "other", detail: "Synthetic private report evidence, never copied to inbox." });
  await governance.resolveReport({ id: "moderator" }, report.id, { status: "resolved", reason: "reviewed" }, { platformAdmin: true });
  const result = (await governance.notifications(reader))[0];
  assert.equal(result.kind, "report_result"); assert.equal(result.target.reportId, report.id);
  assert.equal(JSON.stringify(result).includes("evidence"), false);
  assert.equal((await governance.notifications(author)).length, 0);
  db.prepare("INSERT INTO annotation_tags_v2(annotation_id, tag_slug, tag_name, origin, state, assigned_at, updated_at) VALUES (?, 'synthetic-label', 'Synthetic Label', 'platform', 'active', '2026-10-03', '2026-10-03')").run(annotation.id);
  const appeal = annotations.appealPlatformTag(annotation.id, "synthetic-label", author.id, "Synthetic tag appeal evidence never copied to inbox.");
  annotations.resolveTagAppeal(appeal.appealId, "moderator", { decision: "accepted", reason: "Synthetic review completed." }, "trace");
  assert.equal((await governance.notifications(author))[0].kind, "tag_appeal_result");
  annotations.moderateAnnotation({ annotationId: annotation.id, adminId: "moderator", action: "withdraw", reason: "Synthetic withdrawal evidence.", traceId: "withdraw" });
  assert.ok((await governance.notifications(author)).every((item) => JSON.stringify(Object.keys(item).sort()) === JSON.stringify(["available", "id"])));
  annotations.moderateAnnotation({ annotationId: annotation.id, adminId: "moderator", action: "restore", reason: "Synthetic restoration evidence.", traceId: "restore" });
  const restored = await governance.notifications(author);
  assert.equal(restored.filter((item) => item.kind === "moderation").length, 2);
  assert.equal(JSON.stringify(restored).includes("evidence"), false);
}));

test("SQLite event upgrades preserve old reply notifications and read state", () => {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE community_notification_events(id TEXT PRIMARY KEY, annotation_id TEXT NOT NULL, reply_id TEXT NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL); INSERT INTO community_notification_events VALUES ('reply:old', 'annotation-old', 'old', 'actor-old', '2026-10-01'); CREATE TABLE community_notifications(id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES community_notification_events(id) ON DELETE CASCADE, recipient_id TEXT NOT NULL, read_at TEXT, created_at TEXT NOT NULL, UNIQUE(event_id,recipient_id)); INSERT INTO community_notifications VALUES ('opaque-old', 'reply:old', 'recipient-old', '2026-10-02', '2026-10-01');");
    initializeSqliteCommunityGovernance(db);
    assert.equal(db.prepare("SELECT kind,source_id FROM community_notification_events").get().source_id, "old");
    assert.equal(db.prepare("SELECT read_at FROM community_notifications").get().read_at, "2026-10-02");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally { db.close(); }
});
