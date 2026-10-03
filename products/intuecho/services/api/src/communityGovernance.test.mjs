import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import Fastify from "fastify";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { SqliteCommunityGovernanceRepository, recordSqliteCommunityReplyEvent } from "./communityGovernanceRepository.mjs";
import { registerCommunityGovernanceRoutes } from "./communityGovernanceRoutes.mjs";

async function fixture(run) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  const access = new Map([["org:member", "member"], ["org:moderator", "admin"], ["org:platform", "admin"]]);
  const authorizeOrganizationAccess = async ({ organizationId, userId }) => ({ allowed: access.has(`${organizationId}:${userId}`), role: access.get(`${organizationId}:${userId}`) });
  const annotations = new SqliteAnnotationCommunityRepository(db, { authorizeOrganizationAccess, authorizeOrganizationVisibility: async (input) => (await authorizeOrganizationAccess(input)).allowed });
  const governance = new SqliteCommunityGovernanceRepository(db, { annotationRepository: annotations, authorizeOrganizationAccess, now: () => new Date("2026-10-03T12:00:00.000Z") });
  const app = Fastify();
  registerCommunityGovernanceRoutes(app, governance, {
    requireUser(request, reply) { return request.headers["x-user"] ? { id: request.headers["x-user"] } : (reply.code(401).send({ error: "AUTH_REQUIRED" }), null); },
    requireAdmin(request, reply) { return request.headers["x-user"] === "platform" ? { id: "platform" } : (reply.code(403).send({ error: "ADMIN_REQUIRED" }), null); }
  });
  function annotation(id, visibility = "public", author = "writer") {
    db.prepare("INSERT INTO annotations_v2(id, body, author_id, author_name, author_initials, author_profile_snapshot_json, visibility, organization_id, share_to_plaza, revision, created_at, updated_at) VALUES (?, ?, ?, 'Synthetic author', 'SA', '{}', ?, ?, 0, 1, ?, ?)").run(id, `Secret body of ${id}`, author, visibility, visibility === "organization" ? "org" : null, "2026-10-03T10:00:00.000Z", "2026-10-03T10:00:00.000Z");
    db.prepare("INSERT INTO annotation_targets_v2(id, annotation_id, position, literature_id, target_kind, target_json, created_at) VALUES (?, ?, 0, 'literature_1', 'whole_document', ?, '2026-10-03T10:00:00.000Z')").run(`target:${id}`, id, JSON.stringify({ kind: "whole_document", literature: { literatureId: "literature_1" } }));
  }
  function reply(id, annotationId, actorId = "writer") {
    const parent = db.prepare("SELECT * FROM annotations_v2 WHERE id = ?").get(annotationId);
    db.transaction(() => {
      db.prepare("INSERT INTO annotation_replies_v2(id, parent_annotation_id, body, author_id, author_name, author_initials, author_profile_snapshot_json, visibility, organization_id, revision, created_at, updated_at) VALUES (?, ?, 'Secret reply text', ?, 'Synthetic author', 'SA', '{}', ?, ?, 1, ?, ?)").run(id, annotationId, actorId, parent.visibility, parent.organization_id, "2026-10-03T12:00:00.000Z", "2026-10-03T12:00:00.000Z");
      recordSqliteCommunityReplyEvent(db, { replyId: id, annotationId, actorId });
    })();
  }
  const request = (user, method, url, payload) => app.inject({ headers: user ? { "x-user": user } : {}, method, url, payload });
  try { await run({ db, governance, app, access, annotation, reply, request }); }
  finally { await app.close(); db.close(); }
}
const preference = (targetKind, targetId, changes = {}) => ({ targetKind, targetId, subscribed: true, muted: false, blocked: false, ...changes });
const report = { revision: 1, reason: "privacy", detail: "A synthetic concern about quoted private details." };

