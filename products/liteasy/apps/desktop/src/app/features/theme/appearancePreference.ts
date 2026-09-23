export type AppearancePreference = "system" | "light" | "dark";
export type ColorScheme = "light" | "dark";

export const viewSettingsStorageKey = "liteasy.view-settings.v1";
export const appearanceChangeEvent = "liteasy:appearance-change";

export function isAppearancePreference(value: unknown): value is AppearancePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function normalizeAppearancePreference(value: unknown): AppearancePreference {
  return isAppearancePreference(value) ? value : "system";
}

export function readAppearancePreference(): AppearancePreference {
  try {
    return normalizeAppearancePreference(JSON.parse(globalThis.localStorage?.getItem(viewSettingsStorageKey) ?? "{}")?.["view.theme"]);
  } catch {
    return "system";
  }
}

export function resolveColorScheme(preference: AppearancePreference, systemDark: boolean): ColorScheme {
  return preference === "system" ? systemDark ? "dark" : "light" : preference;
}

export function notifyAppearancePreference(preference: AppearancePreference) {
  // A same-window notification also works when persistence is unavailable.
  globalThis.dispatchEvent?.(new CustomEvent(appearanceChangeEvent, { detail: preference }));
}

export function applyDocumentColorScheme(scheme: ColorScheme) {
  document.documentElement.dataset.colorScheme = scheme;
  document.documentElement.style.colorScheme = scheme;
}
