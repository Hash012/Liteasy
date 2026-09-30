import { invoke, isTauri } from "@tauri-apps/api/core";
import { exportWebDavPreferences, webDavCredentialDescriptors } from "./webdavPreferences";
import { listen } from "@tauri-apps/api/event";

export const defaultSyncOptions = { library: true, annotations: true, workspace: true, history: true, preferences: true, externalFolders: false, apiKeys: false, extensionPackages: false, extensionConfiguration: false, extensionWorkflows: false, extensionRuns: false, extensionSnapshots: false };
export type SyncOptions = typeof defaultSyncOptions;
export type WebDavSettings = { endpoint: string; username: string; collection: string; autoSync: boolean; sync?: SyncOptions };
export type FileVersion = { hash: string; size: number; documentId: string | null };
export type WebDavConflict = { path: string; remotePath?: string; local: FileVersion | null; remote: FileVersion | null };
export type WebDavResolution = { conflict: WebDavConflict; choice: "local" | "remote" };
export type WebDavResult = { uploaded: number; downloaded: number; deleted: number; conflicts: WebDavConflict[]; deferred?: string[]; restartRequired?: boolean };
export type WebDavProgress = { phase: "verify" | "sync" | "complete"; completed: number; total: number };
type Status = { busy: boolean; message: string; error: string; result: WebDavResult | null; progress: WebDavProgress | null };
let status: Status = { busy: false, message: "", error: "", result: null, progress: null };
const listeners = new Set<() => void>();
function update(patch: Partial<Status>) {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}
export const webdavStatus = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => status
};
export function clearWebDavStatus() {
  if (!status.busy) update({ message: "", error: "", result: null, progress: null });
}
export const emptyWebDavSettings: WebDavSettings = { endpoint: "", username: "", collection: "personal", autoSync: false, sync: { ...defaultSyncOptions } };
export async function loadWebDavSettings(): Promise<WebDavSettings> {
  const settings = await invoke<WebDavSettings>("get_webdav_settings");
  return { ...settings, sync: { ...defaultSyncOptions, ...settings.sync } };
}
async function operation<T>(work: () => Promise<T>, message: string): Promise<T> {
  if (status.busy) throw new Error("WebDAV 操作正在进行。");
  update({ busy: true, error: "", message: "", progress: null });
  try {
    const value = await work();
    update({ message });
    return value;
  } catch (error) {
    update({ error: String(error) });
    throw error;
  } finally { update({ busy: false, progress: null }); }
}
export async function saveWebDavSettings(settings: WebDavSettings, password: string, encryptionPassword = ""): Promise<void> {
  await operation(() => invoke("save_webdav_settings", { settings, password: password || null, encryptionPassword: encryptionPassword || null }), "连接配置已保存。");
  update({ result: null });
}
export async function disconnectWebDav(): Promise<void> {
  await operation(() => invoke("disconnect_webdav"), "已断开连接，本地和远端文件均保留。");
  update({ result: null });
}
export async function verifyWebDav(): Promise<void> {
  await operation(() => invoke("verify_webdav"), "验证成功，可以进行双向同步。");
}
export async function syncWebDav(resolutions: WebDavResolution[] = []): Promise<void> {
  await operation(async () => {
    const unlisten = await listen<WebDavProgress>("webdav-progress", (event) => update({ progress: event.payload }));
    try {
      const result = await invoke<WebDavResult>("sync_webdav", { resolutions, browser: { preferences: exportWebDavPreferences(), credentials: webDavCredentialDescriptors() } });
      update({ result });
    } finally { unlisten(); }
  }, "同步完成。");
}
export async function autoSyncWebDav(): Promise<void> {
  if (!isTauri() || status.busy || status.result?.conflicts.length || status.result?.restartRequired) return;
  try {
    const settings = await loadWebDavSettings();
    if (settings.autoSync && settings.endpoint && !status.busy) await syncWebDav();
  } catch (error) { update({ error: String(error) }); }
}

export function webDavPathLabel(path: string): string {
  if (!path.startsWith(".liteasy/sync-data/")) return path;
  const [, , category, , filename] = path.split("/");
  const labels: Record<string, string> = { objects: "Liteasy 笔记与产物", boards: "Liteasy 白板", external: "外部链接目录", history: "AI 对话历史", preferences: "偏好与用户画像", keys: "加密 API key" };
  return `${labels[category] ?? "同步数据"}${filename === "records.json" ? " · 内容与版本" : filename === "catalog.json" ? " · 产物目录" : filename?.startsWith("mount-") ? " · 目录内容" : ""}`;
}
