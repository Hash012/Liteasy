import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { DeviceControlService, emptyDeviceState } from "../../../packages/device-control/src/service.mjs";

async function fixture() {
  let now = 1_000_000; const states = new Map();
  const store = { async transaction(owner, operation) { const state = structuredClone(states.get(owner) ?? emptyDeviceState()); const value = operation(state); states.set(owner, state); return value; } };
  const service = new DeviceControlService(store, { now: () => now });
  const mobile = { deviceId: randomUUID(), secret: randomBytes(32).toString("base64url"), name: "Phone", capabilities: [] };
  const desktop = { deviceId: randomUUID(), secret: randomBytes(32).toString("base64url"), name: "Desktop", capabilities: ["open-document", "sync-library"] };
  await service.register("owner", "mobile", mobile); await service.register("owner", "desktop", desktop);
  const code = await service.pairCode("owner", desktop); await service.pair("owner", mobile, code);
  const enqueue = (overrides = {}) => service.enqueue("owner", mobile, { operationId: randomUUID(), desktopId: desktop.deviceId, kind: "open-document", document: { documentId: "paper", contentHash: "a".repeat(64), title: "Paper" }, ...overrides });
  return { service, states, store, mobile, desktop, enqueue, advance: (ms) => { now += ms; } };
}

test("pairing binds both devices to one account and never discloses secrets or challenges in lists", async () => {
  const f = await fixture(); const view = await f.service.list("owner", "mobile", f.mobile);
  assert.equal(view.devices[0].deviceId, f.desktop.deviceId); assert.equal(view.pairs.length, 1);
  assert.equal(JSON.stringify(view).includes(f.mobile.secret), false); assert.equal(JSON.stringify(view).includes("secretHash"), false);
  await assert.rejects(() => f.service.list("other", "mobile", f.mobile), /device_unauthorized/);
  await assert.rejects(() => f.service.list("owner", "desktop", f.mobile), /device_unauthorized/);
  await assert.rejects(() => f.service.list("owner", "mobile", { ...f.mobile, secret: "invalid" }), /device_unauthorized/);
});
test("pair codes are single-use and failed guesses persist rate limits", async () => {
  const f = await fixture(); f.advance(11_000); const issued = await f.service.pairCode("owner", f.desktop);
  await f.service.pair("owner", f.mobile, issued);
  await assert.rejects(() => f.service.pair("owner", f.mobile, issued), /pair_code_invalid/);
  for (let i = 0; i < 3; i++) await assert.rejects(() => f.service.pair("owner", f.mobile, { code: issued.code }), /pair_code_invalid/);
  await assert.rejects(() => f.service.pair("owner", f.mobile, issued), /pair_attempts_limited/);
});
test("enqueue retries reuse a task and changed inputs cannot reuse the operation ID", async () => {
  const f = await fixture(); const operationId = randomUUID(); const first = await f.enqueue({ operationId });
  const repeated = await f.enqueue({ operationId }); assert.equal(repeated.task.taskId, first.task.taskId); assert.equal(repeated.replayed, true);
  await assert.rejects(() => f.enqueue({ operationId, kind: "sync-library" }), /task_operation_reused/);
  await assert.rejects(() => f.enqueue({ kind: "shell-command" }), /task_kind_invalid/);
  await assert.rejects(() => f.enqueue({ kind: "extract-text" }), /desktop_capability_unavailable/);
});
test("unstarted leases may retry but an interrupted running task becomes uncertain without reexecution", async () => {
  const f = await fixture(); const { task } = await f.enqueue();
  const first = (await f.service.claim("owner", f.desktop)).task; assert.ok(first.leaseToken);
  assert.equal((await f.service.claim("owner", f.desktop)).task, null);
  f.advance(91_000); const second = (await f.service.claim("owner", f.desktop)).task;
  assert.equal(second.taskId, task.taskId); assert.notEqual(second.leaseToken, first.leaseToken);
  await assert.rejects(() => f.service.updateTask("owner", f.desktop, task.taskId, "start", first), /task_lease_invalid/);
  await f.service.updateTask("owner", f.desktop, task.taskId, "start", second); f.advance(121_000);
  const restarted = new DeviceControlService(f.store, { now: () => 1_212_000 });
  assert.equal((await restarted.claim("owner", f.desktop)).task, null);
  assert.equal((await restarted.list("owner", "mobile", f.mobile)).tasks[0].status, "uncertain");
  await restarted.updateTask("owner", f.desktop, task.taskId, "receipt", { leaseToken: second.leaseToken, status: "succeeded", result: { text: "Durable result" } });
  const receipt = await restarted.updateTask("owner", f.desktop, task.taskId, "receipt", { leaseToken: second.leaseToken, status: "failed" });
  assert.equal(receipt.replayed, true); assert.equal(receipt.task.status, "succeeded"); assert.equal(receipt.task.result.text, "Durable result");
});
test("missing attachments defer execution and cancellation or unpairing prevents a later start", async () => {
  const f = await fixture(); await f.enqueue(); const lease = (await f.service.claim("owner", f.desktop)).task;
  await f.service.updateTask("owner", f.desktop, lease.taskId, "defer", lease);
  assert.equal((await f.service.claim("owner", f.desktop)).task, null); f.advance(61_000);
  const second = (await f.service.claim("owner", f.desktop)).task; assert.equal(second.taskId, lease.taskId);
  await f.service.cancel("owner", f.mobile, second.taskId);
  await assert.rejects(() => f.service.updateTask("owner", f.desktop, second.taskId, "start", second), /task_already_finished/);
  const queued = await f.enqueue(); const pair = (await f.service.list("owner", "mobile", f.mobile)).pairs[0];
  await f.service.revokePair("owner", "mobile", f.mobile, pair.pairId);
  assert.equal((await f.service.claim("owner", f.desktop)).task, null);
  assert.equal((await f.service.list("owner", "mobile", f.mobile)).tasks.find((task) => task.taskId === queued.task.taskId).status, "cancelled");
  await assert.rejects(() => f.enqueue(), /device_pair_required/);
});
test("running cancellation is a request until the desktop confirms a result", async () => {
  const f = await fixture(); await f.enqueue(); const lease = (await f.service.claim("owner", f.desktop)).task;
  await f.service.updateTask("owner", f.desktop, lease.taskId, "start", lease);
  assert.equal((await f.service.cancel("owner", f.mobile, lease.taskId)).task.status, "running");
  const progress = await f.service.updateTask("owner", f.desktop, lease.taskId, "progress", { leaseToken: lease.leaseToken, progress: 20 });
  assert.equal(progress.cancelRequested, true);
  await assert.rejects(() => f.service.updateTask("owner", f.desktop, lease.taskId, "receipt", { leaseToken: lease.leaseToken, status: "succeeded", result: { text: "x".repeat(128 * 1024) } }), /task_result_too_large/);
  await f.service.updateTask("owner", f.desktop, lease.taskId, "receipt", { leaseToken: lease.leaseToken, status: "cancelled" });
  const task = (await f.service.list("owner", "mobile", f.mobile)).tasks[0]; assert.equal(task.status, "cancelled"); assert.equal("leaseToken" in task, false);
});

