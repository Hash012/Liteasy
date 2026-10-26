import "./surfaceTokens.css";
import "../../shared/ui/productPrimitives.css";
import { resolveTypography } from "../settings/typography";
import type { SettingsState } from "../settings/settings.types";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
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

function readTypography(): Partial<SettingsState> {
  try { return JSON.parse(localStorage.getItem(viewSettingsStorageKey) ?? "{}") ?? {}; }
  catch { return {}; }
}

const darkMediaQuery = "(prefers-color-scheme: dark)";
const ApplicationColorScheme = createContext<"light" | "dark">("light");
export const useApplicationColorScheme = () => useContext(ApplicationColorScheme);

export function initializeApplicationAppearance() {
  applyDocumentColorScheme(resolveColorScheme(readAppearancePreference(), globalThis.matchMedia?.(darkMediaQuery).matches ?? false));
}

export function ApplicationThemeProvider({ children }: { children: ReactNode }) {
  const [fontSettings, setFontSettings] = useState(readTypography);
  const typography = useMemo(() => resolveTypography(fontSettings), [fontSettings]);
  const fontFamily = typography.interfaceFamily;
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
      if (typeof font === "string" && font.trim()) setFontSettings({ "view.font_family": font });
      else if (font && typeof font === "object") setFontSettings(font as Partial<SettingsState>);
    };
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === viewSettingsStorageKey || event.key === null) { setPreference(readAppearancePreference()); setFontSettings(readTypography()); }
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
    colorNeutralBackground1: "var(--bg-canvas-primary)",
    colorNeutralBackground2: "var(--bg-sidebar)",
    colorNeutralBackground3: "var(--bg-app-shell)",
    colorNeutralBackground4: "var(--bg-panel-secondary)",
    colorNeutralBackground1Hover: "var(--bg-hover)",
    colorNeutralBackground1Pressed: "var(--bg-active)",
    colorNeutralBackground1Selected: "var(--bg-active)",
    colorSubtleBackgroundHover: "var(--bg-hover)",
    colorSubtleBackgroundPressed: "var(--bg-active)",
    colorSubtleBackgroundSelected: "var(--bg-active)",
    colorNeutralForeground1: "var(--palette-foreground-primary)",
    colorNeutralForeground2: "var(--palette-foreground-secondary)",
    colorNeutralForeground3: "var(--palette-foreground-muted)",
    colorNeutralForegroundDisabled: "var(--palette-foreground-muted)",
    colorNeutralBackgroundDisabled: "var(--bg-sidebar)",
    colorNeutralStrokeDisabled: "var(--palette-border-subtle)",
    colorNeutralStroke1: "var(--palette-border-default)",
    colorNeutralStroke2: "var(--palette-border-subtle)",
    colorNeutralStrokeAccessible: "var(--palette-border-default)",
    colorBrandBackground: "var(--brand-fill)",
    colorBrandBackgroundHover: "var(--brand-fill-hover)",
    colorBrandBackgroundPressed: "var(--brand-fill-pressed)",
    colorBrandBackground2: "var(--bg-selected-accent)",
    colorBrandForeground1: "var(--accent-primary)",
    colorBrandForeground2: "var(--accent-primary)",
    colorBrandForegroundLink: "var(--accent-primary)",
    colorBrandStroke1: "var(--accent-primary)",
    colorBrandStroke2: "var(--badge-border)",
    colorStrokeFocus2: "var(--border-focus)",
  }), [scheme, fontFamily]);

  return (
    <ApplicationColorScheme.Provider value={scheme}><FluentProvider theme={theme} className="fluent-app-root" applyStylesToPortals>
      <style data-liteasy-typography>{typography.css}</style>
      {children}
    </FluentProvider></ApplicationColorScheme.Provider>
  );
}
