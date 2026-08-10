import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createVisualizationTestPool, cleanupVisualizationTestSubject } from "./testSupport/visualizationTestPool.mjs";
import { PostgresVisualizationRepository } from "./visualizationRepository.mjs";

const connectionString = process.env.LITEASY_TEST_DATABASE_URL;

function reservation(idempotencyKey, routeId, suffix) {
  return {
    idempotencyKey,
    modality: "semantic_graph",
    routeId,
    traceId: `trace-reservation-${suffix}`
  };
}

async function auditCount(pool, action, resourceId) {
  const result = await pool.query(
    "SELECT count(*)::integer AS count FROM audit_events WHERE action = $1 AND resource_id = $2",
    [action, resourceId]
  );
  return result.rows[0].count;
}

async function cleanupMutableVisualizationState(pool, { adminId, routeId, subjectId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await cleanupVisualizationTestSubject(client, subjectId);
    await client.query("DELETE FROM visualization_provider_configs WHERE route_id = $1", [routeId]);
    await client.query(
      "DELETE FROM idempotency_records WHERE actor_id = ANY($1::text[])",
      [[adminId, subjectId]]
    );
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve cleanup failure */ }
    throw error;
  } finally {
    client.release();
  }
}

async function insertWindowFixtures(pool, subjectId, suffix) {
  await pool.query(`
    WITH boundaries AS (
      SELECT date_trunc('day', now(), 'Asia/Shanghai') AS day_start,
             date_trunc('month', now(), 'Asia/Shanghai') AS month_start
    )
    INSERT INTO visualization_usage_ledger(
      event_id, subject_id, idempotency_key, event_type, units_delta, trace_id, created_at
    )
    SELECT * FROM (
      SELECT $1, $2, $3, 'adjustment', 7, $4, day_start - interval '1 second' FROM boundaries
      UNION ALL
      SELECT $5, $2, $6, 'adjustment', 2, $4, day_start + interval '1 second' FROM boundaries
      UNION ALL
      SELECT $7, $2, $8, 'adjustment', -1, $4, day_start + interval '2 seconds' FROM boundaries
      UNION ALL
      SELECT $9, $2, $10, 'adjustment', 11, $4, month_start - interval '1 second' FROM boundaries
      UNION ALL
      SELECT $11, $2, $12, 'adjustment', 3, $4, month_start + interval '1 second' FROM boundaries
    ) fixtures
  `, [
    `vusage-window-day-before-${suffix}`, subjectId, `window-day-before-${suffix}`, `trace-window-${suffix}`,
    `vusage-window-day-after-positive-${suffix}`, `window-day-after-positive-${suffix}`,
    `vusage-window-day-after-negative-${suffix}`, `window-day-after-negative-${suffix}`,
    `vusage-window-month-before-${suffix}`, `window-month-before-${suffix}`,
    `vusage-window-month-after-${suffix}`, `window-month-after-${suffix}`
  ]);
}

