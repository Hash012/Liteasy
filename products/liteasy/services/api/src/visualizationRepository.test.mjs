import assert from "node:assert/strict";
import test from "node:test";
import { PostgresVisualizationRepository } from "./visualizationRepository.mjs";

function transactionHarness() {
  const state = {
    entitlements: new Map(),
    preferences: new Map(),
    policies: new Map(),
    costPolicies: new Map(),
    reservations: new Map(),
    idempotency: new Map(),
    usage: [],
    costs: [],
    artifacts: [],
    routeAvailable: undefined,
    routeOperations: undefined,
    availableModalities: undefined,
    availableCostPolicy: true
  };
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push({ sql: normalized, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(normalized)) return { rows: [] };
      if (normalized.startsWith("SELECT pg_advisory_xact_lock")) return { rows: [] };
      if (normalized.includes("FROM idempotency_records")) {
        const key = values.join(":");
        const row = state.idempotency.get(key);
        return { rows: row ? [row] : [] };
      }
      if (normalized.startsWith("INSERT INTO idempotency_records")) {
        state.idempotency.set(values.slice(0, 3).join(":"), {
          request_hash: values[3],
          response_body: JSON.parse(values[4])
        });
        return { rows: [] };
      }
      if (normalized.startsWith("INSERT INTO visualization_user_preferences")) {
        state.preferences.set(values[0], { subject_id: values[0], enabled: values[1], revision: "1" });
        return { rows: [state.preferences.get(values[0])] };
      }
      if (normalized.startsWith("INSERT INTO audit_events")) return { rows: [] };
      if (normalized.includes("FROM visualization_entitlements")) {
        if (normalized.startsWith("SELECT e.*")) {
          const entitlement = state.entitlements.get(values[0]);
          const preference = state.preferences.get(values[0]);
          const generationOperation = state.routeOperations?.some((operation) => ["structured_generation", "image_generation"].includes(operation));
          const policyRouteAvailable = state.routeAvailable === undefined
            ? undefined
            : state.routeAvailable && state.availableCostPolicy && (generationOperation || normalized.includes("'validation'"));
          return { rows: entitlement ? [{ ...entitlement, preference_enabled: preference?.enabled ?? true,
            route_available: policyRouteAvailable,
            available_modalities: policyRouteAvailable ? state.availableModalities ?? [] : [],
            quota_subject_id: state.policies.has(values[0]) ? values[0] : null,
            daily_units: state.policies.get(values[0])?.daily_units,
            monthly_units: state.policies.get(values[0])?.monthly_units,
            max_concurrency: state.policies.get(values[0])?.max_concurrency,
            timezone: state.policies.get(values[0])?.timezone,
            daily_used: 0, monthly_used: 0, active_count: 0
          }] : [] };
        }
        const row = state.entitlements.get(values[0]);
        return { rows: row ? [row] : [] };
      }
      if (normalized.includes("FROM visualization_user_preferences")) {
        const row = state.preferences.get(values[0]);
        return { rows: row ? [row] : [] };
      }
      if (normalized.includes("FROM visualization_quota_policies")) {
        const row = state.policies.get(values[0]);
        return { rows: row ? [row] : [] };
      }
      if (normalized.includes("FROM visualization_provider_configs")) {
        return { rows: [{ route_id: "route-1", provider_id: "provider-1", revision: "1", enabled: true, circuit_state: "closed", circuit_open_until: null, modalities: ["semantic_graph"], operations: ["structured_generation", "validation"], data_classes: ["paper"], route_available: true }] };
      }
      if (normalized.includes("FROM visualization_cost_policies")) return { rows: state.availableCostPolicy ? [{ modality: "semantic_graph", operation: "structured_generation", data_class: "paper", unit_cost: 4, revision: "1", enabled: true }] : [] };
      if (normalized.includes("FROM visualization_quota_reservations") && normalized.includes("idempotency_key")) {
        const row = [...state.reservations.values()].find((item) => item.subject_id === values[0] && item.idempotency_key === values[1]);
        return { rows: row ? [row] : [] };
      }
      if (normalized.includes("FROM visualization_quota_reservations") && normalized.includes("reservation_id")) {
        const row = state.reservations.get(values[0]);
        return { rows: row ? [row] : [] };
      }
      if (normalized.startsWith("SELECT COALESCE(SUM")) return { rows: [{ used_units: "0" }] };
      if (normalized.startsWith("SELECT COUNT")) return { rows: [{ active_count: "0" }] };
      if (normalized.startsWith("INSERT INTO visualization_quota_reservations")) {
        const row = { reservation_id: values[0], subject_id: values[1], idempotency_key: values[2], modality: values[3], route_id: values[4], route_revision: String(values[5]), policy_revision: String(values[6]), requested_by: values[7], cost_table_revision: String(values[8]), reserved_units: values[9], settled_units: null, state: "reserved", expires_at: new Date(values[10]), created_at: new Date(), updated_at: new Date() };
        state.reservations.set(row.reservation_id, row);
        return { rows: [row] };
      }
      if (normalized.startsWith("UPDATE visualization_quota_reservations")) {
        const row = state.reservations.get(values[1] ?? values[0]);
        if (row) { row.state = values[0]; row.settled_units = values[2] ?? row.settled_units; }
        return { rows: row ? [row] : [] };
      }
      if (normalized.startsWith("INSERT INTO visualization_usage_ledger")) {
        state.usage.push(values);
        return { rows: [] };
      }
      if (normalized.startsWith("INSERT INTO visualization_provider_cost_ledger")) {
        state.costs.push(values);
        return { rows: [] };
      }
      if (normalized.startsWith("SELECT * FROM visualization_artifacts")) return { rows: state.artifacts };
      if (normalized.startsWith("INSERT INTO visualization_artifacts")) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  return { state, calls, pool: { async connect() { return client; }, async query(sql, values) { return client.query(sql, values); } } };
}

const subject = { subjectId: "user-1" };
const policy = { dailyUnits: 4, monthlyUnits: 8, maxConcurrency: 1, timezone: "UTC", revision: 1, updatedBy: "admin-1", reason: "Approved quota policy" };

test("rejects reservation when the request idempotency key is reused with another input", async () => {
  const harness = transactionHarness();
  harness.state.entitlements.set("user-1", { subject_id: "user-1", allowed: true, explicit_requests_allowed: true, allowed_modalities: ["semantic_graph"], revision: "1" });
  harness.state.preferences.set("user-1", { subject_id: "user-1", enabled: true, revision: "1" });
  harness.state.policies.set("user-1", { subject_id: "user-1", daily_units: "4", monthly_units: "8", max_concurrency: "1", timezone: "UTC", revision: "1" });
  const repository = new PostgresVisualizationRepository(harness.pool);
  await repository.reserve(subject, { idempotencyKey: "request-0001", modality: "semantic_graph", routeId: "route-1", units: 1, traceId: "trace-1" });
  await assert.rejects(
    repository.reserve(subject, { idempotencyKey: "request-0001", modality: "circuit", routeId: "route-1", units: 2, traceId: "trace-1" }),
    /idempotency_key_reused/
  );
});

test("reserve requires a non-empty entitlement modality allowlist and prices the locked route provider", async () => {
  const harness = transactionHarness();
  harness.state.entitlements.set("user-1", { subject_id: "user-1", allowed: true, explicit_requests_allowed: true, allowed_modalities: [], revision: "1" });
  harness.state.preferences.set("user-1", { subject_id: "user-1", enabled: true, revision: "1" });
  harness.state.policies.set("user-1", { subject_id: "user-1", daily_units: "4", monthly_units: "8", max_concurrency: "1", timezone: "UTC", revision: "1" });
  const repository = new PostgresVisualizationRepository(harness.pool);
  await assert.rejects(
    repository.reserve(subject, { idempotencyKey: "request-0003", modality: "semantic_graph", routeId: "route-1", traceId: "trace-1" }),
    /visualization_modality_not_allowed/
  );
  harness.state.entitlements.get("user-1").allowed_modalities = ["semantic_graph"];
  await repository.reserve(subject, { idempotencyKey: "request-0004", modality: "semantic_graph", routeId: "route-1", traceId: "trace-1" });
  assert.equal(harness.calls.some(({ sql, values }) => sql.includes("visualization_cost_policies") && values.includes("provider-1")), true);
});

test("settlement and rollback write user ledger transitions independently from provider costs", async () => {
  const harness = transactionHarness();
  harness.state.entitlements.set("user-1", { subject_id: "user-1", allowed: true, explicit_requests_allowed: true, allowed_modalities: ["semantic_graph"], revision: "1" });
  harness.state.preferences.set("user-1", { subject_id: "user-1", enabled: true, revision: "1" });
  harness.state.policies.set("user-1", { subject_id: "user-1", daily_units: "10", monthly_units: "20", max_concurrency: "1", timezone: "UTC", revision: "1" });
  const repository = new PostgresVisualizationRepository(harness.pool);
  const reservation = await repository.reserve(subject, { idempotencyKey: "request-0002", modality: "semantic_graph", routeId: "route-1", units: 4, traceId: "trace-2" });
  await repository.settle(subject, { reservationId: reservation.reservation.reservationId, settledUnits: 2, reasonCode: "generation_succeeded", traceId: "trace-2" });
  await repository.recordProviderCost({ invocationId: "invoke-1", routeId: "route-1", providerId: "provider-1", providerRequestId: "provider-request-1", amount: 0.02, currency: "USD", units: 2, reasonCode: "generation" });
  assert.equal(harness.state.usage.length, 2);
  assert.equal(harness.state.costs.length, 1);
  assert.equal((await repository.capability(subject)).quota.usedUnits, 0);
});

test("preference is preserved when entitlement is revoked and regranted", async () => {
  const harness = transactionHarness();
  const repository = new PostgresVisualizationRepository(harness.pool);
  await repository.setPreference(subject, { enabled: false, idempotencyKey: "preference-0001", traceId: "trace-3" });
  harness.state.entitlements.set("user-1", { subject_id: "user-1", allowed: false, explicit_requests_allowed: false, allowed_modalities: [], revision: "1" });
  assert.equal((await repository.getEntitlement(subject)).allowed, false);
  assert.equal((await repository.capability(subject)).enabled, false);
  harness.state.entitlements.get("user-1").allowed = true;
  assert.equal((await repository.capability(subject)).enabled, false);
  assert.equal((await repository.setPreference(subject, { enabled: true, idempotencyKey: "preference-0002", traceId: "trace-4" })).preference.enabled, true);
});

test("validates IANA quota timezone and records zero-unit cache reuse", async () => {
  const harness = transactionHarness();
  const repository = new PostgresVisualizationRepository(harness.pool);
  await assert.rejects(() => repository.setQuotaPolicy(subject, { ...policy, timezone: "not/a-zone", idempotencyKey: "quota-0001" }), /quota_timezone_invalid/);
  await repository.recordCacheReuse(subject, { idempotencyKey: "cache-reuse-0001", traceId: "trace-5" });
  assert.ok(harness.calls.some((call) => call.sql.includes("'cache_reuse',0")));
});

test("uses net ledger deltas and the policy timezone for both quota windows", async () => {
  const harness = transactionHarness();
  harness.state.entitlements.set("user-1", { subject_id: "user-1", allowed: true, explicit_requests_allowed: true, allowed_modalities: ["semantic_graph"], revision: "1" });
  harness.state.preferences.set("user-1", { subject_id: "user-1", enabled: true, revision: "1" });
  harness.state.policies.set("user-1", { subject_id: "user-1", daily_units: "10", monthly_units: "20", max_concurrency: "1", timezone: "Asia/Shanghai", revision: "1" });
  const repository = new PostgresVisualizationRepository(harness.pool);
  await repository.capability(subject);
  await repository.reserve(subject, { idempotencyKey: "request-0003", modality: "semantic_graph", routeId: "route-1", units: 1, traceId: "trace-6" });
  const sql = harness.calls.filter((call) => call.sql.includes("visualization_usage_ledger")).map((call) => call.sql).join("\n");
  assert.doesNotMatch(sql, /GREATEST\s*\(/);
  assert.match(sql, /date_trunc\('day', now\(\),/);
  assert.match(sql, /date_trunc\('month', now\(\),/);
  assert.match(sql, /COALESCE\(r\.created_at, u\.created_at\)/);
  assert.match(harness.calls.map((call) => call.sql).join("\n"), /state = 'expired'/);
});

test("fails closed when cache identity or access checks are missing", async () => {
  const harness = transactionHarness();
  harness.state.entitlements.set("user-1", { subject_id: "user-1", allowed: true, explicit_requests_allowed: true, allowed_modalities: ["semantic_graph"], revision: "1" });
  harness.state.preferences.set("user-1", { subject_id: "user-1", enabled: true, revision: "1" });
  const repository = new PostgresVisualizationRepository(harness.pool);
  await assert.equal(await repository.findReusableArtifact(subject, {
    tenantId: "tenant-1", documentId: "doc-1", modality: "semantic_graph", specHash: "a".repeat(64), evidenceHash: "b".repeat(64),
    locale: "zh-CN", skillVersion: "skill@1", kernelVersion: "kernel@1", rendererVersion: "renderer@1", hardValidatorSet: ["schema@1"], sourceIdentityHash: "c".repeat(64)
  }), null);
});

test("rejects incomplete settlement and provider cost records", async () => {
  const harness = transactionHarness();
  const repository = new PostgresVisualizationRepository(harness.pool);
  await assert.rejects(() => repository.settle(subject, { reservationId: "reservation-1", reasonCode: "x" }), /visualization_reservation_not_found/);
  await assert.rejects(() => repository.recordProviderCost({ invocationId: "invoke-1", routeId: "route-1", providerId: "provider-1", providerRequestId: "provider-request-1", amount: -1, currency: "USD", units: 1, reasonCode: "x" }), /visualization_provider_cost_amount_invalid/);
  await assert.rejects(() => repository.recordProviderCost({ invocationId: "invoke-1", routeId: "route-1", providerId: "provider-1", providerRequestId: "provider-request-1", amount: 1, currency: "usd", units: 1, reasonCode: "x" }), /visualization_provider_cost_currency_invalid/);
});

const providerRow = {
  circuit_failures: 0,
  circuit_open_until: null,
  circuit_state: "closed",
  created_at: new Date("2026-08-09T00:00:00.000Z"),
  data_classes: ["paper"],
  enabled: true,
  endpoint: "https://visual.example/v1",
  max_concurrency: 2,
  modalities: ["semantic_graph"],
  model: "visual-1",
  operations: ["structured_generation", "validation"],
  priority: 10,
  provider_id: "provider-1",
  region: "cn-east",
  revision: "1",
  route_id: "route-1",
  secret_ref: "viz-secret:provider-1",
  timeout_ms: 30000,
  updated_at: new Date("2026-08-09T00:00:00.000Z"),
  updated_by: "admin-1"
};

function adminPool(query) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.trim().replace(/\s+/g, " ");
      calls.push({ sql: normalized, values });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(normalized) || normalized.startsWith("SELECT pg_advisory_xact_lock")) {
        return { rows: [] };
      }
      return query(normalized, values, calls);
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

test("lists and resolves normalized provider route administration records", async () => {
  const harness = adminPool(async (sql) => {
    if (sql.includes("FROM visualization_provider_configs")) return { rows: [providerRow] };
    return { rows: [] };
  });
  const repository = new PostgresVisualizationRepository(harness.pool);
  const listed = await repository.listProviderRoutes();
  const loaded = await repository.getProviderRoute("route-1");
  assert.deepEqual(listed, { routes: [loaded] });
  assert.deepEqual(loaded, {
    circuitFailures: 0,
    circuitOpenUntil: null,
    circuitState: "closed",
    dataClasses: ["paper"],
    enabled: true,
    endpoint: "https://visual.example/v1",
    maxConcurrency: 2,
    modalities: ["semantic_graph"],
    model: "visual-1",
    operations: ["structured_generation", "validation"],
    priority: 10,
    providerId: "provider-1",
    region: "cn-east",
    revision: 1,
    routeId: "route-1",
    secretRef: "viz-secret:provider-1",
    timeoutMs: 30000,
    updatedAt: "2026-08-09T00:00:00.000Z",
    updatedBy: "admin-1"
  });
});

test("saves a provider route with optimistic revision, idempotency, and audit", async () => {
  let saved = false;
  const harness = adminPool(async (sql, values) => {
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("FROM visualization_provider_configs") && sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.startsWith("INSERT INTO visualization_provider_configs")) {
      saved = true;
      return { rows: [providerRow] };
    }
    return { rows: [] };
  });
  const repository = new PostgresVisualizationRepository(harness.pool);
  const result = await repository.saveProviderRoute({
    expectedRevision: 0,
    idempotencyKey: "provider-save-0001",
    reason: "Approved provider route",
    route: {
      circuitFailures: 0,
      circuitOpenUntil: null,
      circuitState: "closed",
      dataClasses: ["paper"],
      enabled: true,
      endpoint: "https://visual.example/v1",
      maxConcurrency: 2,
      modalities: ["semantic_graph"],
      model: "visual-1",
      operations: ["structured_generation", "validation"],
      priority: 10,
      providerId: "provider-1",
      region: "cn-east",
      revision: 1,
      routeId: "route-1",
      secretRef: "viz-secret:provider-1",
      timeoutMs: 30000
    },
    traceId: "trace-provider-1",
    updatedBy: "admin-1"
  });
  assert.equal(saved, true);
  assert.equal(result.route.routeId, "route-1");
  assert.equal(harness.calls.some((call) => call.sql.startsWith("INSERT INTO audit_events")), true);
  assert.equal(harness.calls.some((call) => call.sql.startsWith("INSERT INTO idempotency_records")), true);
});

test("creating a provider route provisions cost policies for every declared capability", async () => {
  const harness = adminPool(async (sql, values) => {
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("FROM visualization_provider_configs") && sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.startsWith("INSERT INTO visualization_provider_configs")) return { rows: [{ ...providerRow, route_id: "route-new", provider_id: "provider-new", revision: "1" }] };
    if (sql.startsWith("INSERT INTO visualization_cost_policies")) return { rows: [{ modality: values[0], operation: values[1], data_class: values[2], provider_id: values[3], unit_cost: values[4], revision: "1", enabled: true, updated_by: values[5], reason: values[6] }] };
    return { rows: [] };
  });
  const repository = new PostgresVisualizationRepository(harness.pool);
  const result = await repository.saveProviderRoute({
    route: {
      routeId: "route-new", providerId: "provider-new", revision: 1,
      operations: ["structured_generation"], modalities: ["semantic_graph"], dataClasses: ["paper"],
      endpoint: "https://provider.example/v1", secretRef: "viz-secret:provider-new",
      model: "visual-1", region: "global", priority: 1, timeoutMs: 30000, maxConcurrency: 1,
      enabled: true, circuitState: "closed", circuitFailures: 0, circuitOpenUntil: null
    },
    expectedRevision: 0, updatedBy: "admin-1", idempotencyKey: "route-create-1",
    reason: "enable provider route", traceId: "trace-route-new"
  });
  assert.equal(result.route.revision, 1);
  assert.equal(result.costPolicies.length, 1);
  assert.equal(harness.calls.some(({ sql }) => sql.includes("visualization_cost_policies")), true);
});

test("capability and reserve fail closed when the locked route has no matching cost policy", async () => {
  const harness = transactionHarness();
  harness.state.entitlements.set("user-1", { subject_id: "user-1", allowed: true, explicit_requests_allowed: true, allowed_modalities: ["semantic_graph"], revision: "1" });
  harness.state.preferences.set("user-1", { subject_id: "user-1", enabled: true, revision: "1" });
  harness.state.policies.set("user-1", { subject_id: "user-1", daily_units: "4", monthly_units: "8", max_concurrency: "1", timezone: "UTC", revision: "1" });
  harness.state.routeAvailable = true;
  harness.state.availableModalities = ["semantic_graph"];
  harness.state.availableCostPolicy = false;
  const repository = new PostgresVisualizationRepository(harness.pool);
  const capability = await repository.capability("user-1");
  assert.equal(capability.allowed, true);
  assert.equal(capability.serviceAvailable, false);
  await assert.rejects(repository.reserve("user-1", {
    idempotencyKey: "request-new-1", modality: "semantic_graph", operation: "structured_generation",
    dataClass: "paper", routeId: "route-1"
  }), /visualization_cost_policy_unconfigured/);
});

test("validation-only routes do not advertise generation capability", async () => {
  const harness = transactionHarness();
  harness.state.entitlements.set("user-1", { subject_id: "user-1", allowed: true, explicit_requests_allowed: true, allowed_modalities: ["semantic_graph"], revision: "1" });
  harness.state.preferences.set("user-1", { subject_id: "user-1", enabled: true, revision: "1" });
  harness.state.policies.set("user-1", { subject_id: "user-1", daily_units: "4", monthly_units: "8", max_concurrency: "1", timezone: "UTC", revision: "1" });
  harness.state.routeAvailable = true;
  harness.state.routeOperations = ["validation"];
  harness.state.availableModalities = ["semantic_graph"];
  const capability = await new PostgresVisualizationRepository(harness.pool).capability("user-1");
  assert.equal(capability.allowed, true);
  assert.equal(capability.serviceAvailable, false);
  assert.deepEqual(capability.availableModalities, []);
});

test("rejects a stale provider route revision before mutation", async () => {
  const harness = adminPool(async (sql) => {
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("FROM visualization_provider_configs") && sql.includes("FOR UPDATE")) return { rows: [providerRow] };
    return { rows: [] };
  });
  const repository = new PostgresVisualizationRepository(harness.pool);
  await assert.rejects(() => repository.saveProviderRoute({
    expectedRevision: 0,
    idempotencyKey: "provider-save-0002",
    reason: "Approved provider route",
    route: { routeId: "route-1" },
    traceId: "trace-provider-2",
    updatedBy: "admin-1"
  }), /visualization_route_revision_conflict/);
  assert.equal(harness.calls.some((call) => /^(INSERT|UPDATE) visualization_provider_configs/.test(call.sql)), false);
});

