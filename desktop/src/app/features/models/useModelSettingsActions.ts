import type { createSettingsStore } from "../settings/settings.store";
import type { SettingsState } from "../settings/settings.types";

type SettingsStore = ReturnType<typeof createSettingsStore>;

type UseModelSettingsActionsInput = {
  onSettingsChanged: (nextSettings: SettingsState) => void;
  settingsStore: SettingsStore;
};

export function useModelSettingsActions({
  onSettingsChanged,
  settingsStore
}: UseModelSettingsActionsInput) {
  function syncSettings() {
    onSettingsChanged({ ...settingsStore.getState() });
  }

  function setModelAccessMode(mode: SettingsState["models.access_mode"]) {
    settingsStore.apply({
      intent: "update_setting",
      target: "models.access_mode",
      value: mode
    });
    syncSettings();
  }

  function applyModelPolicySnapshot(nextSettings: Partial<SettingsState>) {
    Object.entries(nextSettings).forEach(([target, value]) => {
      settingsStore.apply({
        intent: "update_setting",
        target: target as keyof SettingsState,
        value: value as boolean | string
      });
    });
    syncSettings();
  }

  function applyLocalDevCloudDefaults() {
    applyModelPolicySnapshot({
      "models.cloud_proxy_endpoint": "http://127.0.0.1:8787",
      "models.control_plane_endpoint": "http://127.0.0.1:8787"
    });
  }

  function setLocalDirectEnabled(enabled: boolean) {
    settingsStore.apply({
      intent: "update_setting",
      target: "models.local_direct_enabled",
      value: enabled
    });

    if (!enabled && settingsStore.getState()["models.access_mode"] === "local_direct") {
      settingsStore.apply({
        intent: "update_setting",
        target: "models.access_mode",
        value: "cloud_proxy"
      });
    }

    syncSettings();
  }

  return {
    applyLocalDevCloudDefaults,
    applyModelPolicySnapshot,
    setLocalDirectEnabled,
    setModelAccessMode
  };
}
