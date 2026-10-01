import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDatabase } from "./database.mjs";
import { SqliteDeviceControlRepository } from "./deviceControlRepository.mjs";
import { DeviceControlService } from "../../../products/liteasy/packages/device-control/src/service.mjs";

test("local development persists paired devices and queued tasks in its own SQLite database", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "liteasy-device-test-")); const databasePath = path.join(directory, "state.db");
  let db = createDatabase({ databasePath });
  const device = (name, capabilities = []) => ({ deviceId: randomUUID(), secret: randomBytes(32).toString("base64url"), name, capabilities });
  const mobile = device("Phone"); const desktop = device("Desktop", ["sync-library"]);
  try {
    let service = new DeviceControlService(new SqliteDeviceControlRepository(db));
    await service.register("owner", "mobile", mobile); await service.register("owner", "desktop", desktop);
    await service.pair("owner", mobile, await service.pairCode("owner", desktop));
    const request = { operationId: randomUUID(), desktopId: desktop.deviceId, kind: "sync-library" };
    const queued = await service.enqueue("owner", mobile, request);
    db.close(); db = createDatabase({ databasePath }); service = new DeviceControlService(new SqliteDeviceControlRepository(db));
    const replayed = await service.enqueue("owner", mobile, request);
    assert.equal(replayed.task.taskId, queued.task.taskId); assert.equal(replayed.replayed, true);
    assert.equal((await service.claim("owner", desktop)).task.taskId, queued.task.taskId);
    await assert.rejects(() => service.list("other", "mobile", mobile), /device_unauthorized/);
  } finally { db.close(); fs.rmSync(directory, { recursive: true }); }
});
