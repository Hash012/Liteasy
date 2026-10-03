import type { IdentitySession } from "./identity.types";
import { intuechoApiBaseUrl } from "./runtimeConfig";

const prefix = "intuecho.community.local.v1:";
export const communityStorageChanged = "intuecho-community-storage-changed";
export type CommandRecord = {
  operationId: string;
  operationType: "create_annotation" | "create_reply";
  bodyDigest: string;
  targetId: string | null;
  state: "prepared" | "outcome_unknown" | "committed" | "rejected";
  updatedAt: string;
  resourceId?: string;
  draftId?: string;
  draftScope?: string;
  payload?: Record<string, unknown>;
};
export type LocalDraft<T> = {
  version: 2; owner: string; scope: string; draftId: string; localRevision: number; writerId: string;
  updatedAt: string; value: T; conflictOf?: string; legacy?: boolean;
};
export type DraftWriteOptions = { draftId: string; expectedRevision: number; writerId: string };
export type QuarantinedRecord = { storageKey: string; raw: string; reason: string };
const draftFailure = "草稿尚未保存：浏览器存储不可用或空间不足。请保留此窗口。";

// Runtime generations fence in-flight work; persistent ownership survives a new login.
export function draftOwner(session: IdentitySession | null, environment = intuechoApiBaseUrl) {
  return session ? JSON.stringify([environment, session.issuer ?? `identity:${environment}`, session.userId, session.audience]) : "";
}
function key(owner: string, kind: string, scope: string) {
  if (!owner) throw new Error("请先确认当前账号，再保存或恢复本机草稿。");
  return `${prefix}${encodeURIComponent(owner)}:${kind}:${encodeURIComponent(scope)}`;
}
function persist(storageKey: string, value: unknown, message: string) {
  try {
    const serialized = JSON.stringify(value);
    localStorage.setItem(storageKey, serialized);
    if (localStorage.getItem(storageKey) !== serialized) throw new Error("Storage verification failed");
    window.dispatchEvent(new Event(communityStorageChanged));
  } catch { throw new Error(message); }
}
function storageKeys(owner: string, kind: string) {
  if (!owner) return [];
  const start = `${prefix}${encodeURIComponent(owner)}:${kind}:`;
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter((value): value is string => Boolean(value?.startsWith(start)));
}
function draftKey(owner: string, scope: string, draftId: string) { return key(owner, "draft", JSON.stringify([scope, draftId])); }
function parseDraft<T>(owner: string, storageKey: string, raw: string): LocalDraft<T> {
  const value = JSON.parse(raw);
  if (!value || value.owner !== owner || typeof value.scope !== "string" || typeof value.updatedAt !== "string" || !("value" in value)) throw new Error("Invalid draft envelope");
  if (value.version === 1 && storageKey === key(owner, "draft", value.scope)) {
    return { ...value, version: 2, draftId: `legacy:${value.scope}`, localRevision: 1, writerId: "legacy", legacy: true };
  }
  if (value.version !== 2 || typeof value.draftId !== "string" || !value.draftId || typeof value.writerId !== "string" ||
    !Number.isSafeInteger(value.localRevision) || value.localRevision < 1 || storageKey !== draftKey(owner, value.scope, value.draftId)) throw new Error("Invalid draft revision");
  return value;
}
export function draftRecords<T = unknown>(owner: string, scope?: string): LocalDraft<T>[] {
  const records: LocalDraft<T>[] = [];
  for (const storageKey of storageKeys(owner, "draft")) {
    try {
      const draft = parseDraft<T>(owner, storageKey, localStorage.getItem(storageKey) ?? "");
      if (scope === undefined || draft.scope === scope) records.push(draft);
    } catch { /* Logically quarantined in place, available to explicit raw export. */ }
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.localRevision - a.localRevision);
}
export function loadDraft<T>(owner: string, scope: string, draftId?: string): LocalDraft<T> | null {
  return draftRecords<T>(owner, scope).find((draft) => draftId === undefined || draft.draftId === draftId) ?? null;
}
// Synchronous primitive for migration/tests. Editors use saveDraftRevision under
// Web Locks; a fresh caller with no draft identity always creates an independent draft.
export function saveDraft<T>(owner: string, scope: string, value: T, options?: DraftWriteOptions): LocalDraft<T> {
  const draftId = options?.draftId ?? crypto.randomUUID();
  const previous = loadDraft<T>(owner, scope, draftId);
  const corruptExisting = !previous && localStorage.getItem(draftKey(owner, scope, draftId)) !== null;
  const conflict = corruptExisting || (options && (previous?.localRevision ?? 0) !== options.expectedRevision);
  const draft: LocalDraft<T> = { version: 2, owner, scope, draftId: conflict || previous?.legacy ? crypto.randomUUID() : draftId,
    localRevision: conflict || previous?.legacy ? 1 : (previous?.localRevision ?? 0) + 1,
    writerId: options?.writerId ?? crypto.randomUUID(), updatedAt: new Date().toISOString(), value,
    ...(conflict ? { conflictOf: draftId } : {}) };
  persist(draftKey(owner, scope, draft.draftId), draft, draftFailure);
  return draft;
}
export function saveDraftRevision<T>(owner: string, scope: string, value: T, options: DraftWriteOptions): Promise<LocalDraft<T>> {
  return withCommunityLock(`draft:${owner}:${scope}:${options.draftId}`, () => saveDraft(owner, scope, value, options));
}
export function removeDraft(owner: string, scope: string, expected?: LocalDraft<unknown>): boolean {
  if (!expected || expected.owner !== owner || expected.scope !== scope) return false;
  const storageKey = expected.legacy ? key(owner, "draft", scope) : draftKey(owner, scope, expected.draftId);
  const raw = localStorage.getItem(storageKey);
  if (!raw) return false;
  let current: LocalDraft<unknown>;
  try { current = parseDraft(owner, storageKey, raw); } catch { return false; }
  if (current.draftId !== expected.draftId || current.localRevision !== expected.localRevision || JSON.stringify(current.value) !== JSON.stringify(expected.value)) return false;
  localStorage.removeItem(storageKey);
  window.dispatchEvent(new Event(communityStorageChanged));
  return true;
}
export function removeDraftRevision(owner: string, scope: string, expected: LocalDraft<unknown>): Promise<boolean> {
  return withCommunityLock(`draft:${owner}:${scope}:${expected.draftId}`, () => removeDraft(owner, scope, expected));
}
function parseCommand(owner: string, storageKey: string, raw: string): CommandRecord {
  const envelope = JSON.parse(raw);
  const record = envelope?.value;
  if (envelope?.owner !== owner || envelope.version !== 1 || !record || typeof record.operationId !== "string" || !record.operationId ||
    typeof record.bodyDigest !== "string" || !/^[a-f0-9]{64}$/.test(record.bodyDigest) ||
    !["create_annotation", "create_reply"].includes(record.operationType) ||
    !["prepared", "outcome_unknown", "committed", "rejected"].includes(record.state) ||
    !(record.targetId === null || typeof record.targetId === "string") || typeof record.updatedAt !== "string" ||
    (record.resourceId !== undefined && (typeof record.resourceId !== "string" || !record.resourceId)) ||
    (record.payload !== undefined && (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload))) ||
    storageKey !== key(owner, "command", `${record.operationType}:${record.operationId}`)) throw new Error("Invalid command record");
  return record;
}
export function commandRecords(owner: string): CommandRecord[] {
  const records: CommandRecord[] = [];
  for (const storageKey of storageKeys(owner, "command")) {
    try { records.push(parseCommand(owner, storageKey, localStorage.getItem(storageKey) ?? "")); }
    catch { /* One quarantined record cannot hide unrelated healthy work. */ }
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function quarantinedRecords(owner: string): QuarantinedRecord[] {
  const records: QuarantinedRecord[] = [];
  for (const kind of ["draft", "command", "completed"] as const) for (const storageKey of storageKeys(owner, kind)) {
    const raw = localStorage.getItem(storageKey) ?? "";
    try { if (kind === "draft") parseDraft(owner, storageKey, raw); else if (kind === "command") parseCommand(owner, storageKey, raw); else parseCompleted(raw); }
    catch { records.push({ storageKey, raw, reason: kind === "draft" ? "草稿格式损坏，原件已隔离" : "操作格式损坏，禁止重放，原件已隔离" }); }
  }
  return records;
}
export function exportCommunityRecords(owner: string) {
  const keys = ["draft", "command", "completed"].flatMap((kind) => storageKeys(owner, kind));
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), records: keys.map((storageKey) => ({ storageKey, raw: localStorage.getItem(storageKey) })) }, null, 2);
}
export function communityStorageUsage(owner: string) {
  const keys = ["draft", "command", "completed"].flatMap((kind) => storageKeys(owner, kind));
  const bytes = keys.reduce((sum, storageKey) => sum + (storageKey.length + (localStorage.getItem(storageKey)?.length ?? 0)) * 2, 0);
  return { bytes, approachingCapacity: bytes >= 4 * 1024 * 1024, archivedCount: storageKeys(owner, "completed").length };
}
// Keep at most 100 full completed records. A compact tombstone retains the
// immutable intent forever, so an old restored draft can never become a new send.
// Unknown/rejected bodies and drafts are never evicted to make room.
export function archiveCompletedCommands(owner: string, limit = 100) {
  for (const record of commandRecords(owner).filter((record) => record.state === "committed" && !record.payload).slice(limit)) {
    const source = key(owner, "command", `${record.operationType}:${record.operationId}`);
    const raw = localStorage.getItem(source);
    persist(key(owner, "completed", `${record.operationType}:${record.operationId}`),
      [record.bodyDigest, record.resourceId ?? null, record.updatedAt, record.targetId], "已完成回执无法归档，原记录仍保留。");
    if (localStorage.getItem(source) === raw) localStorage.removeItem(source);
  }
}
export function saveCommand(owner: string, record: CommandRecord) {
  persist(key(owner, "command", `${record.operationType}:${record.operationId}`), { version: 1, owner, value: record }, "操作记录未能保存，尚未发送；请检查浏览器存储。 ");
  if (record.state === "committed") { try { archiveCompletedCommands(owner); } catch { /* Preserve the successful durable receipt if archival has no capacity. */ } }
}

