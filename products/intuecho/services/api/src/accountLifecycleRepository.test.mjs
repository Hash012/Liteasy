import assert from "node:assert/strict";
import test from "node:test";
import { PostgresAccountLifecycleRepository } from "./accountLifecycleRepository.mjs";

function harness({ prior } = {}) {
  const calls = [];
  const completedAt = new Date("2026-08-07T00:00:00.000Z");
  const client = {
    async query(sql, values) {
      const normalized = sql.trim();
      calls.push({ sql: normalized, values });
      if (new Set(["BEGIN ISOLATION LEVEL READ COMMITTED", "COMMIT", "ROLLBACK"]).has(normalized)) {
        return { rowCount: 0, rows: [] };
      }
      if (normalized.includes("SELECT * FROM account_deletion_jobs")) {
        return { rows: prior ? [prior] : [] };
      }
      if (normalized.includes("WITH RECURSIVE deletion_tree")) {
        return { rows: [{ depth: 1, id: "annotation-child" }, { depth: 0, id: "annotation-root" }] };
      }
      if (normalized.includes("INSERT INTO account_deletion_jobs")) {
        return { rows: [{
          completed_at: completedAt,
          operation_id: values[1],
          request_hash: values[5],
          result: JSON.parse(values[6]),
          subject_id: values[0]
        }] };
      }
      if (normalized.startsWith("DELETE FROM drafts")) return { rowCount: 2, rows: [] };
      if (normalized.includes("DELETE FROM topic_follows")) return { rowCount: 1, rows: [{ id: "topic_1" }] };
      if (normalized.includes("DELETE FROM post_signals")) return { rowCount: 1, rows: [{ id: "post_1" }] };
      if (normalized.startsWith("UPDATE posts") && normalized.includes("author_id")) return { rowCount: 3, rows: [] };
      if (normalized.startsWith("UPDATE comments")) return { rowCount: 4, rows: [] };
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };
  return { calls, pool: { async connect() { return client; } } };
}

const input = {
  idempotencyKey: "delete-user-0001:intuecho",
  reason: "Approved account deletion",
  requestedBy: "admin_1",
  subjectId: "user_1",
  traceId: "trace_1"
};

test("deletes private forum state and anonymizes public authors in one transaction", async () => {
  const instance = harness();
  const result = await new PostgresAccountLifecycleRepository(instance.pool).deleteAccount(input);
  assert.equal(result.result.deletedDrafts, 2);
  assert.equal(result.result.anonymizedPosts, 3);
  assert.equal(result.result.anonymizedComments, 4);
  assert.equal(result.result.anonymizedAnnotationVersions, 1);
  assert.equal(result.result.anonymizedReplyVersions, 1);
  assert.equal(result.result.deletedCommunityAnnotations, 1);
  assert.equal(result.result.deletedNonPublicAnnotations, 2);
  assert.equal(result.result.deletedDesktopDraftHandoffs, 1);
  assert.equal(result.result.deletedAnnotationPublications, 1);
  assert.equal(instance.calls.some((call) => call.sql.includes("author_name = '已注销用户'")), true);
  assert.equal(instance.calls.some((call) => call.sql.startsWith("UPDATE annotation_versions SET changed_by")), true);
  assert.equal(instance.calls.some((call) => call.sql.startsWith("UPDATE annotation_reply_versions SET changed_by")), true);
  assert.equal(instance.calls.some((call) =>
    call.sql.includes("DELETE FROM topic_follows") && call.sql.includes("user_id <> $1")
  ), true);
  assert.equal(instance.calls.some((call) =>
    call.sql.includes("DELETE FROM post_signals") && call.sql.includes("user_id <> $1")
  ), true);
  assert.equal(instance.calls.some((call) => call.sql.includes("INSERT INTO account_lifecycle_audit")), true);
  assert.equal(instance.calls.some((call) => call.sql.startsWith("DELETE FROM community_annotations")), true);
  assert.equal(instance.calls.some((call) => call.sql.startsWith("DELETE FROM desktop_draft_handoffs")), true);
  assert.equal(instance.calls.some((call) => call.sql.startsWith("DELETE FROM desktop_annotation_publications")), true);
  assert.equal(
    instance.calls.find((call) => call.sql.includes("WITH RECURSIVE deletion_tree")).sql.includes("annotation_replies"),
    true
  );
  assert.deepEqual(
    instance.calls.filter((call) => call.sql === "DELETE FROM annotations WHERE id = $1").map((call) => call.values[0]),
    ["annotation-child", "annotation-root"]
  );
  const appealDeletionIndex = instance.calls.findIndex((call) =>
    call.sql.startsWith("DELETE FROM annotation_tag_appeals")
  );
  const annotationDeletionIndex = instance.calls.findIndex((call) =>
    call.sql === "DELETE FROM annotations WHERE id = $1"
  );
  assert.equal(appealDeletionIndex < annotationDeletionIndex, true);
  assert.equal(instance.calls.at(-1).sql, "COMMIT");
});

test("replays a completed account deletion without touching forum content", async () => {
  const first = harness();
  const completed = await new PostgresAccountLifecycleRepository(first.pool).deleteAccount(input);
  const prior = {
    completed_at: new Date(completed.completedAt),
    operation_id: completed.operationId,
    request_hash: first.calls.find((call) => call.sql.includes("INSERT INTO account_deletion_jobs")).values[5],
    result: completed.result,
    subject_id: completed.subjectId
  };
  const replay = harness({ prior });
  const result = await new PostgresAccountLifecycleRepository(replay.pool).deleteAccount(input);
  assert.equal(result.replayed, true);
  assert.equal(replay.calls.some((call) => call.sql.startsWith("DELETE FROM drafts")), false);
});

test("rejects a different operation key for an already deleted subject", async () => {
  const first = harness();
  const completed = await new PostgresAccountLifecycleRepository(first.pool).deleteAccount(input);
  const prior = {
    completed_at: new Date(completed.completedAt),
    operation_id: completed.operationId,
    request_hash: first.calls.find((call) => call.sql.includes("INSERT INTO account_deletion_jobs")).values[5],
    result: completed.result,
    subject_id: completed.subjectId
  };
  const replay = harness({ prior });
  await assert.rejects(() => new PostgresAccountLifecycleRepository(replay.pool).deleteAccount({
    ...input,
    idempotencyKey: "delete-user-0002:intuecho"
  }), /IDEMPOTENCY_KEY_REUSED/);
  assert.equal(replay.calls.at(-1).sql, "ROLLBACK");
});