test("reports preserve requester privacy, enforce current review authority, and never change content", async () => fixture(async ({ db, request, annotation, access }) => {
  annotation("restricted", "organization");
  assert.equal((await request(null, "POST", "/v1/annotations/restricted/reports", report)).statusCode, 401);
  assert.equal((await request("outsider", "POST", "/v1/annotations/restricted/reports", report)).statusCode, 404);
  const submitted = await request("member", "POST", "/v1/annotations/restricted/reports", report);
  assert.equal(submitted.statusCode, 201, submitted.body);
  const id = submitted.json().report.id;
  const reviews = await request("moderator", "GET", "/v1/community-reports");
  assert.equal(reviews.json().reports.length, 1);
  assert.equal(JSON.stringify(reviews.json()).includes("reporter"), false);
  assert.equal(JSON.stringify(reviews.json()).includes("member"), false);
  assert.deepEqual((await request("platform", "GET", "/v1/admin/community-reports")).json().reports, []);
  access.delete("org:moderator");
  assert.equal((await request("moderator", "POST", `/v1/community-reports/${id}/resolve`, { status: "resolved", reason: "reviewed" })).statusCode, 404);
  access.set("org:moderator", "admin");
  assert.equal((await request("moderator", "POST", `/v1/community-reports/${id}/resolve`, { status: "resolved", reason: "reviewed" })).statusCode, 200);
  const own = (await request("member", "GET", "/v1/me/reports")).json().reports[0];
  assert.equal(own.status, "resolved");
  assert.equal(own.resolutionReason, "reviewed");
  assert.equal(db.prepare("SELECT body FROM annotations_v2 WHERE id = 'restricted'").get().body, "Secret body of restricted");
  const audit = db.prepare("SELECT * FROM community_report_audit").all();
  assert.deepEqual(audit.map((row) => row.action), ["submitted", "resolved"]);
  assert.equal(JSON.stringify(audit).includes(report.detail), false);
  assert.throws(() => db.prepare("UPDATE community_report_audit SET reason_code = 'other'").run(), /append_only/);
}));

test("report dedupe precedes the daily quota and changed audiences do not reveal earlier private material", async () => fixture(async ({ db, request, annotation }) => {
  for (let index = 0; index < 11; index++) annotation(`public_${index}`);
  let first;
  for (let index = 0; index < 10; index++) {
    const result = await request("member", "POST", `/v1/annotations/public_${index}/reports`, report);
    assert.equal(result.statusCode, 201, result.body);
    first ??= result.json().report;
  }
  assert.deepEqual((await request("member", "POST", "/v1/annotations/public_0/reports", report)).json().report, first);
  const limited = await request("member", "POST", "/v1/annotations/public_10/reports", report);
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().code, "REPORT_RATE_LIMITED");
  assert.equal((await request("writer", "POST", "/v1/annotations/public_0/reports", { ...report, revision: 2 })).statusCode, 409);
  annotation("private_case", "organization");
  await request("moderator", "POST", "/v1/annotations/private_case/reports", report);
  db.prepare("UPDATE annotations_v2 SET visibility = 'public', organization_id = NULL, revision = 2 WHERE id = 'private_case'").run();
  const publicReview = await request("platform", "GET", "/v1/admin/community-reports");
  assert.equal(publicReview.json().reports.some((item) => item.annotationId === "private_case"), false);
}));

test("inbox deduplicates transaction events and rechecks revoked access without leaking target metadata", async () => fixture(async ({ db, request, annotation, reply, access }) => {
  annotation("org_thread", "organization");
  const subscribe = await request("member", "PUT", "/v1/me/community-preferences", preference("thread", "org_thread"));
  assert.equal(subscribe.statusCode, 200, subscribe.body);
  reply("r1", "org_thread");
  db.transaction(() => recordSqliteCommunityReplyEvent(db, { replyId: "r1", annotationId: "org_thread", actorId: "writer" }))();
  const inbox = (await request("member", "GET", "/v1/me/notifications")).json().notifications;
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].available, true);
  assert.deepEqual(inbox[0].target, { annotationId: "org_thread", revision: 1 });
  assert.equal(JSON.stringify(inbox).includes("Secret"), false);
  assert.equal((await request("outsider", "PUT", `/v1/me/notifications/${inbox[0].id}/read`, {})).statusCode, 404);
  access.delete("org:member");
  assert.deepEqual((await request("member", "GET", "/v1/me/notifications")).json().notifications, [{ id: inbox[0].id, available: false }]);
  assert.equal((await request("member", "PUT", `/v1/me/notifications/${inbox[0].id}/read`, {})).statusCode, 200);
  const readAt = db.prepare("SELECT read_at FROM community_notifications").get().read_at;
  await request("member", "PUT", `/v1/me/notifications/${inbox[0].id}/read`, {});
  assert.equal(db.prepare("SELECT read_at FROM community_notifications").get().read_at, readAt);
}));

