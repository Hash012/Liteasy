import { invoke, isTauri } from "@tauri-apps/api/core";

type Scope = "artifact-tasks" | "thin-reading" | "paper-services";
const cache = new Map<Scope, Record<string, unknown>>();
const pending = new Map<Scope, Promise<Record<string, unknown>>>();
let queue = Promise.resolve();
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
  queue = queue.catch(() => {}).then(async () => {
    const snapshot = structuredClone(entries);
    if (isTauri()) await invoke("save_workflow_checkpoints", { scope, snapshot });
    else localStorage.setItem(`liteasy.checkpoints.v1:${scope}`, JSON.stringify(snapshot));
  });
  return queue;
}
