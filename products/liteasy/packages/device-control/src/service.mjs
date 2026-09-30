import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

export const deviceCapabilities = Object.freeze(["open-document", "extract-text", "summarize-document", "sync-library"]);
const terminal = new Set(["succeeded", "failed", "cancelled"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const equal = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class DeviceControlError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status = 400) => { throw new DeviceControlError(code, status); };
const requireValue = (condition, code, status = 400) => { if (!condition) fail(code, status); };
function text(value, maximum, code = "device_input_invalid") {
  requireValue(typeof value === "string" && value.trim().length > 0 && value.length <= maximum, code);
  return value.trim();
}
function id(value) { requireValue(typeof value === "string" && uuid.test(value), "device_id_invalid"); return value; }
function capabilities(values, kind) {
  requireValue(Array.isArray(values) && values.length <= deviceCapabilities.length && values.every((value) => deviceCapabilities.includes(value)), "device_capabilities_invalid");
  return kind === "mobile" ? [] : [...new Set(values)].sort();
}
export function emptyDeviceState() { return { version: 1, devices: {}, pairs: {}, tasks: {}, pairAttempts: { at: 0, count: 0 } }; }
function publicDevice(device, now) { return { deviceId: device.deviceId, name: device.name, kind: device.kind, capabilities: device.capabilities,
  online: !device.revokedAt && now - device.lastSeen < 90_000, lastSeen: device.lastSeen, revokedAt: device.revokedAt ?? null }; }
function publicTask(task) {
  const { leaseToken: _token, requestHash: _hash, ...value } = task;
  return structuredClone(value);
}
function expire(state, now) {
  for (const device of Object.values(state.devices)) if (device.challenge?.expiresAt <= now) delete device.challenge;
  for (const task of Object.values(state.tasks)) {
    if (task.status === "leased" && task.leaseUntil <= now) {
      task.status = task.attempt >= 5 ? "failed" : "queued"; task.error = "desktop_lease_expired"; task.updatedAt = now;
      delete task.leaseToken; delete task.leaseUntil;
    } else if (task.status === "running" && task.leaseUntil <= now) {
      task.status = "uncertain"; task.error = "desktop_completion_unknown"; task.updatedAt = now;
    } else if (["queued", "waiting-input"].includes(task.status) && task.expiresAt <= now) {
      task.status = "failed"; task.error = "task_expired"; task.updatedAt = now;
    }
    if (terminal.has(task.status) && now - task.updatedAt > 14 * 86_400_000) delete state.tasks[task.taskId];
  }
}
function deviceFor(state, auth, kind, now) {
  const device = state.devices[id(auth.deviceId)];
  requireValue(device && !device.revokedAt && device.kind === kind && typeof auth.secret === "string" && equal(device.secretHash, hash(auth.secret)), "device_unauthorized", 403);
  device.lastSeen = now;
  return device;
}
function pairFor(state, mobileId, desktopId) { return Object.values(state.pairs).find((pair) => !pair.revokedAt && pair.mobileId === mobileId && pair.desktopId === desktopId); }
function taskFor(state, taskId, device, ownerKind) {
  const task = state.tasks[id(taskId)];
  requireValue(task && task[ownerKind === "mobile" ? "mobileId" : "desktopId"] === device.deviceId, "task_not_found", 404);
  return task;
}
function payload(input) {
  requireValue(deviceCapabilities.includes(input.kind), "task_kind_invalid");
  const document = input.kind === "sync-library" ? null : input.document;
  if (document != null) {
    requireValue(typeof document.documentId === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(document.documentId) && /^[a-f0-9]{64}$/.test(document.contentHash ?? ""), "task_document_invalid");
  } else requireValue(input.kind === "sync-library", "task_document_required");
  return { kind: input.kind, document: document ? { documentId: document.documentId, contentHash: document.contentHash, title: text(document.title, 1024) } : null };
}

/** Storage adapters provide an atomic, durable transaction for one verified account. No transport or model execution occurs under the lock. */
export class DeviceControlService {
  constructor(store, { now = Date.now } = {}) { this.store = store; this.now = now; }
  async transaction(subject, operation) {
    text(subject, 512, "identity_subject_invalid");
    const result = await this.store.transaction(subject, (state) => {
      requireValue(state.version === 1, "device_state_version_unsupported", 409);
      const now = this.now(); expire(state, now);
      // Expected failures still persist expiry/rate-limit changes; an exception cannot reset brute-force counters.
      try { return { value: operation(state, now) }; }
      catch (error) { if (error instanceof DeviceControlError) return { error: { code: error.code, status: error.status } }; throw error; }
    });
    if (result.error) throw new DeviceControlError(result.error.code, result.error.status);
    return result.value;
  }
  async register(subject, kind, input) {
    requireValue(kind === "mobile" || kind === "desktop", "device_kind_invalid");
    id(input.deviceId); requireValue(typeof input.secret === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(input.secret), "device_secret_invalid");
    const name = text(input.name, 100); const supported = capabilities(input.capabilities ?? [], kind);
    return this.transaction(subject, (state, now) => {
      const existing = state.devices[input.deviceId];
      if (existing) {
        deviceFor(state, input, kind, now);
        return { device: publicDevice(existing, now) };
      }
      requireValue(Object.values(state.devices).filter((device) => !device.revokedAt).length < 20 && Object.keys(state.devices).length < 100, "device_limit_reached", 409);
      const device = { deviceId: input.deviceId, secretHash: hash(input.secret), kind, name, capabilities: supported, lastSeen: now, createdAt: now };
      state.devices[device.deviceId] = device;
      return { device: publicDevice(device, now) };
    });
  }
  heartbeat(subject, kind, auth, input) { return this.transaction(subject, (state, now) => {
    const device = deviceFor(state, auth, kind, now);
    if (input.name !== undefined) device.name = text(input.name, 100);
    if (input.capabilities !== undefined) device.capabilities = capabilities(input.capabilities, kind);
    return { device: publicDevice(device, now) };
  }); }
  pairCode(subject, auth) { return this.transaction(subject, (state, now) => {
    const device = deviceFor(state, auth, "desktop", now);
    requireValue(!device.lastChallengeAt || now - device.lastChallengeAt >= 10_000, "pair_code_rate_limited", 429);
    const code = String(randomInt(100_000_000)).padStart(8, "0"); const salt = randomBytes(16).toString("hex");
    device.challenge = { hash: hash(`${salt}:${code}`), salt, expiresAt: now + 5 * 60_000 }; device.lastChallengeAt = now;
    return { code, expiresAt: device.challenge.expiresAt, device: publicDevice(device, now) };
  }); }
  pair(subject, auth, input) { return this.transaction(subject, (state, now) => {
    const device = deviceFor(state, auth, "mobile", now);
    requireValue(typeof input.code === "string" && /^\d{8}$/.test(input.code), "pair_code_invalid");
    if (now - state.pairAttempts.at > 10 * 60_000) state.pairAttempts = { at: now, count: 0 };
    requireValue(state.pairAttempts.count < 6, "pair_attempts_limited", 429); state.pairAttempts.count++;
    const desktop = Object.values(state.devices).find((candidate) => candidate.kind === "desktop" && !candidate.revokedAt && candidate.challenge?.expiresAt > now && equal(candidate.challenge.hash, hash(`${candidate.challenge.salt}:${input.code}`)));
    requireValue(desktop, "pair_code_invalid", 404);
    delete desktop.challenge;
    const existing = pairFor(state, device.deviceId, desktop.deviceId);
    const pair = existing ?? { pairId: randomUUID(), mobileId: device.deviceId, desktopId: desktop.deviceId, createdAt: now };
    state.pairs[pair.pairId] = pair;
    return { pair: structuredClone(pair), desktop: publicDevice(desktop, now) };
  }); }
  list(subject, kind, auth) { return this.transaction(subject, (state, now) => {
    const device = deviceFor(state, auth, kind, now);
    const pairs = Object.values(state.pairs).filter((pair) => !pair.revokedAt && (kind === "mobile" ? pair.mobileId : pair.desktopId) === device.deviceId);
    const peers = new Set(pairs.map((pair) => kind === "mobile" ? pair.desktopId : pair.mobileId));
    return { device: publicDevice(device, now), pairs: structuredClone(pairs), devices: Object.values(state.devices).filter((peer) => peers.has(peer.deviceId)).map((peer) => publicDevice(peer, now)),
      tasks: Object.values(state.tasks).filter((task) => task[kind === "mobile" ? "mobileId" : "desktopId"] === device.deviceId).sort((a,b) => b.createdAt - a.createdAt).map(publicTask) };
  }); }
  revokePair(subject, kind, auth, pairId) { return this.transaction(subject, (state, now) => {
    const device = deviceFor(state, auth, kind, now); const pair = state.pairs[id(pairId)];
    requireValue(pair && pair[kind === "mobile" ? "mobileId" : "desktopId"] === device.deviceId, "pair_not_found", 404);
    pair.revokedAt ??= now;
    for (const task of Object.values(state.tasks)) if (task.pairId === pairId && !terminal.has(task.status)) {
      task.cancelRequested = true; if (!["running", "uncertain"].includes(task.status)) task.status = "cancelled"; task.updatedAt = now;
    }
    return { revoked: true };
  }); }
  async enqueue(subject, auth, input) {
    const request = payload(input); id(input.operationId); id(input.desktopId);
    return this.transaction(subject, (state, now) => {
      const mobile = deviceFor(state, auth, "mobile", now); const pair = pairFor(state, mobile.deviceId, input.desktopId);
      const requestHash = hash(JSON.stringify({ desktopId: input.desktopId, ...request }));
      const existing = Object.values(state.tasks).find((task) => task.mobileId === mobile.deviceId && task.operationId === input.operationId);
      if (existing) {
        requireValue(existing.requestHash === requestHash, "task_operation_reused", 409);
        if (input.cancelRequested === true && !terminal.has(existing.status)) {
          existing.cancelRequested = true; if (!["running", "uncertain"].includes(existing.status)) existing.status = "cancelled"; existing.updatedAt = now;
        }
        return { task: publicTask(existing), replayed: true };
      }
      requireValue(pair, "device_pair_required", 403);
      const desktop = state.devices[input.desktopId]; requireValue(desktop && !desktop.revokedAt && desktop.capabilities.includes(request.kind), "desktop_capability_unavailable", 409);
      // An offline outbox must not recreate a task after its retained receipt was purged.
      requireValue(input.createdAt === undefined || (Number.isFinite(input.createdAt) && now - input.createdAt < 7 * 86_400_000 && input.createdAt <= now + 300_000), "task_request_expired", 409);
      requireValue(Object.keys(state.tasks).length < 200 && Object.values(state.tasks).filter((task) => !terminal.has(task.status)).length < 50, "task_queue_full", 409);
      const task = { taskId: randomUUID(), operationId: input.operationId, pairId: pair.pairId, mobileId: mobile.deviceId, desktopId: desktop.deviceId,
        ...request, requestHash, status: input.cancelRequested === true ? "cancelled" : "queued", attempt: 0, cancelRequested: input.cancelRequested === true, createdAt: now, updatedAt: now, expiresAt: now + 86_400_000 };
      state.tasks[task.taskId] = task; return { task: publicTask(task), replayed: false };
    });
  }
  claim(subject, auth) { return this.transaction(subject, (state, now) => {
    const device = deviceFor(state, auth, "desktop", now);
    // One active operation per desktop; a polling race cannot start two tasks.
    if (Object.values(state.tasks).some((task) => task.desktopId === device.deviceId && ["leased", "running"].includes(task.status))) return { task: null };
    const task = Object.values(state.tasks).filter((task) => task.desktopId === device.deviceId && ["queued", "waiting-input"].includes(task.status) && (task.retryAt ?? 0) <= now && !task.cancelRequested &&
      device.capabilities.includes(task.kind) && pairFor(state, task.mobileId, device.deviceId)).sort((a,b) => a.createdAt - b.createdAt)[0];
    if (!task) return { task: null };
    task.status = "leased"; task.attempt++; task.leaseToken = randomBytes(32).toString("base64url"); task.leaseUntil = now + 90_000; task.updatedAt = now;
    return { task: { ...publicTask(task), leaseToken: task.leaseToken } };
  }); }
  updateTask(subject, auth, taskId, action, input) { return this.transaction(subject, (state, now) => {
    const device = deviceFor(state, auth, "desktop", now); const task = taskFor(state, taskId, device, "desktop");
    requireValue(equal(task.leaseToken, input.leaseToken), "task_lease_invalid", 409);
    if (action === "receipt" && terminal.has(task.status)) return { task: publicTask(task), replayed: true };
    requireValue(!terminal.has(task.status), "task_already_finished", 409);
    if (action === "start") {
      requireValue(task.status === "leased" && !task.cancelRequested && task.leaseUntil > now && pairFor(state, task.mobileId, task.desktopId), "task_start_rejected", 409);
      task.status = "running"; task.startedAt = now; task.leaseUntil = now + 120_000;
    } else if (action === "defer") {
      requireValue(task.status === "leased" && !task.cancelRequested, "task_defer_rejected", 409);
      task.status = "waiting-input"; task.error = "document_not_ready"; task.retryAt = now + 60_000; delete task.leaseToken; delete task.leaseUntil;
    } else if (action === "progress") {
      requireValue(task.status === "running", "task_progress_rejected", 409);
      requireValue(Number.isInteger(input.progress) && input.progress >= 0 && input.progress <= 100, "task_progress_invalid");
      task.progress = input.progress; task.leaseUntil = now + 120_000;
    } else if (action === "receipt") {
      requireValue(["running", "uncertain"].includes(task.status), "task_receipt_rejected", 409);
      requireValue(["succeeded", "failed", "cancelled", "uncertain"].includes(input.status), "task_receipt_invalid");
      requireValue(input.result === undefined || (input.result && typeof input.result === "object" && !Array.isArray(input.result) && Buffer.byteLength(JSON.stringify(input.result)) <= 128 * 1024), "task_result_too_large", 413);
      task.status = input.status; task.result = input.result ?? null; task.error = input.error ? text(input.error, 2000, "task_error_invalid") : null; task.finishedAt = now;
    } else fail("task_action_invalid");
    task.updatedAt = now;
    return { task: publicTask(task), cancelRequested: task.cancelRequested };
  }); }
  cancel(subject, auth, taskId) { return this.transaction(subject, (state, now) => {
    const mobile = deviceFor(state, auth, "mobile", now); const task = taskFor(state, taskId, mobile, "mobile");
    if (!terminal.has(task.status)) { task.cancelRequested = true; if (!["running", "uncertain"].includes(task.status)) task.status = "cancelled"; task.updatedAt = now; }
    return { task: publicTask(task) };
  }); }
}
