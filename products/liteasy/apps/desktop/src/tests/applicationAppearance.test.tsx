import { act, cleanup, render, screen } from "@testing-library/react";
import { Dialog, DialogBody, DialogSurface, DialogTitle, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, test, vi } from "vitest";
import { ApplicationThemeProvider } from "../app/features/theme/ApplicationThemeProvider";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { viewSettingsStorageKey } from "../app/features/theme/appearancePreference";

function mockSystemAppearance(initialDark: boolean) {
  const events = new EventTarget();
  const media = {
    matches: initialDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    addListener: vi.fn(), removeListener: vi.fn()
  };
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  return (dark: boolean) => {
    media.matches = dark;
    const event = new Event("change");
    Object.defineProperty(event, "matches", { value: dark });
    act(() => events.dispatchEvent(event));
  };
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(viewSettingsStorageKey);
  delete document.documentElement.dataset.colorScheme;
  document.documentElement.style.removeProperty("color-scheme");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("follows live system changes until an explicit persisted preference is chosen", () => {
  const changeSystem = mockSystemAppearance(true);
  const store = createSettingsStore();
  const view = render(<ApplicationThemeProvider><p>Reader</p></ApplicationThemeProvider>);
  expect(document.documentElement).toHaveAttribute("data-color-scheme", "dark");
  changeSystem(false);
  expect(document.documentElement).toHaveAttribute("data-color-scheme", "light");
  act(() => store.apply({ intent: "update_setting", target: "view.theme", value: "dark" }));
  expect(document.documentElement).toHaveAttribute("data-color-scheme", "dark");
  changeSystem(false);
  expect(document.documentElement).toHaveAttribute("data-color-scheme", "dark");
  expect(createSettingsStore().getState()["view.theme"]).toBe("dark");
  view.unmount();
  render(<ApplicationThemeProvider><p>Restored</p></ApplicationThemeProvider>);
  expect(document.documentElement.style.colorScheme).toBe("dark");
  act(() => store.apply({ intent: "update_setting", target: "view.theme", value: "system" }));
  expect(document.documentElement).toHaveAttribute("data-color-scheme", "light");
});

test("switches Fluent theme tokens inside dialogs rendered through a portal", () => {
  mockSystemAppearance(false);
  const store = createSettingsStore();
  const { container } = render(<ApplicationThemeProvider>
    <Dialog open modalType="non-modal"><DialogSurface><DialogBody><DialogTitle>Reading preferences</DialogTitle></DialogBody></DialogSurface></Dialog>
  </ApplicationThemeProvider>);
  const dialog = screen.getByRole("dialog");
  expect(container.contains(dialog)).toBe(false);
  const portalProvider = dialog.closest(".fluent-app-root");
  expect(portalProvider).not.toBeNull();
  expect(getComputedStyle(portalProvider!).getPropertyValue("--colorNeutralForeground1").trim()).toBe(webLightTheme.colorNeutralForeground1);
  act(() => store.apply({ intent: "update_setting", target: "view.theme", value: "dark" }));
  expect(getComputedStyle(portalProvider!).getPropertyValue("--colorNeutralForeground1").trim()).toBe(webDarkTheme.colorNeutralForeground1);
});

test("changes appearance for the current session when storage writes are blocked", () => {
  mockSystemAppearance(false);
  render(<ApplicationThemeProvider><p>Reader</p></ApplicationThemeProvider>);
  const store = createSettingsStore();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("unavailable"); });
  act(() => store.apply({ intent: "update_setting", target: "view.theme", value: "dark" }));
  expect(document.documentElement).toHaveAttribute("data-color-scheme", "dark");
});

