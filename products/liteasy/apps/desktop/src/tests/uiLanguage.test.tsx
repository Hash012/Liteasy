import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { initializeUiLanguage, disposeUiLanguage, flushUiLanguage } from "../app/controllers/initializeUiLanguage";
import { LanguageSettingsRow } from "../app/features/settings/LanguageSettingsRow";
import { SystemFontPicker } from "../app/features/settings/SystemFontPicker";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { uiLanguagePreferences } from "../app/features/settings/uiLanguagePreference";
import { settingsRegistry } from "../app/features/settings/settingsRegistry";
import { matchesSettingsSearch, settingsCategories, settingsSections } from "../app/features/settings/settingsNavigation";
import { workbenchCommands } from "../app/features/workbench/workbenchCommands";
import { changeUiLocale, message, messageWithFallback, uiI18n } from "../app/shared/i18n/i18n";
import { useUiTranslation } from "../app/shared/i18n/useUiTranslation";
import { uiViewStorageKey } from "../app/shared/i18n/localePolicy";

const runtime = { VITE_LITEASY_CLOUD_URL: "http://127.0.0.1:8787", VITE_FORUM_API_URL: "" };
async function selectLanguage(store: ReturnType<typeof createSettingsStore>, value: "system" | "zh-CN" | "en-US") {
  await act(async () => {
    store.apply({ intent: "update_setting", target: "view.language", value });
    await flushUiLanguage();
  });
}
function ShellText() {
  useUiTranslation();
  return <p data-testid="translated-text">{settingsRegistry["view.language"].label}</p>;
}
beforeEach(async () => {
  cleanup(); disposeUiLanguage(); localStorage.clear();
  localStorage.setItem(uiViewStorageKey, JSON.stringify({ "view.language": "zh-CN", "view.theme": "dark" }));
  uiLanguagePreferences.refreshFromStorage(); await initializeUiLanguage();
});
afterEach(async () => {
  cleanup(); disposeUiLanguage(); vi.restoreAllMocks(); localStorage.clear();
  uiLanguagePreferences.refreshFromStorage(); await changeUiLocale("zh-CN");
});

