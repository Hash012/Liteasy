import { invoke, isTauri } from "@tauri-apps/api/core";

type Scope = "artifact-tasks" | "thin-reading" | "paper-services";
const cache = new Map<Scope, Record<string, unknown>>();
const pending = new Map<Scope, Promise<Record<string, unknown>>>();
type WriterState = { revision: number; savedRevision: number; flushing?: Promise<void> };
const writers = new Map<Scope, WriterState>();
async function browserRead(scope: Scope) {
  return JSON.parse(localStorage.getItem(`liteasy.checkpoints.v1:${scope}`) ?? "{}");
}
export async function loadDurableEntries(scope: Scope): Promise<Record<string, unknown>> {
  if (cache.has(scope)) return cache.get(scope)!;
  if (!pending.has(scope)) pending.set(scope, (isTauri()
    ? invoke<Record<string, unknown>>("load_workflow_checkpoints", { scope }) : browserRead(scope)
  ).then((data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("工作流检查点格式无效，已保留原文件。");
    cache.set(scope, data); return data;
  }).finally(() => { pending.delete(scope); }));
  return pending.get(scope)!;
}
export async function putDurableEntry(scope: Scope, key: string, value: unknown) {
  const entries = await loadDurableEntries(scope);
  if (value === undefined) delete entries[key];
  else entries[key] = structuredClone(value);
  const writer = writers.get(scope) ?? { revision: 0, savedRevision: 0 };
  writers.set(scope, writer);
  writer.revision += 1;
  // Keep one active write and one latest cached state, instead of queuing a full
  // checkpoint serialization for every streaming token while disk/IPC is busy.
  writer.flushing ??= Promise.resolve().then(async () => {
    try {
      while (writer.savedRevision < writer.revision) {
        const savingRevision = writer.revision;
        const snapshot = structuredClone(entries);
        if (isTauri()) await invoke("save_workflow_checkpoints", { scope, snapshot });
        else localStorage.setItem(`liteasy.checkpoints.v1:${scope}`, JSON.stringify(snapshot));
        writer.savedRevision = savingRevision;
      }
    } finally {
      writer.flushing = undefined;
    }
  });
  return writer.flushing;
}
