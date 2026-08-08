import type { createSettingsStore } from "../settings/settings.store";
import type { SettingsState } from "../settings/settings.types";
import {
  resolveLocalDevCloudEndpoint,
  shouldApplyLocalDevCloudDefaults,
  type DevCloudEnvLike
} from "./localDevCloudEndpoint";

type SettingsStore = ReturnType<typeof createSettingsStore>;

type UseModelSettingsActionsInput = {
  localDevCloudEnv?: DevCloudEnvLike;
  onSettingsChanged: (nextSettings: SettingsState) => void;
  settingsStore: SettingsStore;
};

export function useModelSettingsActions({
  localDevCloudEnv,
  onSettingsChanged,
  settingsStore
}: UseModelSettingsActionsInput) {
  function syncSettings() {
    onSettingsChanged({ ...settingsStore.getState() });
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
    const endpoint = resolveLocalDevCloudEndpoint(undefined, localDevCloudEnv);
    applyModelPolicySnapshot({
      "models.cloud_proxy_endpoint": endpoint,
      "models.control_plane_endpoint": endpoint
    });
  }

  function applyInjectedLocalDevCloudDefaults() {
    if (!shouldApplyLocalDevCloudDefaults(undefined, localDevCloudEnv)) {
      return;
    }

    applyLocalDevCloudDefaults();
  }

  return {
    applyInjectedLocalDevCloudDefaults,
    applyLocalDevCloudDefaults,
    applyModelPolicySnapshot
  };
}
