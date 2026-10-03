import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresCommunityGovernanceRepository, recordPostgresCommunityReplyEvent, deletePostgresCommunityGovernanceForAccount } from "../src/communityGovernanceRepository.mjs";
import { PostgresAccountLifecycleRepository } from "../src/accountLifecycleRepository.mjs";

async function waitForLock(pool, pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await pool.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [pid]);
    if (result.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("community_governance_expected_row_lock_not_observed");
}

async function insertSyntheticReply(client, annotationId, actorId) {
  const replyId = `reply_governance_fence_${randomUUID()}`;
  await client.query("INSERT INTO annotation_replies(id, parent_annotation_id, body, author_id, author_name, author_initials, author_profile_snapshot, visibility, revision) VALUES ($1, $2, 'Synthetic fanout race', $3, 'Synthetic author', 'SA', '{}'::jsonb, 'public', 1)", [replyId, annotationId, actorId]);
  return { replyId, annotationId, actorId };
}

async function verifyFanoutDeletionFence({ pool, governance, annotationId, actorId }) {
  const replyClient = await pool.connect();
  const deletionClient = await pool.connect();
  const replyPid = (await replyClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const deletionPid = (await deletionClient.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  const deletionInput = (subjectId) => ({ subjectId, requestedBy: "synthetic-admin", idempotencyKey: `delete:${subjectId}`, traceId: `trace:${subjectId}`, reason: "Synthetic subscription and deletion concurrency verification." });
  const newPreference = (id) => governance.setPreference({ id }, { targetKind: "thread", targetId: annotationId, subscribed: true, muted: false, blocked: false });
  let releaseDeletion = () => {};
  let pendingDeletion;
  let pendingFanout;
  try {
    // Fanout first: its subscription row lock forces account deletion to wait;
    // deletion then removes the newly committed notification before it completes.
    const first = `governance-fanout-first-${randomUUID()}`;
    await newPreference(first);
    await replyClient.query("BEGIN");
    const firstReply = await insertSyntheticReply(replyClient, annotationId, actorId);
    await recordPostgresCommunityReplyEvent(replyClient, firstReply);
    const lifecycle = new PostgresAccountLifecycleRepository({ connect: async () => ({ query: deletionClient.query.bind(deletionClient), release() {} }) });
    pendingDeletion = lifecycle.deleteAccount(deletionInput(first));
    await waitForLock(pool, deletionPid);
    await replyClient.query("COMMIT");
    await pendingDeletion;
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM community_notifications WHERE recipient_id = $1", [first])).rows[0].count, 0);
    await assert.rejects(newPreference(first), (error) => error.code === "ACCOUNT_DELETED");

    // Deletion first: pause the real lifecycle after it locks/deletes preferences.
    // A concurrent fanout must wait and re-evaluate the now-removed subscription.
    const second = `governance-deletion-first-${randomUUID()}`;
    await newPreference(second);
    let signalDeletionHeld;
    const deletionHeld = new Promise((resolve) => { signalDeletionHeld = resolve; });
    const deletionGate = new Promise((resolve) => { releaseDeletion = resolve; });
    const gatedLifecycle = new PostgresAccountLifecycleRepository({ connect: async () => ({
      async query(sql, values) {
        const result = await deletionClient.query(sql, values);
        if (sql.startsWith("DELETE FROM community_notifications WHERE recipient_id")) { signalDeletionHeld(); await deletionGate; }
        return result;
      }, release() {}
    }) });
    pendingDeletion = gatedLifecycle.deleteAccount(deletionInput(second));
    await Promise.race([deletionHeld, pendingDeletion.then(() => { throw new Error("account_lifecycle_governance_cleanup_not_wired"); })]);
    await replyClient.query("BEGIN");
    const secondReply = await insertSyntheticReply(replyClient, annotationId, actorId);
    pendingFanout = recordPostgresCommunityReplyEvent(replyClient, secondReply);
    await waitForLock(pool, replyPid);
    releaseDeletion();
    await pendingDeletion;
    await pendingFanout;
    await replyClient.query("COMMIT");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM community_notifications WHERE recipient_id = $1", [second])).rows[0].count, 0);
    await assert.rejects(newPreference(second), (error) => error.code === "ACCOUNT_DELETED");
    await assert.rejects(governance.markRead({ id: second }, "opaque-deleted-notification"), (error) => error.code === "ACCOUNT_DELETED");
  } finally {
    releaseDeletion();
    await replyClient.query("ROLLBACK");
    await Promise.allSettled([pendingDeletion, pendingFanout].filter(Boolean));
    await deletionClient.query("ROLLBACK");
    replyClient.release(); deletionClient.release();
  }
}

// Called only by the guarded, disposable PostgreSQL integration harness. No
// network delivery exists: all events remain inside that synthetic database.
export async function verifyCommunityGovernance({ pool, annotationRepository, author, subscriber, literatureId }) {
  const governance = new PostgresCommunityGovernanceRepository(pool, { annotationRepository });
  const target = await annotationRepository.createAnnotation(author, {
    body: "Synthetic notification and governance verification material.",
    visibility: "public", shareToPlaza: false, organizationId: null, tags: [],
    targets: [{ kind: "whole_document", literature: { literatureId } }]
  });
  const subscription = { targetKind: "thread", targetId: target.id, subscribed: true, muted: false, blocked: false };
  await governance.setPreference(subscriber, subscription);
  const contribution = await annotationRepository.createReply(target.id, author, {
    body: "Synthetic reply event; do not deliver outside this database.",
    publishAsAnnotation: false, targets: [], tags: [],
    expectedParent: { revision: target.revision, visibility: "public" }
  });
  // The integration entry point must wire the transaction hook in createReply.
  const inbox = await governance.notifications(subscriber);
  assert.equal(inbox.filter((item) => item.available && item.target.annotationId === target.id).length, 1);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await recordPostgresCommunityReplyEvent(client, { replyId: contribution.reply.id, annotationId: target.id, actorId: author.id });
    await client.query("COMMIT");
    const duplicate = await pool.query("SELECT count(*)::int AS count FROM community_notifications WHERE event_id = $1 AND recipient_id = $2", [`reply:${contribution.reply.id}`, subscriber.id]);
    assert.equal(duplicate.rows[0].count, 1);
    const notification = inbox.find((item) => item.available && item.target.annotationId === target.id);
    await governance.markRead(subscriber, notification.id);
    await assert.rejects(governance.markRead(author, notification.id), (error) => error.code === "NOTIFICATION_NOT_FOUND");
    await governance.setPreference(subscriber, { ...subscription, subscribed: false });
    const later = await annotationRepository.createReply(target.id, author, { body: "After explicit unsubscribe.", publishAsAnnotation: false, targets: [], tags: [] });
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM community_notifications WHERE event_id = $1 AND recipient_id = $2", [`reply:${later.reply.id}`, subscriber.id])).rows[0].count, 0);

    const reportInput = { revision: target.revision, reason: "other", detail: "Synthetic evidence for a report review." };
    const [first, duplicateReport] = await Promise.all([governance.submitReport(subscriber, target.id, reportInput), governance.submitReport(subscriber, target.id, reportInput)]);
    assert.equal(first.id, duplicateReport.id);
    const reportReviews = await governance.reviewReports(author, { platformAdmin: true });
    assert.equal(reportReviews.find((item) => item.id === first.id)?.detail, reportInput.detail);
    assert.equal(Object.hasOwn(reportReviews.find((item) => item.id === first.id), "reporterId"), false);
    await governance.resolveReport(author, first.id, { status: "dismissed", reason: "insufficient_evidence" }, { platformAdmin: true });
    assert.equal((await governance.myReports(subscriber)).find((item) => item.id === first.id)?.status, "dismissed");
    const audit = await pool.query("SELECT * FROM community_report_audit WHERE report_id = $1", [first.id]);
    assert.equal(audit.rows.length, 2);
    assert.equal(JSON.stringify(audit.rows).includes(reportInput.detail), false);
    await assert.rejects(pool.query("UPDATE community_report_audit SET reason_code = 'other' WHERE report_id = $1", [first.id]), (error) => error.code === "55000");

    await governance.setPreference(subscriber, subscription);
    const rolledBackReply = `reply_governance_rollback_${randomUUID()}`;
    await client.query("BEGIN");
    await client.query("INSERT INTO annotation_replies(id, parent_annotation_id, body, author_id, author_name, author_initials, author_profile_snapshot, visibility, revision) VALUES ($1, $2, 'Synthetic rollback', $3, 'Synthetic author', 'SA', '{}'::jsonb, 'public', 1)", [rolledBackReply, target.id, author.id]);
    await recordPostgresCommunityReplyEvent(client, { replyId: rolledBackReply, annotationId: target.id, actorId: author.id });
    await client.query("ROLLBACK");
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM community_notification_events WHERE id = $1", [`reply:${rolledBackReply}`])).rows[0].count, 0);

    await verifyFanoutDeletionFence({ pool, governance, annotationId: target.id, actorId: author.id });

    // Withdrawal makes existing notifications unavailable without revealing the
    // target, its title/body, or an annotation link; the owner can still mark read.
    await annotationRepository.withdraw(target.id, author);
    assert.deepEqual((await governance.notifications(subscriber)).find((item) => item.id === notification.id), { id: notification.id, available: false });
    await governance.markRead(subscriber, notification.id);

    // Exercise lifecycle cleanup inside a rolled back transaction, preserving the
    // harness's later whole-account deletion assertions and audit history.
    await client.query("BEGIN");
    await deletePostgresCommunityGovernanceForAccount(client, subscriber.id);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM community_preferences WHERE user_id = $1", [subscriber.id])).rows[0].count, 0);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM community_notifications WHERE recipient_id = $1", [subscriber.id])).rows[0].count, 0);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM community_reports WHERE reporter_id = $1", [subscriber.id])).rows[0].count, 0);
    await client.query("ROLLBACK");
  } finally { await client.query("ROLLBACK"); client.release(); }
  return { eventDedupe: true, unsubscribe: true, reportDedupe: true, privateInbox: true, rollback: true, accountCleanup: true, fanoutDeletionRowLocks: true };
}