test("outbox cancellation resolves an unknown send atomically without scheduling a new execution", async () => {
  const f = await fixture(); const operationId = randomUUID();
  const cancelled = await f.enqueue({ operationId, cancelRequested: true });
  assert.equal(cancelled.task.status, "cancelled"); assert.equal((await f.service.claim("owner", f.desktop)).task, null);
  const first = await f.enqueue();
  const resolved = await f.enqueue({ operationId: first.task.operationId, cancelRequested: true });
  assert.equal(resolved.task.taskId, first.task.taskId); assert.equal(resolved.task.status, "cancelled");
  const pair = (await f.service.list("owner", "mobile", f.mobile)).pairs[0];
  await f.service.revokePair("owner", "desktop", f.desktop, pair.pairId);
  assert.equal((await f.enqueue({ operationId, cancelRequested: true })).replayed, true);
});

test("an old offline request cannot recreate a task after retained receipts expire", async () => {
  const f = await fixture();
  await assert.rejects(() => f.enqueue({ createdAt: 1_000_000 - 8 * 86_400_000 }), /task_request_expired/);
  assert.equal((await f.service.claim("owner", f.desktop)).task, null);
});

test("polling omits large result text and only a task's paired participants can fetch it", async () => {
  const f = await fixture(); await f.enqueue(); const task = (await f.service.claim("owner", f.desktop)).task;
  await f.service.updateTask("owner", f.desktop, task.taskId, "start", task);
  const result = { message: "提取完成", text: "正文".repeat(20_000) };
  await assert.rejects(() => f.service.updateTask("owner", f.desktop, task.taskId, "receipt", { ...task, status: "succeeded", result: { message: {} } }), /task_result_invalid/);
  await f.service.updateTask("owner", f.desktop, task.taskId, "receipt", { ...task, status: "succeeded", result });
  const snapshot = await f.service.list("owner", "mobile", f.mobile);
  assert.equal(snapshot.tasks[0].result.hasText, true); assert.equal(snapshot.tasks[0].result.text, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 10_000);
  assert.deepEqual((await f.service.getTask("owner", "mobile", f.mobile, task.taskId)).task.result, result);
  assert.deepEqual((await f.service.getTask("owner", "desktop", f.desktop, task.taskId)).task.result, result);
  const other = { ...f.mobile, deviceId: randomUUID(), secret: randomBytes(32).toString("base64url") };
  await f.service.register("owner", "mobile", other);
  await assert.rejects(() => f.service.getTask("owner", "mobile", other, task.taskId), /task_not_found/);
});