function parseCompleted(raw: string): [string, string | null, string, string | null] {
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || value.length !== 4 || typeof value[0] !== "string" || !/^[a-f0-9]{64}$/.test(value[0]) ||
    !(value[1] === null || typeof value[1] === "string") || typeof value[2] !== "string" || !(value[3] === null || typeof value[3] === "string")) throw new Error("Invalid tombstone");
  return value as [string, string | null, string, string | null];
}
export function readCommand(owner: string, operationType: CommandRecord["operationType"], operationId: string): CommandRecord | null {
  const storageKey = key(owner, "command", `${operationType}:${operationId}`);
  const raw = localStorage.getItem(storageKey);
  if (raw === null) {
    const completed = localStorage.getItem(key(owner, "completed", `${operationType}:${operationId}`));
    if (completed === null) return null;
    try {
      const value = parseCompleted(completed);
      return { operationId, operationType, bodyDigest: value[0], targetId: value[3], state: "committed", updatedAt: value[2], ...(value[1] ? { resourceId: value[1] } : {}) };
    } catch { throw new Error("原操作的归档记录损坏，已隔离保留，不可重放。"); }
  }
  try { return parseCommand(owner, storageKey, raw); }
  catch { throw new Error("原操作记录已损坏，已隔离保留；不可重放此操作。请从操作中心导出原件核实。"); }
}

