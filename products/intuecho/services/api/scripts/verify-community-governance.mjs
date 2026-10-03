import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresCommunityGovernanceRepository, recordPostgresCommunityReplyEvent, deletePostgresCommunityGovernanceForAccount } from "../src/communityGovernanceRepository.mjs";

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
  return { eventDedupe: true, unsubscribe: true, reportDedupe: true, privateInbox: true, rollback: true, accountCleanup: true };
}
