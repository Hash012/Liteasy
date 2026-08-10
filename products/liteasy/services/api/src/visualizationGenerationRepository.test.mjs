import assert from "node:assert/strict";
import test from "node:test";
import { PostgresVisualizationGenerationRepository } from "./visualizationGenerationRepository.mjs";

const now = new Date("2026-08-10T00:00:00.000Z");
const requestInput = {
  artifactId: "artifact_1",
  artifactRevision: 2,
  intentHash: "a".repeat(64),
  nodeId: "node_1",
  requestId: "request_1",
  requestedArtifactCount: 1,
  traceId: "trace_1"
};

function requestRow(overrides = {}) {
  return {
    artifact_id: "artifact_1",
    artifact_revision: "2",
    attempts: 0,
    cancellation_hash: null,
    cancellation_idempotency_key: null,
    cancellation_requested_at: null,
    created_at: now,
    intent_hash: "a".repeat(64),
    lease_expires_at: null,
    lease_owner: null,
    node_id: "node_1",
    request_hash: "b".repeat(64),
    request_id: "request_1",
    requested_artifact_count: 1,
    result_artifact_ids: [],
    state: "queued",
    subject_id: "user_1",
    terminal_reason: null,
    trace_id: "trace_1",
    updated_at: now,
    ...overrides
  };
}

function queuedPool(results) {
  const calls = [];
  const queue = [...results];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push({ sql: normalized, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(normalized)) return { rows: [] };
      if (normalized.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next ?? { rows: [] };
    },
    release() {}
  };
  return {
    calls,
    pool: {
      async connect() { return client; },
      async query(sql, values) { return client.query(sql, values); }
    }
  };
}

test("creates and replays one subject-bound request", async () => {
  let stored;
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push({ sql: normalized, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(normalized)) return { rows: [] };
      if (normalized.startsWith("INSERT INTO visualization_generation_requests")) {
        if (stored) return { rows: [] };
        stored = requestRow({ request_hash: values[5] });
        return { rows: [stored] };
      }
      if (normalized.includes("FROM visualization_generation_requests")) return { rows: stored ? [stored] : [] };
      return { rows: [] };
    },
    release() {}
  };
  const repository = new PostgresVisualizationGenerationRepository({
    async connect() { return client; },
    async query(sql, values) { return client.query(sql, values); }
  }, { now: () => now });

  const first = await repository.create("user_1", requestInput);
  const replay = await repository.create("user_1", requestInput);
  assert.deepEqual(replay, first);
  await assert.rejects(
    () => repository.create("user_1", { ...requestInput, nodeId: "other_node" }),
    /visualization_request_id_reused/
  );
  assert.equal(calls.some(({ sql }) => sql.includes("ON CONFLICT (subject_id, request_id) DO NOTHING")), true);
  assert.equal(calls.some(({ sql }) => sql.includes("FOR UPDATE")), true);
});

test("a cancellation wins before a late success", async () => {
  const running = requestRow({ state: "running", attempts: 1, lease_owner: "worker_1", lease_expires_at: new Date(now.getTime() + 30_000) });
  const cancelled = requestRow({
    ...running,
    cancellation_hash: "c".repeat(64),
    cancellation_idempotency_key: "cancel-key-0001",
    cancellation_requested_at: now,
    state: "cancel_requested",
    updated_at: now
  });
  const harness = queuedPool([
    { rows: [running] },
    { rows: [] },
    { rows: [cancelled] },
    { rows: [cancelled] }
  ]);
  const repository = new PostgresVisualizationGenerationRepository(harness.pool, { now: () => now });

  const projection = await repository.requestCancel("user_1", "request_1", "cancel-key-0001");
  assert.equal(projection.status, "cancel_requested");
  await assert.rejects(
    () => repository.markSucceeded("user_1", "request_1", ["artifact_result_1"]),
    /visualization_request_cancelled/
  );
});

test("claims one queued request with a bounded lease", async () => {
  const queued = requestRow();
  const running = requestRow({
    attempts: 1,
    lease_expires_at: new Date(now.getTime() + 30_000),
    lease_owner: "worker_1",
    state: "running"
  });
  const harness = queuedPool([{ rows: [queued] }, { rows: [running] }]);
  const repository = new PostgresVisualizationGenerationRepository(harness.pool, { now: () => now });
  const claimed = await repository.claimNext("worker_1");

  assert.equal(claimed.state, "running");
  assert.equal(claimed.attempts, 1);
  assert.equal(claimed.leaseOwner, "worker_1");
  assert.equal(harness.calls.some(({ sql }) => sql.includes("FOR UPDATE SKIP LOCKED")), true);
});

test("recovers expired leases without replaying a terminal provider invocation", async () => {
  const retryable = requestRow({ request_id: "request_retry", state: "running", attempts: 1, has_terminal_invocation: false });
  const terminal = requestRow({ request_id: "request_terminal", state: "running", attempts: 1, has_terminal_invocation: true });
  const cancelling = requestRow({ request_id: "request_cancel", state: "cancel_requested", attempts: 1, has_terminal_invocation: false });
  const exhausted = requestRow({ request_id: "request_exhausted", state: "running", attempts: 3, has_terminal_invocation: false });
  const requeued = { ...retryable, state: "queued", lease_owner: null, lease_expires_at: null, updated_at: now };
  const failed = { ...terminal, state: "failed", terminal_reason: "provider_result_recovery_required", lease_owner: null, lease_expires_at: null, updated_at: now };
  const cancelled = { ...cancelling, state: "cancelled", terminal_reason: "cancelled", lease_owner: null, lease_expires_at: null, updated_at: now };
  const exhaustedFailure = { ...exhausted, state: "failed", terminal_reason: "internal_failure", lease_owner: null, lease_expires_at: null, updated_at: now };
  const harness = queuedPool([
    { rows: [retryable, terminal, cancelling, exhausted] },
    { rows: [requeued] },
    { rows: [failed] },
    { rows: [cancelled] },
    { rows: [exhaustedFailure] }
  ]);
  const repository = new PostgresVisualizationGenerationRepository(harness.pool, { now: () => now });

  assert.deepEqual(await repository.requeueExpired(), {
    cancelledRequestIds: ["request_cancel"],
    failedRequestIds: ["request_terminal", "request_exhausted"],
    requeuedRequestIds: ["request_retry"]
  });
});

test("terminal request states are immutable", async () => {
  const succeeded = requestRow({ state: "succeeded", result_artifact_ids: ["artifact_result_1"] });
  const harness = queuedPool([{ rows: [succeeded] }]);
  const repository = new PostgresVisualizationGenerationRepository(harness.pool, { now: () => now });
  await assert.rejects(
    () => repository.markTerminal("user_1", "request_1", "failed", "internal_failure"),
    /visualization_request_terminal/
  );
});
