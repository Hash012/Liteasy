import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import {
  appearanceChangeEvent,
  applyDocumentColorScheme,
  isAppearancePreference,
  readAppearancePreference,
  resolveColorScheme,
  viewSettingsStorageKey
} from "./appearancePreference";

const darkMediaQuery = "(prefers-color-scheme: dark)";

export function initializeApplicationAppearance() {
  applyDocumentColorScheme(resolveColorScheme(readAppearancePreference(), globalThis.matchMedia?.(darkMediaQuery).matches ?? false));
}

export function ApplicationThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readAppearancePreference);
  const [systemDark, setSystemDark] = useState(() => globalThis.matchMedia?.(darkMediaQuery).matches ?? false);
  const scheme = resolveColorScheme(preference, systemDark);

  useEffect(() => {
    const onPreferenceChange = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (isAppearancePreference(next)) setPreference(next);
    };
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === viewSettingsStorageKey || event.key === null) setPreference(readAppearancePreference());
    };
    window.addEventListener(appearanceChangeEvent, onPreferenceChange);
    window.addEventListener("storage", onStorageChange);
    return () => {
      window.removeEventListener(appearanceChangeEvent, onPreferenceChange);
      window.removeEventListener("storage", onStorageChange);
    };
  }, []);

  useEffect(() => {
    if (preference !== "system" || !globalThis.matchMedia) return;
    const media = matchMedia(darkMediaQuery);
    setSystemDark(media.matches);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  useLayoutEffect(() => applyDocumentColorScheme(scheme), [scheme]);

  return (
    <FluentProvider theme={scheme === "dark" ? webDarkTheme : webLightTheme} className="fluent-app-root" applyStylesToPortals>
      {children}
    </FluentProvider>
  );
}
