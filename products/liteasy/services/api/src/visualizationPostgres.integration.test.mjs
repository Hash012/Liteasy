import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { withPostgresTransaction } from "./postgres.mjs";
import { createVisualizationTestPool, cleanupVisualizationTestSubject } from "./testSupport/visualizationTestPool.mjs";
import { validateVisualizationArtifact } from "./visualizationArtifactValidator.mjs";
import { PostgresVisualizationRepository } from "./visualizationRepository.mjs";

const connectionString = process.env.LITEASY_TEST_DATABASE_URL;
const referenceTime = new Date("2026-08-10T04:00:00.000Z");

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

async function insertPublicationDocument(pool, subjectId, suffix) {
  const documentId = `viz-publication-document-${suffix}`;
  const sourceHash = createHash("sha256").update(`visualization-source-${suffix}`).digest("hex");
  const fileName = `visualization-${suffix}.pdf`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO storage_objects(
        content_hash, byte_length, storage_key, media_type, checksum_verified_at, status
      ) VALUES ($1, 16, $2, 'application/pdf', now(), 'available')
    `, [sourceHash, `objects/visualization-${suffix}.pdf`]);
    await client.query(`
      UPDATE storage_objects
         SET security_scanned_at = now(), security_scanner = 'integration',
             security_scanner_version = '1', security_scan_hash = content_hash
       WHERE content_hash = $1
    `, [sourceHash]);
    await client.query(`
      INSERT INTO library_entries(
        document_id, scope_type, scope_id, entry_kind, file_name, normalized_name,
        title, metadata, logical_bytes, availability, created_by
      ) VALUES ($1, 'user', $2, 'pdf', $3, $3, 'Visualization integration paper',
        '{}', 16, 'available', $2)
    `, [documentId, subjectId, fileName]);
    await client.query(`
      INSERT INTO storage_object_references(document_id, content_hash) VALUES ($1, $2)
    `, [documentId, sourceHash]);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve fixture failure */ }
    throw error;
  } finally {
    client.release();
  }
  return {
    access: { allowed: true, scopeId: subjectId, scopeType: "user", sourceIdentityHash: sourceHash },
    document: { documentId, sourceIdentityHash: sourceHash },
    sourceHash
  };
}

async function cleanupPublicationDocument(pool, documentId, sourceHash) {
  await pool.query("DELETE FROM library_entries WHERE document_id = $1", [documentId]);
  await pool.query("DELETE FROM storage_objects WHERE content_hash = $1", [sourceHash]);
}

function publicationArtifact(suffix, modality = "semantic_graph") {
  return {
    artifactId: `viz-publication-artifact-${suffix}`,
    body: { artifactVersion: "liteasy.visualization/v1", sourceIdentityHash: `source-${suffix}` },
    contentHash: null,
    evidenceHash: createHash("sha256").update(`evidence-${suffix}`).digest("hex"),
    modality,
    nodeId: `viz-publication-node-${suffix}`,
    specHash: createHash("sha256").update(`spec-${suffix}`).digest("hex"),
    state: "ready"
  };
}

function publicationValidation(artifact) {
  const validation = validateVisualizationArtifact({ artifact, modality: artifact.modality, phase: "publication" });
  assert.equal(validation.outcome, "pass", "publication fixture satisfies the production artifact validator");
  return validation;
}

async function publicationSnapshot(pool, subjectId, reservationId) {
  return withPostgresTransaction(pool, async (client) => {
    const result = await client.query(`
      SELECT reservation.reservation_id, reservation.reserved_units, reservation.settled_units,
             reservation.state, artifact.reservation_id AS artifact_reservation_id,
             artifact.artifact_id, usage.event_type, usage.units_delta
        FROM visualization_quota_reservations reservation
        LEFT JOIN visualization_artifacts artifact
          ON artifact.subject_id = reservation.subject_id
         AND artifact.reservation_id = reservation.reservation_id
        LEFT JOIN visualization_usage_ledger usage
          ON usage.subject_id = reservation.subject_id
         AND usage.reservation_id = reservation.reservation_id
         AND usage.event_type = 'settled'
       WHERE reservation.subject_id = $1 AND reservation.reservation_id = $2
    `, [subjectId, reservationId]);
    return result.rows;
  }, { isolation: "REPEATABLE READ" });
}

async function failedPublicationSnapshot(pool, subjectId, reservationId) {
  const result = await pool.query(`
    SELECT reservation.state,
           count(artifact.artifact_id)::integer AS artifact_count,
           count(usage.event_id) FILTER (WHERE usage.event_type = 'settled')::integer AS settlement_count
      FROM visualization_quota_reservations reservation
      LEFT JOIN visualization_artifacts artifact
        ON artifact.subject_id = reservation.subject_id
       AND artifact.reservation_id = reservation.reservation_id
      LEFT JOIN visualization_usage_ledger usage
        ON usage.subject_id = reservation.subject_id
       AND usage.reservation_id = reservation.reservation_id
     WHERE reservation.subject_id = $1 AND reservation.reservation_id = $2
     GROUP BY reservation.state
  `, [subjectId, reservationId]);
  return result.rows[0];
}

async function expiryAccountingSnapshot(pool, subjectId, reservationId) {
  return withPostgresTransaction(pool, async (client) => {
    const reservationResult = await client.query(`
      SELECT state, settled_units
        FROM visualization_quota_reservations
       WHERE subject_id = $1 AND reservation_id = $2
    `, [subjectId, reservationId]);
    const ledgerResult = await client.query(`
      SELECT event_type, units_delta, reason_code
        FROM visualization_usage_ledger
       WHERE subject_id = $1 AND reservation_id = $2
       ORDER BY event_type
    `, [subjectId, reservationId]);
    return {
      ledger: ledgerResult.rows.map((row) => ({
        eventType: row.event_type,
        reasonCode: row.reason_code,
        unitsDelta: Number(row.units_delta)
      })),
      reservation: reservationResult.rows[0]
    };
  }, { isolation: "REPEATABLE READ" });
}

function providerCost(invocationId, providerRequestId, routeId, providerId, suffix) {
  return {
    amount: 0.02,
    currency: "USD",
    invocationId,
    metadata: { traceId: `trace-provider-cost-${suffix}` },
    providerId,
    providerRequestId,
    reasonCode: "provider_succeeded",
    routeId,
    units: 1
  };
}

async function insertWindowFixtures(pool, subjectId, suffix) {
  const fixtures = [
    ["day-before", 7, "2026-08-09T15:59:59.000Z"],
    ["day-after-positive", 2, "2026-08-09T16:00:01.000Z"],
    ["day-after-negative", -1, "2026-08-09T16:00:02.000Z"],
    ["month-before", 11, "2026-07-31T15:59:59.000Z"],
    ["month-after", 3, "2026-07-31T16:00:01.000Z"]
  ];
  for (const [name, unitsDelta, createdAt] of fixtures) {
    await pool.query(`
      INSERT INTO visualization_usage_ledger(
        event_id, subject_id, idempotency_key, event_type, units_delta, trace_id, created_at
      ) VALUES ($1,$2,$3,'adjustment',$4,$5,$6)
    `, [
      `vusage-window-${name}-${suffix}`,
      subjectId,
      `window-${name}-${suffix}`,
      unitsDelta,
      `trace-window-${suffix}`,
      new Date(createdAt)
    ]);
  }
}

async function waitForContendedAdvisoryLock(pool, lock) {
  for (let poll = 0; poll < 5000; poll += 1) {
    const result = await pool.query(`
      SELECT count(*)::integer AS waiting
        FROM pg_locks
       WHERE locktype = 'advisory' AND granted = false
         AND classid = $1 AND objid = $2 AND objsubid = $3
    `, [lock.classid, lock.objid, lock.objsubid]);
    if (result.rows[0].waiting === 2) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("visualization_advisory_lock_contention_not_observed");
}

async function reserveUnderProvenContention(pool, repository, subjectId, routeId, suffix) {
  const coordinator = await pool.connect();
  let locked = false;
  let requests = [];
  try {
    await coordinator.query("BEGIN");
    await coordinator.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`visualization-reserve:${subjectId}`]);
    locked = true;
    const lock = (await coordinator.query(`
      SELECT classid, objid, objsubid
        FROM pg_locks
       WHERE locktype = 'advisory' AND granted = true AND pid = pg_backend_pid()
    `)).rows[0];
    assert.ok(lock, "coordinator holds the subject advisory lock");
    requests = [
      repository.reserve(subjectId, reservation(`reserve-a-${suffix}`, routeId, suffix)),
      repository.reserve(subjectId, reservation(`reserve-b-${suffix}`, routeId, suffix))
    ];
    await waitForContendedAdvisoryLock(pool, lock);
    await coordinator.query("COMMIT");
    locked = false;
    return await Promise.allSettled(requests);
  } finally {
    if (locked) await coordinator.query("ROLLBACK");
    coordinator.release();
    if (locked && requests.length > 0) await Promise.allSettled(requests);
  }
}

async function verifyGovernanceTransactions(pool) {
  const suffix = randomUUID();
  const adminId = `viz-governance-admin-${suffix}`;
  const subjectId = `viz-governance-subject-${suffix}`;
  const routeId = `viz-governance-route-${suffix}`;
  let currentTime = referenceTime;
  const repository = new PostgresVisualizationRepository(pool, { now: () => currentTime });
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

    const results = await reserveUnderProvenContention(pool, repository, subjectId, routeId, suffix);
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

    const expiring = await repository.reserve(subjectId, {
      ...reservation(`reserve-expiring-${suffix}`, routeId, suffix),
      ttlMs: 1000
    });
    currentTime = new Date(referenceTime.getTime() + 1000);
    const afterExpiry = await repository.reserve(
      subjectId,
      reservation(`reserve-after-expiry-${suffix}`, routeId, suffix)
    );
    const expirySnapshot = await expiryAccountingSnapshot(
      pool,
      subjectId,
      expiring.reservation.reservationId
    );
    assert.deepEqual(expirySnapshot.reservation, { settled_units: 0, state: "expired" });
    assert.deepEqual(expirySnapshot.ledger, [
      { eventType: "expired", reasonCode: "reservation_expired", unitsDelta: -1 },
      { eventType: "reserved", reasonCode: null, unitsDelta: 1 }
    ]);
    assert.equal(
      expirySnapshot.ledger.reduce((total, event) => total + event.unitsDelta, 0),
      0,
      "expiry transition refunds all reserved units in the committed transaction"
    );
    await repository.rollback(subjectId, {
      reasonCode: "integration_expiry_replacement_release",
      reservationId: afterExpiry.reservation.reservationId,
      traceId: `trace-expiry-replacement-rollback-${suffix}`
    });

    await insertWindowFixtures(pool, subjectId, suffix);
    const capability = await repository.capability(subjectId);
    assert.equal(capability.quota.dailyUsedUnits, 1);
    assert.equal(capability.quota.monthlyUsedUnits, 11);
  } finally {
    await cleanupMutableVisualizationState(pool, { adminId, routeId, subjectId });
  }
}

async function verifyPublicationAndProviderAccountingTransactions(pool) {
  const suffix = randomUUID();
  const adminId = `viz-accounting-admin-${suffix}`;
  const subjectId = `viz-accounting-subject-${suffix}`;
  const routeId = `viz-accounting-route-${suffix}`;
  const providerId = `viz-accounting-provider-${suffix}`;
  const repository = new PostgresVisualizationRepository(pool);
  const routeInput = {
    expectedRevision: 0,
    idempotencyKey: `accounting-provider-save-${suffix}`,
    reason: "Approved PostgreSQL accounting route",
    route: {
      circuitFailures: 0,
      circuitOpenUntil: null,
      circuitState: "closed",
      dataClasses: ["paper"],
      enabled: true,
      endpoint: "https://visual.integration.example/v1",
      maxConcurrency: 1,
      modalities: ["semantic_graph"],
      model: "integration-accounting-model",
      operations: ["structured_generation"],
      priority: 10,
      providerId,
      region: "cn-east",
      revision: 1,
      routeId,
      secretRef: `viz-secret:accounting-${suffix}`,
      timeoutMs: 30000
    },
    traceId: `trace-accounting-provider-${suffix}`,
    updatedBy: adminId
  };
  let documentFixture;

  function publishInput(reserved, artifact, access = documentFixture.access, document = documentFixture.document) {
    return {
      access,
      artifact,
      document,
      reservationId: reserved.reservationId,
      routeId: reserved.routeId,
      routeRevision: reserved.routeRevision,
      traceId: `trace-publication-${suffix}`,
      validation: publicationValidation(artifact)
    };
  }

  async function reserveFor(label) {
    return (await repository.reserve(subjectId, reservation(`accounting-${label}-${suffix}`, routeId, suffix))).reservation;
  }

  async function assertRejectedPublication(label, configure) {
    const reserved = await reserveFor(label);
    const artifact = publicationArtifact(`${suffix}-${label}`);
    const input = publishInput(reserved, artifact);
    await configure({ artifact, input, reserved });
    await assert.rejects(() => repository.publish(subjectId, input));
    const snapshot = await failedPublicationSnapshot(pool, subjectId, reserved.reservationId);
    assert.equal(snapshot.state, "reserved", `${label} rejection does not settle the reservation`);
    assert.equal(snapshot.artifact_count, 0, `${label} rejection does not publish an artifact`);
    assert.equal(snapshot.settlement_count, 0, `${label} rejection does not append a settlement`);
    await repository.rollback(subjectId, {
      reasonCode: `publication_${label}_rejected`,
      reservationId: reserved.reservationId,
      traceId: `trace-publication-${label}-${suffix}`
    });
  }

  try {
    await repository.setEntitlement(subjectId, {
      allowed: true,
      allowedModalities: ["semantic_graph"],
      expectedRevision: 0,
      explicitRequestsAllowed: true,
      grantedBy: adminId,
      idempotencyKey: `accounting-entitlement-${suffix}`,
      reason: "Approved PostgreSQL accounting entitlement",
      traceId: `trace-accounting-entitlement-${suffix}`
    });
    await repository.setQuotaPolicy(subjectId, {
      dailyUnits: 20,
      expectedRevision: 0,
      idempotencyKey: `accounting-quota-${suffix}`,
      maxConcurrency: 1,
      monthlyUnits: 20,
      reason: "Approved PostgreSQL accounting quota",
      timezone: "Asia/Shanghai",
      traceId: `trace-accounting-quota-${suffix}`,
      updatedBy: adminId
    });
    await repository.saveProviderRoute(routeInput);
    documentFixture = await insertPublicationDocument(pool, subjectId, suffix);

    const settledReservation = await reserveFor("settlement");
    const settledArtifact = publicationArtifact(`${suffix}-settlement`);
    const published = await repository.publish(subjectId, publishInput(settledReservation, settledArtifact));
    assert.equal(published.replayed, false);
    const settlementSnapshot = await publicationSnapshot(pool, subjectId, settledReservation.reservationId);
    assert.equal(settlementSnapshot.length, 1);
    const [settlement] = settlementSnapshot;
    assert.equal(settlement.state, "settled");
    assert.equal(Number(settlement.settled_units), Number(settlement.reserved_units));
    assert.equal(settlement.artifact_reservation_id, settlement.reservation_id);
    assert.equal(settlement.event_type, "settled");
    assert.equal(Number(settlement.units_delta), 0);

    const replayedPublication = await repository.publish(subjectId, publishInput(settledReservation, settledArtifact));
    assert.equal(replayedPublication.replayed, true);
    assert.equal(replayedPublication.artifact.artifactId, published.artifact.artifactId);
    const publicationLedgerRows = await pool.query(`
      SELECT count(*)::integer AS count FROM visualization_usage_ledger
       WHERE subject_id = $1 AND reservation_id = $2 AND event_type = 'settled'
    `, [subjectId, settledReservation.reservationId]);
    assert.equal(publicationLedgerRows.rows[0].count, 1);

    await assertRejectedPublication("modality", async ({ artifact, input }) => {
      artifact.modality = "circuit";
      input.validation = publicationValidation(artifact);
    });
    await assertRejectedPublication("expired", async ({ reserved }) => {
      await pool.query("UPDATE visualization_quota_reservations SET expires_at = now() - interval '1 second' WHERE reservation_id = $1", [reserved.reservationId]);
    });
    await assertRejectedPublication("revoked", async () => {
      await pool.query("UPDATE visualization_entitlements SET allowed = false WHERE subject_id = $1", [subjectId]);
    });
    await pool.query("UPDATE visualization_entitlements SET allowed = true WHERE subject_id = $1", [subjectId]);
    await assertRejectedPublication("source", async ({ input }) => {
      input.access = { ...input.access, sourceIdentityHash: "f".repeat(64) };
    });

    const succeededReservation = await reserveFor("provider-succeeded");
    const succeededInvocationId = `viz-invocation-succeeded-${suffix}`;
    const succeededProviderRequestId = `viz-provider-request-succeeded-${suffix}`;
    await repository.startProviderInvocation({
      dataClass: "paper",
      idempotencyKey: `provider-invocation-succeeded-${suffix}`,
      invocationId: succeededInvocationId,
      modality: "semantic_graph",
      operation: "structured_generation",
      reservationId: succeededReservation.reservationId,
      routeId,
      routeRevision: 1,
      subjectId
    });
    const succeededCost = providerCost(succeededInvocationId, succeededProviderRequestId, routeId, providerId, suffix);
    const completion = {
      cost: succeededCost,
      invocationId: succeededInvocationId,
      providerRequestId: succeededProviderRequestId,
      providerUnits: 1,
      responseHash: createHash("sha256").update(`provider-response-${suffix}`).digest("hex"),
      state: "succeeded"
    };
    const concurrentFinalizations = await Promise.all([
      repository.finalizeProviderInvocation(completion),
      repository.finalizeProviderInvocation(completion)
    ]);
    assert.equal(concurrentFinalizations.filter((row) => row.state === "succeeded").length, 2);
    const succeededAccounting = await pool.query(`
      SELECT invocation.state,
             count(cost.cost_event_id)::integer AS provider_cost_rows
        FROM visualization_provider_invocations invocation
        LEFT JOIN visualization_provider_cost_ledger cost USING(invocation_id)
       WHERE invocation.invocation_id = $1
       GROUP BY invocation.state
    `, [succeededInvocationId]);
    assert.deepEqual(succeededAccounting.rows[0], { state: "succeeded", provider_cost_rows: 1 });
    await repository.finalizeProviderInvocation(completion);
    const replayCostRows = await pool.query(
      "SELECT count(*)::integer AS count FROM visualization_provider_cost_ledger WHERE invocation_id = $1",
      [succeededInvocationId]
    );
    assert.equal(replayCostRows.rows[0].count, 1);
    await repository.rollback(subjectId, {
      reasonCode: "provider_succeeded_test_release",
      reservationId: succeededReservation.reservationId,
      traceId: `trace-provider-succeeded-release-${suffix}`
    });

    const collisionReservation = await reserveFor("provider-collision");
    const collisionInvocationId = `viz-invocation-collision-${suffix}`;
    await repository.startProviderInvocation({
      dataClass: "paper",
      idempotencyKey: `provider-invocation-collision-${suffix}`,
      invocationId: collisionInvocationId,
      modality: "semantic_graph",
      operation: "structured_generation",
      reservationId: collisionReservation.reservationId,
      routeId,
      routeRevision: 1,
      subjectId
    });
    await assert.rejects(() => repository.finalizeProviderInvocation({
      cost: providerCost(collisionInvocationId, succeededProviderRequestId, routeId, providerId, `${suffix}-collision`),
      invocationId: collisionInvocationId,
      providerRequestId: succeededProviderRequestId,
      providerUnits: 1,
      responseHash: createHash("sha256").update(`provider-collision-${suffix}`).digest("hex"),
      state: "succeeded"
    }), /visualization_provider_request_id_conflict|duplicate key/);
    const collisionAccounting = await pool.query(`
      SELECT invocation.state,
             count(cost.cost_event_id)::integer AS provider_cost_rows
        FROM visualization_provider_invocations invocation
        LEFT JOIN visualization_provider_cost_ledger cost USING(invocation_id)
       WHERE invocation.invocation_id = $1
       GROUP BY invocation.state
    `, [collisionInvocationId]);
    assert.deepEqual(collisionAccounting.rows[0], { state: "started", provider_cost_rows: 0 });
    await repository.rollback(subjectId, {
      reasonCode: "provider_collision_test_release",
      reservationId: collisionReservation.reservationId,
      traceId: `trace-provider-collision-release-${suffix}`
    });

    const cancelledReservation = await reserveFor("provider-cancelled");
    const cancelledInvocationId = `viz-invocation-cancelled-${suffix}`;
    const cancelledProviderRequestId = `viz-provider-request-cancelled-${suffix}`;
    await repository.startProviderInvocation({
      dataClass: "paper",
      idempotencyKey: `provider-invocation-cancelled-${suffix}`,
      invocationId: cancelledInvocationId,
      modality: "semantic_graph",
      operation: "structured_generation",
      reservationId: cancelledReservation.reservationId,
      routeId,
      routeRevision: 1,
      subjectId
    });
    await repository.finalizeProviderInvocation({
      cost: {
        ...providerCost(cancelledInvocationId, cancelledProviderRequestId, routeId, providerId, `${suffix}-cancelled`),
        reasonCode: "provider_cancelled"
      },
      errorCode: "visualization_request_aborted",
      invocationId: cancelledInvocationId,
      providerRequestId: cancelledProviderRequestId,
      providerUnits: 1,
      state: "cancelled"
    });
    await repository.rollback(subjectId, {
      reasonCode: "visualization_request_aborted",
      reservationId: cancelledReservation.reservationId,
      traceId: `trace-provider-cancelled-${suffix}`
    });
    const cancelledAccounting = await pool.query(`
      SELECT invocation.state,
             count(DISTINCT cost.cost_event_id)::integer AS provider_cost_rows,
             count(DISTINCT usage.event_id) FILTER (WHERE usage.event_type = 'settled')::integer AS user_settlement_rows,
             count(DISTINCT usage.event_id) FILTER (WHERE usage.event_type = 'rollback')::integer AS user_rollback_rows
        FROM visualization_provider_invocations invocation
        LEFT JOIN visualization_provider_cost_ledger cost USING(invocation_id)
        LEFT JOIN visualization_usage_ledger usage
          ON usage.reservation_id = invocation.reservation_id
       WHERE invocation.invocation_id = $1
       GROUP BY invocation.state
    `, [cancelledInvocationId]);
    assert.deepEqual(cancelledAccounting.rows[0], {
      state: "cancelled",
      provider_cost_rows: 1,
      user_settlement_rows: 0,
      user_rollback_rows: 1
    });
  } finally {
    if (documentFixture) {
      await cleanupPublicationDocument(pool, documentFixture.document.documentId, documentFixture.sourceHash);
    }
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

test("visualization publication and provider accounting are atomic in PostgreSQL", {
  skip: connectionString ? false : "LITEASY_TEST_DATABASE_URL is not configured"
}, async () => {
  const pool = createVisualizationTestPool({ connectionString, sslMode: "disable" });
  try {
    await verifyPublicationAndProviderAccountingTransactions(pool);
  } finally {
    await pool.end();
  }
});