test("restores legacy preferences with system appearance and rejects invalid writes", () => {
  localStorage.setItem(viewSettingsStorageKey, JSON.stringify({ "view.font_size": "16", "view.theme": "invalid" }));
  const store = createSettingsStore();
  expect(store.getState()["view.theme"]).toBe("system");
  expect(store.getState()["view.font_size"]).toBe("16");
  expect(() => store.apply({ intent: "update_setting", target: "view.theme", value: "invalid" })).toThrow("invalid_appearance_preference");
  store.apply({ intent: "update_setting", target: "view.theme", value: "dark" });
  expect(JSON.parse(localStorage.getItem(viewSettingsStorageKey)!)).toMatchObject({ "view.font_size": "16", "view.theme": "dark" });
});

test("updates an open window when a persisted theme changes in another window", () => {
  mockSystemAppearance(false);
  render(<ApplicationThemeProvider><p>Reader</p></ApplicationThemeProvider>);
  localStorage.setItem(viewSettingsStorageKey, JSON.stringify({ "view.theme": "dark" }));
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: viewSettingsStorageKey })));
  expect(document.documentElement).toHaveAttribute("data-color-scheme", "dark");
});


test("updates interface and portal fonts immediately, including when storage is blocked", () => {
  mockSystemAppearance(false);
  const store = createSettingsStore();
  const { container } = render(<ApplicationThemeProvider>
    <p>Reader</p><Dialog open modalType="non-modal"><DialogSurface><DialogBody><DialogTitle>Fonts</DialogTitle></DialogBody></DialogSurface></Dialog>
  </ApplicationThemeProvider>);
  const provider = container.querySelector(".fluent-app-root")!;
  const portal = screen.getByRole("dialog").closest(".fluent-app-root")!;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  act(() => store.apply({ intent: "update_setting", target: "view.font_family", value: '"My Reading Font", serif' }));
  for (const element of [provider, portal]) {
    expect(getComputedStyle(element).getPropertyValue("--fontFamilyBase").trim()).toBe('"My Reading Font", serif');
    expect(getComputedStyle(element).getPropertyValue("--fontFamilyNumeric").trim()).toBe('"My Reading Font", serif');
  }
  expect(getComputedStyle(provider).getPropertyValue("--fontFamilyMonospace").trim()).toBe(webLightTheme.fontFamilyMonospace);
});

test("applies script fonts to Fluent portals without persistence and restores external changes", () => {
  mockSystemAppearance(false);
  const store = createSettingsStore();
  const { container } = render(<ApplicationThemeProvider>
    <Dialog open modalType="non-modal"><DialogSurface><DialogBody><DialogTitle>字体 Fonts</DialogTitle></DialogBody></DialogSurface></Dialog>
  </ApplicationThemeProvider>);
  const provider = container.querySelector(".fluent-app-root")!;
  const portal = screen.getByRole("dialog").closest(".fluent-app-root")!;
  const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  act(() => {
    store.apply({ intent: "update_setting", target: "view.font_family_zh", value: '"Noto Sans CJK SC", sans-serif' });
    store.apply({ intent: "update_setting", target: "view.font_family_en", value: '"Georgia", serif' });
    store.apply({ intent: "update_setting", target: "view.reader_font_family_en", value: '"Cambria", serif' });
  });
  for (const element of [provider, portal]) {
    expect(getComputedStyle(element).getPropertyValue("--fontFamilyBase")).toContain("Liteasy-ui-zh-0");
    expect(getComputedStyle(element).getPropertyValue("--fontFamilyNumeric")).toContain("Liteasy-ui-en-0");
    expect(getComputedStyle(element).getPropertyValue("--fontFamilyBase")).not.toContain("Liteasy-reader");
  }
  expect(container.querySelector("[data-liteasy-typography]")?.textContent).toContain('local("Cambria")');
  blocked.mockRestore();
  localStorage.setItem(viewSettingsStorageKey, JSON.stringify({ "view.font_family_en": '"Arial", sans-serif' }));
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: viewSettingsStorageKey })));
  expect(container.querySelector("[data-liteasy-typography]")?.textContent).toContain('local("Arial")');
  expect(container.querySelector("[data-liteasy-typography]")?.textContent).not.toContain('local("Georgia")');
});
