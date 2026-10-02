import { invoke, isTauri } from "@tauri-apps/api/core";

export type RecoveryPreview = { planId: string; targetPath: string; restored: boolean; scopeId: string; fileCount: number; totalBytes: number; exclusions: string[] };
export type RecoveryReceipt = { receiptId: string; path: string; restored: boolean; scopeId: string };
type Transport = (command: string, args: Record<string, unknown>) => Promise<unknown>;
export function createLocalRecoveryService(scope: string, currentScope: () => string, transport: Transport = invoke) {
  function check() { if (currentScope() !== scope) throw new Error("账户已切换，请重新预览恢复操作。"); }
  const cancel = (planId: string) => transport("local_recovery_cancel", { scope, planId }).then(() => undefined);
  async function prepare(kind: "backup" | "restore") {
    check();
    const result = await transport(`local_recovery_prepare_${kind}`, { scope }) as RecoveryPreview | null;
    if (currentScope() !== scope) { if (result) await cancel(result.planId); check(); }
    return result;
  }
  return {
    prepare, cancel,
    async commit(planId: string) { check(); const result = await transport("local_recovery_commit", { scope, planId }) as RecoveryReceipt; check(); return result; },
    async openProfile(receiptId: string) { check(); await transport("local_recovery_open_profile", { scope, receiptId }); check(); }
  };
}
export type LocalRecoveryService = ReturnType<typeof createLocalRecoveryService>;
export const isLocalRecoveryAvailable = isTauri;
