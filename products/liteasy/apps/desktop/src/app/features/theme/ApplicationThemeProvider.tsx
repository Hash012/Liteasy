import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import {
  appearanceChangeEvent,
  typographyChangeEvent,
  applyDocumentColorScheme,
  isAppearancePreference,
  readAppearancePreference,
  resolveColorScheme,
  viewSettingsStorageKey
} from "./appearancePreference";

function readFontFamily() {
  try {
    const font = JSON.parse(localStorage.getItem(viewSettingsStorageKey) ?? "{}")?.["view.font_family"];
    return typeof font === "string" && font.trim() ? font : webLightTheme.fontFamilyBase;
  }
  catch { return webLightTheme.fontFamilyBase; }
}

const darkMediaQuery = "(prefers-color-scheme: dark)";

export function initializeApplicationAppearance() {
  applyDocumentColorScheme(resolveColorScheme(readAppearancePreference(), globalThis.matchMedia?.(darkMediaQuery).matches ?? false));
}

export function ApplicationThemeProvider({ children }: { children: ReactNode }) {
  const [fontFamily, setFontFamily] = useState<string>(readFontFamily);
  const [preference, setPreference] = useState(readAppearancePreference);
  const [systemDark, setSystemDark] = useState(() => globalThis.matchMedia?.(darkMediaQuery).matches ?? false);
  const scheme = resolveColorScheme(preference, systemDark);

  useEffect(() => {
    const onPreferenceChange = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (isAppearancePreference(next)) setPreference(next);
    };
    const onTypographyChange = (event: Event) => {
      const font = (event as CustomEvent<unknown>).detail;
      if (typeof font === "string" && font.trim()) setFontFamily(font);
    };
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === viewSettingsStorageKey || event.key === null) { setPreference(readAppearancePreference()); setFontFamily(readFontFamily()); }
    };
    window.addEventListener(typographyChangeEvent, onTypographyChange);
    window.addEventListener(appearanceChangeEvent, onPreferenceChange);
    window.addEventListener("storage", onStorageChange);
    return () => {
      window.removeEventListener(typographyChangeEvent, onTypographyChange);
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

  const theme = useMemo(() => ({ ...(scheme === "dark" ? webDarkTheme : webLightTheme),
    fontFamilyBase: fontFamily, fontFamilyNumeric: fontFamily,
  }), [scheme, fontFamily]);

  return (
    <FluentProvider theme={theme} className="fluent-app-root" applyStylesToPortals>
      {children}
    </FluentProvider>
  );
}
