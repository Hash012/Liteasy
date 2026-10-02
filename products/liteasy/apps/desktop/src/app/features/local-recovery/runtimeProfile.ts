import { invoke, isTauri } from "@tauri-apps/api/core";

export type RecoveryRuntime = Readonly<{ scopeId: string; localOnly: true; recovery: true }>;
let runtime: RecoveryRuntime | null = null;
/** Called once before app modules or account restoration. Values come from the native validated profile. */
export async function initializeRuntimeProfile(call: typeof invoke = invoke, native = isTauri()) {
  if (!native) return null;
  const value = await call<unknown>("local_runtime_profile");
  if (value === null) { runtime = null; return null; }
  if (!value || typeof value !== "object") throw new Error("恢复配置启动信息无效。");
  const record = value as Record<string, unknown>;
  if (record.localOnly !== true || record.recovery !== true || typeof record.scopeId !== "string" ||
    !(record.scopeId === "local" || record.scopeId.startsWith("user:") && record.scopeId.length > 5 && new TextEncoder().encode(record.scopeId).length <= 512 && !/[\u0000-\u001f\u007f-\u009f]/.test(record.scopeId))) throw new Error("恢复配置作用域无效。");
  runtime = Object.freeze({ scopeId: record.scopeId, localOnly: true, recovery: true });
  return runtime;
}
export function getRecoveryRuntime() { return runtime; }
export function localWorkspaceScope(subject?: string) { return runtime?.scopeId ?? (subject ? `user:${subject}` : "local"); }