async function verifyGovernanceTransactions(pool) {
  const suffix = randomUUID();
  const adminId = `viz-governance-admin-${suffix}`;
  const subjectId = `viz-governance-subject-${suffix}`;
  const routeId = `viz-governance-route-${suffix}`;
  const repository = new PostgresVisualizationRepository(pool);
  const routeInput = {
    expectedRevision: 0,
    idempotencyKey: `provider-save-${suffix}`,
    reason: "Approved PostgreSQL integration route",
    route: {
      circuitFailures: 0,
      circuitOpenUntil: null,
      circuitState: "closed",
      dataClasses: ["paper"],
      enabled: true,
      endpoint: "https://visual.integration.example/v1",
      maxConcurrency: 1,
      modalities: ["semantic_graph"],
      model: "integration-visual-model",
      operations: ["structured_generation"],
      priority: 10,
      providerId: `viz-governance-provider-${suffix}`,
      region: "cn-east",
      revision: 1,
      routeId,
      secretRef: `viz-secret:integration-${suffix}`,
      timeoutMs: 30000
    },
    traceId: `trace-provider-${suffix}`,
    updatedBy: adminId
  };

  try {
    const entitlement = await repository.setEntitlement(subjectId, {
      allowed: true,
      allowedModalities: ["semantic_graph"],
      expectedRevision: 0,
      explicitRequestsAllowed: true,
      grantedBy: adminId,
      idempotencyKey: `entitlement-${suffix}`,
      reason: "Approved PostgreSQL integration entitlement",
      traceId: `trace-entitlement-${suffix}`
    });
    assert.deepEqual(entitlement.entitlement, {
      allowed: true,
      allowedModalities: ["semantic_graph"],
      explicitRequestsAllowed: true,
      revision: 1
    });

    const policy = await repository.setQuotaPolicy(subjectId, {
      dailyUnits: 2,
      expectedRevision: 0,
      idempotencyKey: `quota-policy-${suffix}`,
      maxConcurrency: 1,
      monthlyUnits: 4,
      reason: "Approved PostgreSQL integration quota",
      timezone: "Asia/Shanghai",
      traceId: `trace-quota-${suffix}`,
      updatedBy: adminId
    });
    assert.equal(policy.policy.revision, 1);
    assert.equal(policy.policy.timezone, "Asia/Shanghai");

    const savedRoute = await repository.saveProviderRoute(routeInput);
    assert.equal(savedRoute.route.revision, 1);
    assert.deepEqual(savedRoute.costPolicies.map((costPolicy) => ({
      dataClass: costPolicy.dataClass,
      modality: costPolicy.modality,
      operation: costPolicy.operation,
      providerId: costPolicy.providerId,
      revision: costPolicy.revision,
      unitCost: costPolicy.unitCost
    })), [{
      dataClass: "paper",
      modality: "semantic_graph",
      operation: "structured_generation",
      providerId: routeInput.route.providerId,
      revision: 1,
      unitCost: 1
    }]);
    assert.deepEqual(await repository.saveProviderRoute(routeInput), savedRoute);

    const quotaAuditBeforeConflict = await auditCount(pool, "visualization_quota_updated", subjectId);
    await assert.rejects(() => repository.setQuotaPolicy(subjectId, {
      ...policy.policy,
      dailyUnits: 2,
      expectedRevision: 0,
      idempotencyKey: `quota-policy-stale-${suffix}`,
      maxConcurrency: 1,
      monthlyUnits: 4,
      reason: "Rejected stale PostgreSQL integration quota",
      timezone: "Asia/Shanghai",
      traceId: `trace-quota-stale-${suffix}`,
      updatedBy: adminId
    }), /visualization_quota_revision_conflict/);
    assert.equal(await auditCount(pool, "visualization_quota_updated", subjectId), quotaAuditBeforeConflict);

    const results = await Promise.allSettled([
      repository.reserve(subjectId, reservation(`reserve-a-${suffix}`, routeId, suffix)),
      repository.reserve(subjectId, reservation(`reserve-b-${suffix}`, routeId, suffix))
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.match(results.find((result) => result.status === "rejected").reason.message, /visualization_concurrency_exceeded/);

    const successfulReservation = results.find((result) => result.status === "fulfilled").value.reservation;
    await repository.rollback(subjectId, {
      reasonCode: "integration_concurrency_release",
      reservationId: successfulReservation.reservationId,
      traceId: `trace-rollback-${suffix}`
    });
    const pinned = await repository.reserve(subjectId, reservation(`reserve-pinned-${suffix}`, routeId, suffix));
    assert.equal(pinned.reservation.routeId, routeId);
    assert.equal(pinned.reservation.routeRevision, 1);
    assert.equal(pinned.reservation.policyRevision, 1);
    assert.equal(pinned.reservation.costTableRevision, 1);
    await repository.rollback(subjectId, {
      reasonCode: "integration_window_release",
      reservationId: pinned.reservation.reservationId,
      traceId: `trace-window-rollback-${suffix}`
    });

    await insertWindowFixtures(pool, subjectId, suffix);
    const capability = await repository.capability(subjectId);
    assert.equal(capability.quota.dailyUsedUnits, 1);
    assert.equal(capability.quota.monthlyUsedUnits, 11);
  } finally {
    await cleanupMutableVisualizationState(pool, { adminId, routeId, subjectId });
  }
}

test("visualization governance is atomic in PostgreSQL", {
  skip: connectionString ? false : "LITEASY_TEST_DATABASE_URL is not configured"
}, async () => {
  const pool = createVisualizationTestPool({ connectionString, sslMode: "disable" });
  try {
    await verifyGovernanceTransactions(pool);
  } finally {
    await pool.end();
  }
});