test("finalizes a failed provider probe as a redacted replayable error and audits once", async () => {
  let idempotencyRow = null;
  let auditCount = 0;
  const harness = adminPool(async (sql, values, calls) => {
    if (sql.includes("FROM idempotency_records")) return { rows: idempotencyRow ? [idempotencyRow] : [] };
    if (sql.includes("FROM visualization_provider_configs")) return { rows: [providerRow] };
    if (sql.startsWith("INSERT INTO idempotency_records")) {
      idempotencyRow = { request_hash: values[2], response_body: JSON.parse(values[3]) };
      return { rows: [] };
    }
    if (sql.startsWith("INSERT INTO audit_events")) {
      auditCount += 1;
      assert.equal(String(values[5]).includes("provider secret"), false);
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE idempotency_records")) {
      idempotencyRow.response_body = JSON.parse(values[4]);
      return { rows: [] };
    }
    return { rows: [] };
  });
  const repository = new PostgresVisualizationRepository(harness.pool);
  const input = {
    actorId: "admin-1",
    expectedRevision: 1,
    idempotencyKey: "probe-failure-1",
    reason: "verify provider route",
    routeId: "route-1",
    traceId: "trace-1"
  };
  const claim = await repository.claimProviderProbe(input);
  assert.equal(claim.claimed, true);
  const finalized = await repository.recordProviderProbe({
    ...input,
    error: Object.assign(new Error("provider secret"), { code: "visualization_provider_unavailable", status: 503 })
  });
  assert.equal(finalized.error.code, "visualization_provider_unavailable");
  assert.equal(finalized.error.status, 503);
  assert.equal(auditCount, 1);
  const replay = await repository.getProviderProbeReplay(input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.error.code, "visualization_provider_unavailable");
});