export function withCommunityLock<T>(name: string, callback: () => T | Promise<T>): Promise<T> {
  if (!navigator.locks) return Promise.reject(new Error("此浏览器无法安全保存跨窗口发送操作，请更新浏览器后重试。"));
  return navigator.locks.request(`intuecho:${name}`, callback) as Promise<T>;
}

// Compare the complete persisted snapshot inside a cross-window lock. Time stamps
// alone are not revisions: two writes can occur in the same millisecond.
export function transitionCommand(owner: string, expected: CommandRecord, next: CommandRecord): Promise<CommandRecord | null> {
  return withCommunityLock(`command:${owner}:${expected.operationType}:${expected.operationId}`, () => {
    const current = readCommand(owner, expected.operationType, expected.operationId);
    if (!current) return null;
    // A verified commit is an irreversible server fact for the same frozen intent,
    // even when a concurrent lookup briefly observed not_found.
    if (next.state === "committed" && current.bodyDigest === expected.bodyDigest && current.targetId === expected.targetId) {
      if (current.state === "committed") return current;
      saveCommand(owner, next);
      return next;
    }
    if (JSON.stringify(current) !== JSON.stringify(expected)) return current;
    const allowed: Record<CommandRecord["state"], CommandRecord["state"][]> = {
      prepared: ["outcome_unknown"], outcome_unknown: ["prepared", "committed", "rejected"], committed: [], rejected: []
    };
    if (!allowed[current.state].includes(next.state)) return current;
    saveCommand(owner, next);
    return next;
  });
}
