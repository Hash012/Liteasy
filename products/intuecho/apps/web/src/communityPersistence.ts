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
  payload?: Record<string, unknown>;
};
export type LocalDraft<T> = { version: 1; owner: string; scope: string; updatedAt: string; value: T };

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
export function saveDraft<T>(owner: string, scope: string, value: T) {
  const draft: LocalDraft<T> = { version: 1, owner, scope, updatedAt: new Date().toISOString(), value };
  persist(key(owner, "draft", scope), draft, "草稿尚未保存：浏览器存储不可用或空间不足。请保留此窗口。 ");
  return draft;
}
export function loadDraft<T>(owner: string, scope: string): LocalDraft<T> | null {
  if (!owner) return null;
  const value = localStorage.getItem(key(owner, "draft", scope));
  if (!value) return null;
  try {
    const draft = JSON.parse(value);
    return draft.version === 1 && draft.owner === owner && draft.scope === scope ? draft : null;
  } catch { return null; }
}
export function removeDraft(owner: string, scope: string) {
  localStorage.removeItem(key(owner, "draft", scope));
  window.dispatchEvent(new Event(communityStorageChanged));
}
export function commandRecords(owner: string): CommandRecord[] {
  if (!owner) return [];
  const start = `${prefix}${encodeURIComponent(owner)}:command:`;
  const records: CommandRecord[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith(start)) continue;
    try {
      const record = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (record?.owner === owner && record.version === 1) records.push(record.value);
    } catch { /* A damaged record is never sent automatically. */ }
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function saveCommand(owner: string, record: CommandRecord) {
  persist(key(owner, "command", `${record.operationType}:${record.operationId}`), { version: 1, owner, value: record }, "操作记录未能保存，尚未发送；请检查浏览器存储。 ");
}