test("projects bounded visualization usage and administrator audit rows", async () => {
  const harness = adminPool(async (sql) => {
    if (sql.includes("FROM visualization_usage_ledger")) return { rows: [{
      created_at: new Date("2026-08-09T01:00:00.000Z"),
      event_id: "usage-1",
      event_type: "settled",
      idempotency_key: "request-0001",
      reason_code: "completed",
      reservation_id: "reservation-1",
      subject_id: "user-1",
      trace_id: "trace-usage-1",
      units_delta: -2
    }] };
    if (sql.includes("FROM audit_events")) return { rows: [{
      action: "visualization_provider_saved",
      actor_id: "admin-1",
      audit_id: "audit-1",
      detail: { revision: 1 },
      occurred_at: new Date("2026-08-09T01:00:00.000Z"),
      reason: "Approved provider route",
      resource_id: "route-1",
      resource_type: "visualization_provider",
      trace_id: "trace-audit-1"
    }] };
    return { rows: [] };
  });
  const repository = new PostgresVisualizationRepository(harness.pool);
  const usage = await repository.listUsage({ limit: 50, subjectId: "user-1" });
  const audit = await repository.listAudit({
    action: "visualization_provider_saved",
    from: "2026-08-01",
    limit: 50,
    subjectId: "user-1",
    to: "2026-08-09"
  });
  assert.equal(usage.rows[0].unitsDelta, -2);
  assert.equal(audit.rows[0].action, "visualization_provider_saved");
  assert.equal(harness.calls.every((call) => !call.values.includes(5000)), true);
  const auditCall = harness.calls.find((call) => call.sql.includes("FROM audit_events"));
  assert.match(auditCall.sql, /scope_id = \$1/);
  assert.match(auditCall.sql, /action = \$2/);
  assert.match(auditCall.sql, /occurred_at >= \$3::date/);
  assert.match(auditCall.sql, /occurred_at < \(\$4::date \+ interval '1 day'\)/);
  assert.deepEqual(auditCall.values, ["user-1", "visualization_provider_saved", "2026-08-01", "2026-08-09", 50]);
  await assert.rejects(() => repository.listAudit({ from: "2026-08-10", to: "2026-08-09" }), /visualization_audit_date_range_invalid/);
});

