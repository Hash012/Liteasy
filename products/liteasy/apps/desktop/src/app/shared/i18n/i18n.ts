import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";
import type { UiLocale } from "./localePolicy";
import type { MessageArguments, MessageKey } from "./messageTypes";

export const uiI18n = createInstance();
// All resources ship with the app. Initialization cannot fetch translations or call a model.
// Chinese here keeps non-bootstrapped existing component tests deterministic. The real entry
// point resolves the saved/system preference BEFORE importing/rendering App.
export const uiI18nReady = uiI18n.use(initReactI18next).init({
  lng: "zh-CN",
  supportedLngs: ["zh-CN", "en-US"],
  fallbackLng: "zh-CN",
  load: "currentOnly",
  resources: { "zh-CN": { translation: zhCN }, "en-US": { translation: enUS } },
  defaultNS: "translation",
  ns: ["translation"],
  keySeparator: false,
  initAsync: false,
  returnNull: false,
  returnEmptyString: false,
  saveMissing: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false, bindI18n: "languageChanged" }
});

let changes: Promise<unknown> = uiI18nReady;
export function changeUiLocale(locale: UiLocale): Promise<void> {
  // Serialize changes. A rapid zh -> en -> zh sequence must never finish in en.
  changes = changes.catch(() => undefined).then(async () => {
    if (uiI18n.resolvedLanguage !== locale) await uiI18n.changeLanguage(locale);
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
      document.documentElement.dir = "ltr";
    }
  });
  return changes.then(() => undefined);
}
export function currentUiLocale(): UiLocale {
  return uiI18n.resolvedLanguage === "en-US" ? "en-US" : "zh-CN";
}
const translate = uiI18n.t.bind(uiI18n) as (key: string, options?: Record<string, unknown>) => unknown;
export function message<K extends MessageKey>(key: K, ...args: MessageArguments<K>): string {
  // The public boundary is checked by MessageArguments; do not leak library overloads.
  return String(translate(key, args[0]));
}

/** New UI copy is Chinese-first; a translated catalog entry is optional, never generated. */
export function messageWithFallback(key: string, chinese: string, values?: Record<string, string | number>): string {
  return String(translate(key, {
    defaultValue: chinese,
    replace: values,
    ...(typeof values?.count === "number" ? { count: values.count } : {})
  }));
}
