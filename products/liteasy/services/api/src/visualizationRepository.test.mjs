import assert from "node:assert/strict";
import test from "node:test";
import { PostgresVisualizationRepository } from "./visualizationRepository.mjs";

function transactionHarness() {
  const state = {
    entitlements: new Map(),
    preferences: new Map(),
    policies: new Map(),
    reservations: new Map(),
    idempotency: new Map(),
    usage: [],
    costs: [],
    artifacts: []
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
      if (normalized.includes("FROM visualization_entitlements")) {
        if (normalized.startsWith("SELECT e.*")) {
          const entitlement = state.entitlements.get(values[0]);
          const preference = state.preferences.get(values[0]);
          return { rows: entitlement ? [{ ...entitlement, preference_enabled: preference?.enabled ?? true }] : [] };
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
        return { rows: [{ route_id: "route-1", revision: "1", enabled: true, circuit_state: "closed", circuit_open_until: null, modalities: ["semantic_graph"] }] };
      }
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
        const row = { reservation_id: values[0], subject_id: values[1], idempotency_key: values[2], modality: values[3], route_revision: String(values[5]), policy_revision: String(values[6]), reserved_units: values[7], settled_units: null, state: "reserved", expires_at: new Date(values[8]), created_at: new Date(), updated_at: new Date() };
        state.reservations.set(row.reservation_id, row);
        return { rows: [row] };
      }
      if (normalized.startsWith("UPDATE visualization_quota_reservations")) {
        const row = state.reservations.get(values[1]);
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
    repository.reserve(subject, { idempotencyKey: "request-0001", modality: "semantic_graph", routeId: "route-1", units: 2, traceId: "trace-1" }),
    /idempotency_key_reused/
  );
});

test("settlement and rollback write user ledger transitions independently from provider costs", async () => {
  const harness = transactionHarness();
  harness.state.entitlements.set("user-1", { subject_id: "user-1", allowed: true, explicit_requests_allowed: true, allowed_modalities: ["semantic_graph"], revision: "1" });
  harness.state.preferences.set("user-1", { subject_id: "user-1", enabled: true, revision: "1" });
  harness.state.policies.set("user-1", { subject_id: "user-1", daily_units: "10", monthly_units: "20", max_concurrency: "1", timezone: "UTC", revision: "1" });
  const repository = new PostgresVisualizationRepository(harness.pool);
  const reservation = await repository.reserve(subject, { idempotencyKey: "request-0002", modality: "semantic_graph", routeId: "route-1", units: 4, traceId: "trace-2" });
  await repository.settle(subject, { reservationId: reservation.reservation.reservationId, settledUnits: 2, traceId: "trace-2" });
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
