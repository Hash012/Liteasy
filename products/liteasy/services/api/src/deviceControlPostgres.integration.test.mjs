import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import pg from "pg";
import { PostgresDeviceControlRepository } from "./deviceControlRepository.mjs";
import { DeviceControlService } from "../../../packages/device-control/src/service.mjs";

const connectionString = process.env.LITEASY_DEVICE_CONTROL_TEST_DATABASE_URL;
test("PostgreSQL serializes concurrent claims and retains idempotency/results across service restarts", { skip: !connectionString }, async () => {
  const schema = `device_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString, ssl: false }); let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ connectionString, ssl: false, max: 8, options: `-c search_path=${schema}` });
    await pool.query(fs.readFileSync(new URL("../migrations/028_device_control.sql", import.meta.url), "utf8"));
    const create = () => new DeviceControlService(new PostgresDeviceControlRepository(pool));
    const device = (name, capabilities = []) => ({ deviceId: randomUUID(), secret: randomBytes(32).toString("base64url"), name, capabilities });
    const mobile = device("Phone"); const desktop = device("Desktop", ["sync-library"]); const service = create();
    await Promise.all([service.register("owner", "mobile", mobile), service.register("owner", "desktop", desktop)]);
    await service.pair("owner", mobile, await service.pairCode("owner", desktop));
    const input = { operationId: randomUUID(), desktopId: desktop.deviceId, kind: "sync-library" };
    const tasks = await Promise.all(Array.from({ length: 5 }, () => create().enqueue("owner", mobile, input)));
    assert.equal(new Set(tasks.map((value) => value.task.taskId)).size, 1);
    const claims = await Promise.all(Array.from({ length: 5 }, () => create().claim("owner", desktop)));
    const active = claims.filter((value) => value.task); assert.equal(active.length, 1); const lease = active[0].task;
    await create().updateTask("owner", desktop, lease.taskId, "start", lease);
    await create().updateTask("owner", desktop, lease.taskId, "receipt", { leaseToken: lease.leaseToken, status: "succeeded", result: { message: "Synced" } });
    await pool.end(); pool = new pg.Pool({ connectionString, ssl: false, options: `-c search_path=${schema}` });
    const restored = await create().list("owner", "mobile", mobile);
    assert.equal(restored.tasks[0].result.message, "Synced"); assert.equal(restored.tasks[0].status, "succeeded");
    await assert.rejects(() => create().list("other-owner", "mobile", mobile), /device_unauthorized/);
    assert.equal((await create().enqueue("owner", mobile, input)).replayed, true);
    assert.equal(JSON.stringify(restored).includes(desktop.secret), false);
  } finally {
    if (pool) await pool.end(); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  }
});
