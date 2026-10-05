import { useSyncExternalStore } from "react";
import { createLanguagePreferenceStore, persistLanguagePreference, type LanguageEnvironment, type UiLanguagePreference } from "../../shared/i18n/localePolicy";

const environment: LanguageEnvironment = {
  getStorage: () => globalThis.localStorage,
  getSystemLanguages: () => typeof navigator === "undefined" ? []
    : navigator.languages?.length ? navigator.languages : [navigator.language]
};
export const uiLanguagePreferences = createLanguagePreferenceStore(environment);
export const persistUiLanguagePreference = (preference: UiLanguagePreference) => persistLanguagePreference(environment, preference);
export const readUiLanguagePreference = () => uiLanguagePreferences.getSnapshot().preference;
export const notifyUiLanguagePreference = uiLanguagePreferences.adoptSettingsWrite;
export function useUiLanguagePreference() {
  return useSyncExternalStore(uiLanguagePreferences.subscribe, uiLanguagePreferences.getSnapshot, uiLanguagePreferences.getSnapshot);
}
