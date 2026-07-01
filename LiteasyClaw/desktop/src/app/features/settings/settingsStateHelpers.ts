import { createSettingsStore } from "./settings.store";
import type { SettingsState } from "./settings.types";

export function cloneSettingsState(state: SettingsState): SettingsState {
  return { ...state };
}

export function createSeededSettingsStore(initialSettings?: Partial<SettingsState>) {
  const store = createSettingsStore();

  if (!initialSettings) {
    return store;
  }

  Object.entries(initialSettings).forEach(([target, value]) => {
    store.apply({
      intent: "update_setting",
      target: target as keyof SettingsState,
      value: value as boolean | string
    });
  });

  return store;
}
