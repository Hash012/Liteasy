import { changeUiLocale, uiI18nReady } from "../shared/i18n/i18n";
import { uiViewStorageKey } from "../shared/i18n/localePolicy";
import { uiLanguagePreferences } from "../features/settings/uiLanguagePreference";

let boot: Promise<void> | undefined;
let pending: Promise<void> = Promise.resolve();
let disposeListeners: (() => void) | undefined;
let generation = 0;

export function synchronizeUiLanguage(): Promise<void> {
  pending = changeUiLocale(uiLanguagePreferences.getSnapshot().locale);
  return pending;
}
export function flushUiLanguage(): Promise<void> { return pending; }

export function initializeUiLanguage(): Promise<void> {
  if (boot) return boot;
  const ownGeneration = generation;
  boot = (async () => {
    uiLanguagePreferences.initialize();
    await uiI18nReady;
    if (ownGeneration !== generation) return;
    const notify = () => { void synchronizeUiLanguage().catch(() => {
      // Bundled resources make this exceptional. Do not log user data or server errors.
      console.error("liteasy_ui_language_change_failed");
    }); };
    const unsubscribe = uiLanguagePreferences.subscribe(notify);
    const onStorage = (event: StorageEvent) => {
      // sessionStorage and unrelated storage changes must not override the current choice.
      let local: Storage | undefined;
      try { local = globalThis.localStorage; } catch { return; }
      if (event.storageArea && event.storageArea !== local) return;
      if (event.key === null || event.key === uiViewStorageKey) uiLanguagePreferences.refreshFromStorage();
    };
    const onSystemLanguage = () => uiLanguagePreferences.refreshSystemLanguages();
    globalThis.addEventListener?.("storage", onStorage);
    globalThis.addEventListener?.("languagechange", onSystemLanguage);
    globalThis.addEventListener?.("focus", onSystemLanguage);
    disposeListeners = () => {
      unsubscribe();
      globalThis.removeEventListener?.("storage", onStorage);
      globalThis.removeEventListener?.("languagechange", onSystemLanguage);
      globalThis.removeEventListener?.("focus", onSystemLanguage);
    };
    await synchronizeUiLanguage();
  })().catch(error => { disposeListeners?.(); disposeListeners = undefined; boot = undefined; throw error; });
  return boot;
}
export function disposeUiLanguage() {
  generation += 1;
  disposeListeners?.();
  disposeListeners = undefined;
  boot = undefined;
}
if (import.meta.hot) import.meta.hot.dispose(disposeUiLanguage);
