import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { SqliteAnnotationCommunityRepository } from "./annotationCommunitySqlite.mjs";
import { createIntuechoApp } from "./server.mjs";

test("the application mounts governance and generates inbox events inside real reply transactions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intuecho-governance-integration-"));
  const { app, db } = await createIntuechoApp({
    databasePath: join(directory, "synthetic.db"),
    identityVerifier: async (token) => ({ id: token, name: "Synthetic researcher", initials: "SR" })
  });
  const request = (user, method, url, payload) => app.inject({ headers: { authorization: `Bearer ${user}` }, method, url, payload });
  try {
    db.prepare("INSERT INTO annotations_v2(id, body, author_id, author_name, author_initials, author_profile_snapshot_json, visibility, organization_id, share_to_plaza, revision, created_at, updated_at) VALUES ('governance-parent', 'Synthetic discussion.', 'author', 'Synthetic author', 'SA', '{}', 'public', NULL, 0, 1, ?, ?)").run("2026-10-03T12:00:00.000Z", "2026-10-03T12:00:00.000Z");
    const subscribed = await request("reader", "PUT", "/v1/me/community-preferences", { targetKind: "thread", targetId: "governance-parent", subscribed: true, muted: false, blocked: false });
    assert.equal(subscribed.statusCode, 200, subscribed.body);
    const reply = await request("author", "POST", "/v1/annotations/governance-parent/replies", {
      body: "A synthetic reply entered through the actual application route.", publishAsAnnotation: false, targets: [], tags: [],
      expectedParent: { revision: 1, visibility: "public" }
    });
    assert.equal(reply.statusCode, 201, reply.body);
    const inbox = await request("reader", "GET", "/v1/me/notifications");
    assert.equal(inbox.statusCode, 200, inbox.body);
    assert.equal(inbox.json().notifications.length, 1);
    const notification = inbox.json().notifications[0];
    assert.deepEqual(notification.target, { annotationId: "governance-parent", revision: 1 });
    assert.equal((await request("reader", "PUT", `/v1/me/notifications/${notification.id}/read`, {})).statusCode, 200);
    const reported = await request("reader", "POST", "/v1/annotations/governance-parent/reports", { revision: 1, reason: "other", detail: "A synthetic, specific concern for review." });
    assert.equal(reported.statusCode, 201, reported.body);
    assert.equal((await request("reader", "GET", "/v1/me/reports")).json().reports.length, 1);
    assert.equal((await request("reader", "GET", "/v1/community-reports")).json().reports.length, 0);
    await request("reader", "PUT", "/v1/me/community-preferences", { targetKind: "thread", targetId: "governance-parent", subscribed: false, muted: false, blocked: false });
    await request("author", "POST", "/v1/annotations/governance-parent/replies", { body: "A later reply after unsubscribing.", publishAsAnnotation: false, targets: [], tags: [] });
    assert.equal((await request("reader", "GET", "/v1/me/notifications")).json().notifications.length, 1);
  } finally {
    await app.close(); db.close(); await rm(directory, { recursive: true, force: true });
  }
});


test("real routes preserve explicit task and mention intent and deliver an authorized governance result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "intuecho-structured-event-routes-"));
  const access = async () => ({ allowed: true, role: "admin" });
  const { app, db } = await createIntuechoApp({
    databasePath: join(directory, "synthetic.db"),
    identityVerifier: async (token) => ({ id: token, name: "Synthetic researcher", initials: "SR" }),
    authorizeOrganizationAccess: access, authorizeOrganizationVisibility: async () => true
  });
  const request = (user, method, url, payload) => app.inject({ headers: { authorization: `Bearer ${user}` }, method, url, payload });
  try {
    const annotations = new SqliteAnnotationCommunityRepository(db, { authorizeOrganizationAccess: access, authorizeOrganizationVisibility: async () => true });
    const literature = await annotations.confirmRefetchedLiterature({ id: "host", name: "Synthetic host", initials: "SH" }, { candidateKey: "crossref:doi:10.1000/structured-route", provider: "crossref", record: { authors: ["Synthetic Author"], title: "Synthetic route material", identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/structured-route" }], documentType: "journal_article", year: 2026 } });
    assert.equal((await request("reader", "PUT", "/v1/me/community-preferences", { targetKind: "organization", targetId: "synthetic-org", subscribed: true, muted: false, blocked: false })).statusCode, 200);
    const input = { body: "Synthetic task through the actual HTTP contract", visibility: "organization", organizationId: "synthetic-org", notificationIntent: "reading_task", shareToPlaza: false, tags: ["读书包"], targets: [{ kind: "whole_document", literature: { literatureId: literature.literatureId } }] };
    const created = await request("host", "POST", "/v1/annotations", input);
    assert.equal(created.statusCode, 201, created.body);
    const parent = created.json().annotation;
    assert.equal((await request("reader", "GET", "/v1/me/notifications")).json().notifications[0].kind, "reading_task");
    const invalidTask = await request("host", "POST", "/v1/annotations", { ...input, visibility: "public", organizationId: undefined });
    assert.equal(invalidTask.statusCode, 400, invalidTask.body);
    assert.equal((await request("host", "PUT", "/v1/me/community-preferences", { targetKind: "thread", targetId: parent.id, subscribed: true, muted: false, blocked: false })).statusCode, 200);
    const replyInput = { body: "A deliberate participant mention", publishAsAnnotation: false, tags: [], targets: [], mentionedUserIds: ["host"], expectedParent: { revision: parent.revision, visibility: "organization", organizationId: "synthetic-org" } };
    const reply = await request("reader", "POST", `/v1/annotations/${parent.id}/replies`, replyInput);
    assert.equal(reply.statusCode, 201, reply.body);
    assert.equal((await request("host", "GET", "/v1/me/notifications")).json().notifications[0].kind, "mention");
    assert.equal((await request("reader", "POST", `/v1/annotations/${parent.id}/replies`, { ...replyInput, mentionedUserIds: ["a", "b", "c", "d", "e", "f"] })).statusCode, 400);
    const report = await request("reader", "POST", `/v1/annotations/${parent.id}/reports`, { revision: parent.revision, reason: "other", detail: "Synthetic concern for the authorized organization reviewer." });
    assert.equal(report.statusCode, 201, report.body);
    const resolved = await request("reviewer", "POST", `/v1/community-reports/${report.json().report.id}/resolve`, { status: "resolved", reason: "reviewed" });
    assert.equal(resolved.statusCode, 200, resolved.body);
    const results = (await request("reader", "GET", "/v1/me/notifications")).json().notifications;
    assert.equal(results.find((item) => item.kind === "report_result").target.reportId, report.json().report.id);
  } finally { await app.close(); db.close(); await rm(directory, { recursive: true, force: true }); }
});
