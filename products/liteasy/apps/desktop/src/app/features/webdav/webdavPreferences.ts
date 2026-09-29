import { invoke, isTauri } from "@tauri-apps/api/core";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import { loadVerifiedModelProfiles } from "../models/verifiedModelProfiles";
const publicKeys = ["liteasy.model-connection.v1", "liteasy.verified-models.v1", "liteasy.view-settings.v1", "liteasy.recommendation-settings.v1", "liteasy.local-literature.v1"];
const scopedKeys = ["liteasy.academic-profile.v1:", "liteasy.profile-memory.v1:", "liteasy.local-research-profile.v1:", "liteasy.library.icons.v1:"];
export function exportWebDavPreferences(): Record<string, string> {
  const scope = resolveLocalAccountKey();
  return Object.fromEntries([...publicKeys, ...scopedKeys.map((key) => key + scope)].flatMap((key) => {
    const value = localStorage.getItem(key); return value === null ? [] : [[key, value]];
  }));
}
export function webDavCredentialDescriptors() {
  const descriptors: { kind: string; config: unknown }[] = loadVerifiedModelProfiles().map(({ config }) => ({ kind: "model", config }));
  let settings: Record<string, string> = {};
  try { settings = JSON.parse(localStorage.getItem("liteasy.model-connection.v1") ?? "{}"); } catch { /* No saved connections. */ }
  if (settings["models.direct_endpoint"] && settings["models.direct_model"]) {
    descriptors.push({ kind: "model", config: { provider: settings["models.direct_provider"], endpoint: settings["models.direct_endpoint"], model: settings["models.direct_model"], protocol: settings["models.direct_protocol"] } });
  }
  for (const [provider, endpoint] of [[settings["papers.metadata_provider"], settings["papers.metadata_endpoint"]], ["mineru", settings["papers.mineru_endpoint"]]]) {
    if (provider && endpoint) descriptors.push({ kind: "paper", config: { provider, endpoint } });
  }
  return [...new Map(descriptors.map((item) => [JSON.stringify(item), item])).values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
/** Called before importing the App module, so stores initialize from restored preferences. */
export async function restoreWebDavPreferences() {
  if (!isTauri()) return;
  const previous = exportWebDavPreferences();
  const result = await invoke<{ preferences?: Record<string, string>; pending?: boolean; message?: string }>("restore_webdav_preferences", { preferences: previous });
  if (result.preferences) {
    const allowed = new Set([...publicKeys, ...scopedKeys.map((key) => key + resolveLocalAccountKey())]);
    for (const key of new Set([...Object.keys(previous), ...Object.keys(result.preferences)])) {
      if (!allowed.has(key)) continue;
      const value = result.preferences[key];
      if (typeof value === "string") localStorage.setItem(key, value); else localStorage.removeItem(key);
    }
  }
  if (result.pending) await invoke("acknowledge_webdav_preferences");
  if (result.message) reportWebDavRestoreError(result.message);
}

export function reportWebDavRestoreError(error: unknown) {
  try { sessionStorage.setItem("liteasy.webdav-restore-notice", String(error)); }
  catch { console.error("WebDAV restore notice", error); }
}
