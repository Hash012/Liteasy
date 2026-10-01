import { nativeRequest, hasNativeHost } from "../../platform/native";
export type SyncSettings = { endpoint: string; username: string; collection: string; autoSync: boolean; wifiOnly: boolean; hasPassword?: boolean };
export type SyncVersion = { hash: string; size: number; documentId?: string | null };
export type SyncConflict = { path: string; local: SyncVersion | null; remote: SyncVersion | null };
export type SyncStatus = { state: "queued" | "running" | "complete" | "conflict" | "error"; phase?: string; completed?: number; total?: number; uploaded?: number; downloaded?: number; error?: string; finishedAt?: string; conflicts?: SyncConflict[]; deferredOpenDocument?: boolean };
export const syncClient = {
  available: hasNativeHost,
  settings: (scope: string) => nativeRequest<SyncSettings | null>("syncSettings", { scope }),
  configure: (scope: string, settings: SyncSettings & { password: string }) => nativeRequest<void>("configureSync", { scope, settings }),
  status: (scope: string) => nativeRequest<SyncStatus | null>("syncStatus", { scope }),
  start: (scope: string) => nativeRequest<void>("startSync", { scope }),
  cancel: (scope: string) => nativeRequest<void>("cancelSync", { scope }),
  resolve: (scope: string, path: string, keepLocal: boolean) => nativeRequest<void>("resolveSync", { scope, path, keepLocal })
};