test("lists quota policies through the production repository", async () => {
  const harness = adminPool(async (sql) => {
    if (sql.includes("FROM visualization_quota_policies")) return { rows: [{
      daily_units: 20,
      max_concurrency: 2,
      monthly_units: 100,
      reason: "Approved quota policy",
      revision: "3",
      subject_id: "user-1",
      timezone: "Asia/Shanghai",
      updated_at: new Date("2026-08-09T01:00:00.000Z"),
      updated_by: "admin-1"
    }] };
    return { rows: [] };
  });
  const repository = new PostgresVisualizationRepository(harness.pool);
  assert.deepEqual(await repository.listQuotaPolicies({ limit: 25 }), {
    policies: [{
      dailyUnits: 20,
      maxConcurrency: 2,
      monthlyUnits: 100,
      reason: "Approved quota policy",
      revision: 3,
      subjectId: "user-1",
      timezone: "Asia/Shanghai",
      updatedAt: "2026-08-09T01:00:00.000Z",
      updatedBy: "admin-1"
    }]
  });
});

test("capability fails closed without both quota policy and a usable route", async () => {
  const rows = [
    { allowed: true, allowed_modalities: ["semantic_graph"], preference_enabled: true, quota_subject_id: null, route_available: true },
    { allowed: true, allowed_modalities: ["semantic_graph"], preference_enabled: true, quota_subject_id: "user-1", route_available: false }
  ];
  const repository = new PostgresVisualizationRepository({
    async query() { return { rows: [rows.shift()] }; }
  });
  for (const expected of ["missing policy", "missing route"]) {
    const capability = await repository.capability(subject);
    assert.equal(capability.serviceAvailable, false, expected);
    assert.equal(capability.quota.available, false, expected);
    assert.deepEqual(capability.availableModalities, [], expected);
  }
});

