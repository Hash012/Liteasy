import assert from "node:assert/strict";
import test from "node:test";
import { DeviceControlService } from "../../../packages/device-control/src/service.mjs";
import { handleDeviceControl } from "../../../packages/device-control/src/routes.mjs";
import { PostgresDeviceControlRepository } from "./deviceControlRepository.mjs";
import { PostgresVisualizationGenerationRepository } from "./visualizationGenerationRepository.mjs";
import { PostgresVisualizationRepository } from "./visualizationRepository.mjs";

const subject = "synthetic-deleted-subject";
const device = { deviceId: "00000000-0000-4000-8000-000000000001", secret: "s".repeat(43), name: "Synthetic device", capabilities: [] };
const generationInput = {
  artifactId: "synthetic-artifact", artifactRevision: 1, intentHash: "a".repeat(64),
  nodeId: "node", requestId: "synthetic-request", requestedArtifactCount: 1, traceId: "trace-synthetic"
};

function harness() {
  const state = { deleted: false, devices: undefined, generation: undefined, preference: undefined, calls: [] };
  const client = {
    release() {},
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      state.calls.push({ sql: normalized, values });
      if (normalized.includes("FROM account_deletion_jobs")) {
        assert.deepEqual(values, [subject]);
        return { rows: state.deleted ? [{ subject_id: subject, state: "completed" }] : [] };
      }
      if (normalized.startsWith("INSERT INTO device_control_accounts")) state.devices ??= JSON.parse(values[1]);
      if (normalized.startsWith("SELECT state FROM device_control_accounts")) return { rows: [{ state: structuredClone(state.devices) }] };
      if (normalized.startsWith("UPDATE device_control_accounts")) state.devices = JSON.parse(values[1]);
      if (normalized.startsWith("INSERT INTO visualization_generation_requests")) {
        state.generation = { request_id: values[1], state: "queued" };
        return { rows: [state.generation] };
      }
      if (normalized.startsWith("INSERT INTO visualization_user_preferences")) {
        state.preference = { subject_id: values[0], enabled: values[1], revision: 1 };
        return { rows: [state.preference] };
      }
      return { rows: [] };
    }
  };
  return { state, pool: { async connect() { return client; } } };
}

for (const kind of ["mobile", "desktop"]) {
  test(`a ${kind} request authenticated before deletion cannot recreate device state after body parsing`, async () => {
    const { pool, state } = harness();
    const service = new DeviceControlService(new PostgresDeviceControlRepository(pool));
    let authenticated = false;
    let sent = false;
    await assert.rejects(() => handleDeviceControl({
      request: { method: "POST", headers: {} },
      url: new URL(`https://synthetic.invalid/v1/${kind}/devices/register`),
      service,
      authenticate: async () => { authenticated = true; return { subject }; },
      readBody: async () => { assert.equal(authenticated, true); state.deleted = true; return device; },
      send: () => { sent = true; }
    }), { code: "account_deletion_started" });
    assert.equal(sent, false);
    assert.equal(state.devices, undefined);
  });
}

test("late visualization creation cannot requeue a request for a deleted account", async () => {
  const { pool, state } = harness();
  state.deleted = true;
  await assert.rejects(() => new PostgresVisualizationGenerationRepository(pool).create(subject, generationInput), { code: "account_deletion_started" });
  assert.equal(state.generation, undefined);
});

test("late visualization preference update cannot restore a deleted private preference", async () => {
  const { pool, state } = harness();
  state.deleted = true;
  await assert.rejects(() => new PostgresVisualizationRepository(pool).setPreference(subject, {
    enabled: true, idempotencyKey: "synthetic-preference-001", traceId: "trace-synthetic"
  }), { code: "account_deletion_started" });
  assert.equal(state.preference, undefined);
});

test("active accounts still register devices, queue generation and change preferences", async () => {
  const { pool, state } = harness();
  const registered = await new DeviceControlService(new PostgresDeviceControlRepository(pool)).register(subject, "mobile", device);
  assert.equal(registered.device.deviceId, device.deviceId);
  assert.equal((await new PostgresVisualizationGenerationRepository(pool).create(subject, generationInput)).status, "queued");
  assert.equal((await new PostgresVisualizationRepository(pool).setPreference(subject, {
    enabled: false, idempotencyKey: "synthetic-preference-002", traceId: "trace-synthetic"
  })).preference.enabled, false);
  const locks = state.calls.filter(({ sql, values }) => sql.includes("pg_advisory_xact_lock") && values[0] === `account-deletion:${subject}`);
  assert.equal(locks.length, 3);
  assert.equal(state.calls.filter(({ sql }) => sql === "BEGIN ISOLATION LEVEL READ COMMITTED").length, 3);
});
