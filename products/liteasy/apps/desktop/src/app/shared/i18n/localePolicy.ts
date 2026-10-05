/** Platform-independent language policy. No React, network, file, or AI dependencies. */
export const supportedUiLocales = ["zh-CN", "en-US"] as const;
export type UiLocale = typeof supportedUiLocales[number];
export type UiLanguagePreference = "system" | UiLocale;
export const uiLanguageSettingKey = "view.language";
export const uiViewStorageKey = "liteasy.view-settings.v1";

export interface LanguageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface LanguageSnapshot {
  readonly preference: UiLanguagePreference;
  readonly locale: UiLocale;
  readonly source: "explicit" | "legacy" | "new";
  readonly persistence: "saved" | "session";
}
export interface LanguageEnvironment {
  getStorage(): LanguageStorage | undefined;
  getSystemLanguages(): readonly string[];
}

// Evidence of an older installation, not user content and not a general storage scan.
export const legacyPreferenceKeys = [
  uiViewStorageKey,
  "liteasy.model-connection.v1",
  "liteasy.generation-prompts.v1",
  "liteasy.selection-lookup.v1",
  "liteasy.local-literature.v1",
  "liteasy.recommendation-settings.v1"
] as const;

export function isUiLanguagePreference(value: unknown): value is UiLanguagePreference {
  return value === "system" || value === "zh-CN" || value === "en-US";
}

export function normalizeSupportedLocale(value: unknown): UiLocale | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const canonical = Intl.getCanonicalLocales(value.trim().replace(/_/g, "-"))[0];
    const base = canonical.split("-")[0];
    // v1 deliberately falls back from Traditional Chinese to Simplified Chinese.
    if (base === "zh") return "zh-CN";
    if (base === "en") return "en-US";
  } catch { /* Malformed BCP 47 input is not an application error. */ }
  return undefined;
}

export function resolveUiLocale(preference: UiLanguagePreference, systemLanguages: readonly string[]): UiLocale {
  if (preference !== "system") return preference;
  for (const language of systemLanguages) {
    const supported = normalizeSupportedLocale(language);
    if (supported) return supported;
  }
  return "en-US";
}

function recordFromJson(raw: string | null): Record<string, unknown> | undefined {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

export function initialLanguageSnapshot(env: LanguageEnvironment): LanguageSnapshot {
  let preference: UiLanguagePreference = "system";
  let source: LanguageSnapshot["source"] = "new";
  let persistence: LanguageSnapshot["persistence"] = "session";
  try {
    const storage = env.getStorage();
    const raw = storage?.getItem(uiViewStorageKey) ?? null;
    const saved = recordFromJson(raw)?.[uiLanguageSettingKey];
    if (isUiLanguagePreference(saved)) {
      preference = saved;
      source = "explicit";
      persistence = "saved";
    } else if (storage && legacyPreferenceKeys.some(key => storage.getItem(key) !== null)) {
      preference = "zh-CN";
      source = "legacy";
    }
  } catch { /* Access to localStorage itself can throw in private/blocked environments. */ }
  return Object.freeze({ preference, locale: resolveUiLocale(preference, env.getSystemLanguages()), source, persistence });
}

export function isLanguagePersisted(env: LanguageEnvironment, preference: UiLanguagePreference): boolean {
  try {
    return recordFromJson(env.getStorage()?.getItem(uiViewStorageKey) ?? null)?.[uiLanguageSettingKey] === preference;
  } catch { return false; }
}

/** Merge ONLY view.language. Never destroy malformed JSON or unrelated settings. */
export function persistLanguagePreference(env: LanguageEnvironment, preference: UiLanguagePreference): boolean {
  if (!isUiLanguagePreference(preference)) throw new Error("invalid_ui_language");
  try {
    const storage = env.getStorage();
    if (!storage) return false;
    const record = recordFromJson(storage.getItem(uiViewStorageKey));
    if (!record) return false;
    storage.setItem(uiViewStorageKey, JSON.stringify({ ...record, [uiLanguageSettingKey]: preference }));
    return isLanguagePersisted(env, preference);
  } catch { return false; }
}

/** A stable external-store snapshot. Persistence remains in Liteasy's existing view settings. */
export function createLanguagePreferenceStore(env: LanguageEnvironment) {
  let current: LanguageSnapshot | undefined;
  const listeners = new Set<() => void>();
  function getSnapshot(): LanguageSnapshot { return current ??= initialLanguageSnapshot(env); }
  function publish(next: LanguageSnapshot) {
    const previous = getSnapshot();
    if (previous.preference === next.preference && previous.locale === next.locale &&
        previous.source === next.source && previous.persistence === next.persistence) return;
    current = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  }
  function adoptSettingsWrite(preference: UiLanguagePreference) {
    if (!isUiLanguagePreference(preference)) throw new Error("invalid_ui_language");
    publish({ preference, source: "explicit", locale: resolveUiLocale(preference, env.getSystemLanguages()),
      persistence: isLanguagePersisted(env, preference) ? "saved" : "session" });
  }
  return {
    getSnapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    initialize() {
      const snapshot = getSnapshot();
      const saved = isLanguagePersisted(env, snapshot.preference) || persistLanguagePreference(env, snapshot.preference);
      publish({ ...snapshot, persistence: saved ? "saved" : "session" });
      return getSnapshot();
    },
    adoptSettingsWrite,
    refreshFromStorage() { publish(initialLanguageSnapshot(env)); },
    refreshSystemLanguages() {
      const snapshot = getSnapshot();
      publish({ ...snapshot, locale: resolveUiLocale(snapshot.preference, env.getSystemLanguages()) });
    }
  };
}