test("entitlement mutation enforces revision and persists idempotency with audit", async () => {
  const harness = adminPool(async (sql) => {
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("FROM visualization_entitlements") && sql.includes("FOR UPDATE")) return { rows: [] };
    if (sql.startsWith("INSERT INTO visualization_entitlements")) return { rows: [{
      allowed: true,
      allowed_modalities: ["semantic_graph"],
      explicit_requests_allowed: true,
      revision: "1",
      subject_id: "user-1"
    }] };
    return { rows: [] };
  });
  const repository = new PostgresVisualizationRepository(harness.pool);
  await repository.setEntitlement("user-1", {
    allowed: true,
    allowedModalities: ["semantic_graph"],
    expectedRevision: 0,
    explicitRequestsAllowed: true,
    grantedBy: "admin-1",
    idempotencyKey: "entitlement-0001",
    reason: "Approved entitlement",
    traceId: "trace-entitlement-1"
  });
  const audit = harness.calls.find((call) => call.sql.startsWith("INSERT INTO audit_events"));
  assert.equal(audit.values[2], "visualization_entitlement_updated");
  assert.equal(harness.calls.some((call) => call.sql.startsWith("INSERT INTO idempotency_records")), true);
});

test("quota mutation rejects stale revision before writing or auditing", async () => {
  const harness = adminPool(async (sql) => {
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("FROM visualization_quota_policies") && sql.includes("FOR UPDATE")) return { rows: [{ revision: "2" }] };
    return { rows: [] };
  });
  const repository = new PostgresVisualizationRepository(harness.pool);
  await assert.rejects(() => repository.setQuotaPolicy("user-1", {
    dailyUnits: 20,
    expectedRevision: 1,
    idempotencyKey: "quota-policy-0001",
    maxConcurrency: 2,
    monthlyUnits: 100,
    reason: "Approved quota policy",
    timezone: "UTC",
    traceId: "trace-quota-1",
    updatedBy: "admin-1"
  }), /visualization_quota_revision_conflict/);
  assert.equal(harness.calls.some((call) => call.sql.startsWith("INSERT INTO audit_events")), false);
});

