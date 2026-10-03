import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
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