describe("Liteasy display-language integration (run against the real application dependencies)", () => {
  it("uses the real settings callback and updates visible text without remounting a draft", async () => {
    const store = createSettingsStore(runtime); let mounts = 0;
    function Draft() { const [text, setText] = useState(""); useEffect(() => { mounts += 1; }, []); return <input aria-label="draft-probe" value={text} onChange={event => setText(event.target.value)} />; }
    render(<FluentProvider theme={webLightTheme}><LanguageSettingsRow onUpdateSetting={command => { store.apply(command); }} /><ShellText /><Draft /></FluentProvider>);
    fireEvent.change(screen.getByRole("textbox", { name: "draft-probe" }), { target: { value: "unsaved draft 未保存" } });
    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: "界面语言" }), { target: { value: "en-US" } });
      await flushUiLanguage();
    });
    expect(screen.getByTestId("translated-text").textContent).toBe("Display language");
    expect(screen.getByRole("combobox", { name: "Display language" })).toHaveValue("en-US");
    expect(screen.getByRole("textbox", { name: "draft-probe" })).toHaveValue("unsaved draft 未保存");
    expect(mounts).toBe(1);
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.documentElement.dir).toBe("ltr");
  });
  it("persists and restores the interface preference without changing assistant or OCR language", async () => {
    const store = createSettingsStore(runtime);
    const before = { assistant: store.getState()["assistant.language"], ocr: store.getState()["import.ocr_language"], theme: store.getState()["view.theme"] };
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network request"));
    await selectLanguage(store, "en-US");
    expect(store.getState()["assistant.language"]).toBe(before.assistant);
    expect(store.getState()["import.ocr_language"]).toBe(before.ocr);
    expect(store.getState()["view.theme"]).toBe(before.theme);
    expect(JSON.parse(localStorage.getItem(uiViewStorageKey)!)["view.language"]).toBe("en-US");
    disposeUiLanguage(); uiLanguagePreferences.refreshFromStorage(); await initializeUiLanguage();
    expect(createSettingsStore(runtime).getState()["view.language"]).toBe("en-US");
    expect(network).not.toHaveBeenCalled();
  });
  it("keeps metadata getters and settings search current after switching", async () => {
    const store = createSettingsStore(runtime); const category = settingsCategories.find(item => item.id === "appearance")!;
    expect(category.label).toBe("外观与阅读");
    await selectLanguage(store, "en-US");
    expect(category.label).toBe("Appearance and reading");
    expect(settingsRegistry["view.font_family"].help).not.toContain("选择应用界面");
    expect(workbenchCommands.find(item => item.id === "settings")!.title).toBe("Open settings");
    const appearance = settingsSections.find(item => item.id === "appearance")!;
    expect(matchesSettingsSearch(appearance, "language")).toBe(true);
    expect(matchesSettingsSearch(appearance, "界面语言")).toBe(true);
  });
  it("preserves a typed custom font name through a locale-only option label change", async () => {
    const store = createSettingsStore(runtime);
    function Fonts() { useUiTranslation(); return <SystemFontPicker label="font-probe" value="" options={[{ value: "", get label() { return message("view.keepInterfaceFont"); } }]} onChange={() => {}} />; }
    render(<FluentProvider theme={webLightTheme}><Fonts /></FluentProvider>);
    const input = screen.getByRole("combobox", { name: "font-probe" });
    fireEvent.change(input, { target: { value: "My Unfinished Font Name" } });
    await selectLanguage(store, "en-US");
    expect(input).toHaveValue("My Unfinished Font Name");
  });
  it("shows session-only persistence failure without failing language switching", async () => {
    const store = createSettingsStore(runtime);
    render(<FluentProvider theme={webLightTheme}><LanguageSettingsRow onUpdateSetting={command => { store.apply(command); }} /></FluentProvider>);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    await selectLanguage(store, "en-US");
    expect(document.documentElement.lang).toBe("en-US");
    expect(screen.getByText("This choice is active for this session only and has not been saved on this device.")).toBeInTheDocument();
  });
  it("merges only language through the real settings callback, preserving future fields and damaged storage", async () => {
    const store = createSettingsStore(runtime);
    localStorage.setItem(uiViewStorageKey, JSON.stringify({ "view.theme": "light", "future.setting": { enabled: true } }));
    await selectLanguage(store, "en-US");
    expect(JSON.parse(localStorage.getItem(uiViewStorageKey)!)).toEqual({ "view.theme": "light", "future.setting": { enabled: true }, "view.language": "en-US" });
    localStorage.setItem(uiViewStorageKey, "{damaged");
    await selectLanguage(store, "zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(localStorage.getItem(uiViewStorageKey)).toBe("{damaged");
    expect(uiLanguagePreferences.getSnapshot().persistence).toBe("session");
  });
  it("handles languagechange for system preference, while explicit locale stays fixed", async () => {
    const store = createSettingsStore(runtime);
    const languages = vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
    await selectLanguage(store, "system"); expect(document.documentElement.lang).toBe("en-US");
    languages.mockReturnValue(["zh-TW"]);
    await act(async () => { window.dispatchEvent(new Event("languagechange")); await flushUiLanguage(); });
    expect(document.documentElement.lang).toBe("zh-CN");
    await selectLanguage(store, "en-US");
    await act(async () => { window.dispatchEvent(new Event("languagechange")); await flushUiLanguage(); });
    expect(document.documentElement.lang).toBe("en-US");
  });
  it("accepts same-origin storage changes and ignores unrelated sessionStorage", async () => {
    localStorage.setItem(uiViewStorageKey, JSON.stringify({ "view.language": "en-US" }));
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: uiViewStorageKey, storageArea: localStorage })); await flushUiLanguage(); });
    expect(document.documentElement.lang).toBe("en-US");
    localStorage.setItem(uiViewStorageKey, JSON.stringify({ "view.language": "zh-CN" }));
    await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: uiViewStorageKey, storageArea: sessionStorage })); await flushUiLanguage(); });
    expect(document.documentElement.lang).toBe("en-US");
  });
  it("does not let a stale settings instance overwrite another window's language", async () => {
    const oldStore = createSettingsStore(runtime);
    localStorage.setItem(uiViewStorageKey, JSON.stringify({ "view.language": "en-US" }));
    uiLanguagePreferences.refreshFromStorage();
    oldStore.apply({ intent: "update_setting", target: "view.font_size", value: "18" });
    expect(JSON.parse(localStorage.getItem(uiViewStorageKey)!)["view.language"]).toBe("en-US");
    expect(oldStore.getState()["view.language"]).toBe("en-US");
  });
  it("serializes rapid changes and ends on the last requested locale", async () => {
    const pending = ["en-US", "zh-CN", "en-US", "zh-CN"].map(locale => changeUiLocale(locale as "en-US" | "zh-CN"));
    await act(async () => { await Promise.all(pending); });
    expect(uiI18n.resolvedLanguage).toBe("zh-CN"); expect(document.documentElement.lang).toBe("zh-CN");
  });
  it("supports English plural forms and safely renders interpolation as React text", async () => {
    await changeUiLocale("en-US");
    expect(message("settings.search.results", { count: 1 })).toBe("Found 1 settings group · Searching all categories");
    expect(message("settings.search.results", { count: 2 })).toBe("Found 2 settings groups · Searching all categories");
    const text = '<img src=x onerror="alert(1)">';
    const result = render(<p>{message("ui.language.active", { language: text })}</p>);
    expect(result.container.querySelector("img")).toBeNull(); expect(result.container.textContent).toContain(text);
  });
  it("uses Chinese for missing translations without mutating the English catalog", async () => {
    const englishBefore = JSON.stringify(uiI18n.getResourceBundle("en-US", "translation"));
    await changeUiLocale("en-US");
    const original = uiI18n.getResource("en-US", "translation", "ui.language.label");
    try {
      uiI18n.addResource("en-US", "translation", "ui.language.label", "");
      expect(message("ui.language.label")).toBe("界面语言");
      expect(messageWithFallback("newFeature.saved", "已保存 {{count}} 项", { count: 2 })).toBe("已保存 2 项");
      expect(messageWithFallback("ui.language.label", "界面语言")).toBe("界面语言");
    } finally {
      uiI18n.addResource("en-US", "translation", "ui.language.label", original);
    }
    expect(messageWithFallback("ui.language.label", "界面语言")).toBe("Display language");
    expect(JSON.stringify(uiI18n.getResourceBundle("en-US", "translation"))).toBe(englishBefore);
  });
  it("rejects unsupported preferences without changing the current state", () => {
    const store = createSettingsStore(runtime); const before = store.getState()["view.language"];
    expect(() => store.apply({ intent: "update_setting", target: "view.language", value: "fr-FR" })).toThrow("invalid_ui_language");
    expect(store.getState()["view.language"]).toBe(before);
  });
});