test("governance mutations reject a revision lost during the final write", async () => {
  const entitlementHarness = adminPool(async (sql) => {
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("FROM visualization_entitlements") && sql.includes("FOR UPDATE")) return { rows: [{ revision: "1" }] };
    if (sql.startsWith("INSERT INTO visualization_entitlements")) return { rows: [] };
    return { rows: [] };
  });
  const entitlementRepository = new PostgresVisualizationRepository(entitlementHarness.pool);
  await assert.rejects(() => entitlementRepository.setEntitlement("user-1", {
    allowed: true,
    allowedModalities: ["semantic_graph"],
    expectedRevision: 1,
    explicitRequestsAllowed: true,
    grantedBy: "admin-1",
    idempotencyKey: "entitlement-0002",
    reason: "Approved entitlement",
    traceId: "trace-entitlement-2"
  }), /visualization_entitlement_revision_conflict/);
  assert.equal(entitlementHarness.calls.some((call) => call.sql.startsWith("INSERT INTO audit_events")), false);

  const quotaHarness = adminPool(async (sql) => {
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("FROM visualization_quota_policies") && sql.includes("FOR UPDATE")) return { rows: [{ revision: "1" }] };
    if (sql.startsWith("INSERT INTO visualization_quota_policies")) return { rows: [] };
    return { rows: [] };
  });
  const quotaRepository = new PostgresVisualizationRepository(quotaHarness.pool);
  await assert.rejects(() => quotaRepository.setQuotaPolicy("user-1", {
    dailyUnits: 20,
    expectedRevision: 1,
    idempotencyKey: "quota-policy-0002",
    maxConcurrency: 2,
    monthlyUnits: 100,
    reason: "Approved quota policy",
    timezone: "UTC",
    traceId: "trace-quota-2",
    updatedBy: "admin-1"
  }), /visualization_quota_revision_conflict/);
  assert.equal(quotaHarness.calls.some((call) => call.sql.startsWith("INSERT INTO audit_events")), false);

  const routeHarness = adminPool(async (sql) => {
    if (sql.includes("FROM idempotency_records")) return { rows: [] };
    if (sql.includes("FROM visualization_provider_configs") && sql.includes("FOR UPDATE")) return { rows: [{ revision: "1" }] };
    if (sql.startsWith("INSERT INTO visualization_provider_configs")) return { rows: [] };
    return { rows: [] };
  });
  const routeRepository = new PostgresVisualizationRepository(routeHarness.pool);
  await assert.rejects(() => routeRepository.saveProviderRoute({
    expectedRevision: 1,
    idempotencyKey: "provider-save-0003",
    reason: "Approved provider route",
    route: {
      circuitFailures: 0,
      circuitOpenUntil: null,
      circuitState: "closed",
      dataClasses: ["paper"],
      enabled: true,
      endpoint: "https://visual.example/v1",
      maxConcurrency: 2,
      modalities: ["semantic_graph"],
      model: "visual-1",
      operations: ["structured_generation", "validation"],
      priority: 10,
      providerId: "provider-1",
      region: "cn-east",
      revision: 2,
      routeId: "route-1",
      secretRef: "viz-secret:provider-1",
      timeoutMs: 30000
    },
    traceId: "trace-provider-3",
    updatedBy: "admin-1"
  }), /visualization_route_revision_conflict/);
  assert.equal(routeHarness.calls.some((call) => call.sql.startsWith("INSERT INTO audit_events")), false);
});

