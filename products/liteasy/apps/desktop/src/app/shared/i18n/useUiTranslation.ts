import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { currentUiLocale, message, messageWithFallback, uiI18n } from "./i18n";

/** Subscribe in EVERY component that displays translated text, including memoized components. */
export function useUiTranslation() {
  useTranslation("translation", { i18n: uiI18n });
  const locale = currentUiLocale();
  const t = useCallback(message, [locale]);
  const tChinese = useCallback(messageWithFallback, [locale]);
  return { t, tChinese, locale };
}
