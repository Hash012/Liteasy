import type { SettingKey } from "./settings.types";
import { settingsRegistry } from "./settingsRegistry";
import { invoke } from "@tauri-apps/api/core";

export function createSettingsStore() {
  const values = new Map<string, boolean | string>();

  // initialize from registry defaults
  for (const def of Object.values(settingsRegistry)) {
    values.set(def.key, def.defaultValue);
  }

  return {
    async initFromDb() {
      try {
        const rows = await invoke<Array<[string, string]>>("db_load_settings");
        for (const [k, v] of rows) {
          values.set(k, v);
        }
      } catch {}
    },
    get(key: SettingKey): boolean | string | undefined {
      return values.get(key);
    },
    set(key: SettingKey, value: boolean | string): boolean {
      if (!settingsRegistry[key]) return false;
      values.set(key, value);
      try {
        invoke("db_save_setting", { key, value: String(value), updatedAt: new Date().toISOString() });
      } catch {}
      return true;
    },
    getAll(): Record<string, boolean | string> {
      return Object.fromEntries(values);
    },
  };
}