test("subscriptions are explicit; unsubscribe, scope mute and author hiding stop new reminders", async () => fixture(async ({ db, request, annotation, reply }) => {
  annotation("public_thread");
  reply("before_subscribe", "public_thread");
  assert.equal(db.prepare("SELECT count(*) AS count FROM community_notifications").get().count, 0);
  await request("member", "PUT", "/v1/me/community-preferences", preference("literature", "literature_1"));
  db.transaction(() => recordSqliteCommunityReplyEvent(db, { replyId: "before_subscribe", annotationId: "public_thread", actorId: "writer" }))();
  assert.equal(db.prepare("SELECT count(*) AS count FROM community_notifications").get().count, 0);
  reply("subscribed", "public_thread");
  await request("member", "PUT", "/v1/me/community-preferences", preference("literature", "literature_1", { subscribed: false }));
  reply("after_unsubscribe", "public_thread");
  assert.equal(db.prepare("SELECT count(*) AS count FROM community_notifications").get().count, 1);
  await request("member", "PUT", "/v1/me/community-preferences", preference("literature", "literature_1"));
  await request("member", "PUT", "/v1/me/community-preferences", preference("thread", "public_thread"));
  await request("member", "PUT", "/v1/me/community-preferences", preference("author", "writer", { subscribed: false, blocked: true }));
  reply("hidden_author", "public_thread");
  await request("member", "PUT", "/v1/me/community-preferences", preference("author", "writer", { subscribed: false, blocked: false }));
  await request("member", "PUT", "/v1/me/community-preferences", preference("thread", "public_thread", { muted: true }));
  reply("muted_thread", "public_thread");
  assert.equal(db.prepare("SELECT count(*) AS count FROM community_notifications").get().count, 1);
  assert.equal((await request("member", "PUT", "/v1/me/community-preferences", preference("thread", "public_thread", { blocked: true }))).statusCode, 400);
}));

test("reply and notification writes roll back together", async () => fixture(async ({ db, request, annotation, reply }) => {
  annotation("rollback_thread");
  await request("member", "PUT", "/v1/me/community-preferences", preference("thread", "rollback_thread"));
  assert.throws(() => db.transaction(() => { reply("rollback_reply", "rollback_thread"); throw new Error("synthetic rollback"); })(), /synthetic rollback/);
  assert.equal(db.prepare("SELECT count(*) AS count FROM community_notification_events").get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM community_notifications").get().count, 0);
  assert.equal(db.prepare("SELECT count(*) AS count FROM annotation_replies_v2").get().count, 0);
}));

test("an explicit scope unsubscribe suppresses overlapping broader subscriptions", async () => fixture(async ({ db, request, annotation, reply }) => {
  annotation("overlap", "organization");
  await request("member", "PUT", "/v1/me/community-preferences", preference("organization", "org"));
  await request("member", "PUT", "/v1/me/community-preferences", preference("thread", "overlap"));
  reply("before_optout", "overlap");
  await request("member", "PUT", "/v1/me/community-preferences", preference("thread", "overlap", { subscribed: false }));
  reply("after_optout", "overlap");
  assert.equal(db.prepare("SELECT count(*) AS count FROM community_notifications").get().count, 1);
}));