test("publication locks and rechecks governance before atomically saving and settling", async () => {
  const calls = [];
  const reservation = {
    idempotency_key: "generation-0001",
    modality: "semantic_graph",
    policy_revision: "1",
    reservation_id: "reservation-1",
    reserved_units: 4,
    route_id: "route-1",
    route_revision: "7",
    settled_units: null,
    state: "reserved",
    subject_id: "user-1"
  };
  const harness = adminPool(async (sql) => {
    calls.push(sql);
    if (sql.includes("FROM visualization_quota_reservations") && sql.includes("FOR UPDATE")) return { rows: [reservation] };
    if (sql.includes("FROM visualization_entitlements") && sql.includes("FOR UPDATE")) return { rows: [{ allowed: true, allowed_modalities: ["semantic_graph"] }] };
    if (sql.includes("FROM visualization_user_preferences")) return { rows: [{ enabled: true }] };
    if (sql.includes("FROM visualization_provider_configs") && sql.includes("FOR UPDATE")) return { rows: [{ enabled: true, revision: "7" }] };
    if (sql.includes("FROM library_entries entry")) return { rows: [{ content_hash: "c".repeat(64) }] };
    if (sql.startsWith("INSERT INTO visualization_artifacts")) return { rows: [{ artifact_id: "artifact-1" }] };
    if (sql.startsWith("UPDATE visualization_quota_reservations")) return { rows: [{ ...reservation, settled_units: 2, state: "settled" }] };
    return { rows: [] };
  });
  const repository = new PostgresVisualizationRepository(harness.pool);
  const result = await repository.publish("user-1", {
    access: { allowed: true, scopeId: "user-1", scopeType: "user", sourceIdentityHash: "c".repeat(64) },
    artifact: {
      artifactId: "artifact-1",
      body: { artifactVersion: "liteasy.visualization/v1" },
      contentHash: null,
      evidenceHash: "a".repeat(64),
      modality: "semantic_graph",
      nodeId: "node-1",
      specHash: "b".repeat(64),
      state: "ready"
    },
    document: { documentId: "document-1", sourceIdentityHash: "c".repeat(64) },
    reservationId: "reservation-1",
    routeId: "route-1",
    routeRevision: 7,
    settledUnits: 0,
    traceId: "trace-publish-1",
    validation: { outcome: "pass" }
  });
  assert.equal(result.artifact.artifactId, "artifact-1");
  const settlement = harness.calls.find((call) => call.sql.startsWith("UPDATE visualization_quota_reservations"));
  assert.equal(settlement.values[1], 4, "successful publication settles the server-reserved units");
  assert.ok(calls.indexOf(calls.find((sql) => sql.startsWith("INSERT INTO visualization_artifacts"))) <
    calls.indexOf(calls.find((sql) => sql.startsWith("UPDATE visualization_quota_reservations"))));
});
