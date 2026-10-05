import { describe, expect, it } from "vitest";
import { createLanguagePreferenceStore, initialLanguageSnapshot, persistLanguagePreference, resolveUiLocale, uiViewStorageKey, type LanguageEnvironment } from "../app/shared/i18n/localePolicy";

function environment(saved?: string, languages = ["en-GB"]) {
  const data = new Map<string, string>();
  if (saved !== undefined) data.set(uiViewStorageKey, saved);
  const env: LanguageEnvironment = {
    getStorage: () => ({ getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); } }),
    getSystemLanguages: () => languages
  };
  return { data, env };
}
describe("display language migration", () => {
  it("follows system for new installations and keeps Chinese for existing view settings", () => {
    expect(initialLanguageSnapshot(environment().env)).toMatchObject({ preference: "system", locale: "en-US" });
    expect(initialLanguageSnapshot(environment('{"view.theme":"dark"}').env)).toMatchObject({ preference: "zh-CN", locale: "zh-CN", source: "legacy" });
  });
  it("only persists language and preserves unrelated settings", () => {
    const { env, data } = environment('{"view.theme":"dark","future.option":42}');
    const store = createLanguagePreferenceStore(env);
    store.initialize();
    expect(JSON.parse(data.get(uiViewStorageKey)!)).toEqual({ "view.theme": "dark", "future.option": 42, "view.language": "zh-CN" });
  });
  it("does not overwrite malformed preferences and still allows session-only switching", () => {
    const { env, data } = environment("{broken");
    expect(persistLanguagePreference(env, "en-US")).toBe(false);
    const store = createLanguagePreferenceStore(env);
    store.initialize();
    store.adoptSettingsWrite("en-US");
    expect(store.getSnapshot()).toMatchObject({ locale: "en-US", persistence: "session" });
    expect(data.get(uiViewStorageKey)).toBe("{broken");
  });
  it("handles unavailable storage and regional language variants", () => {
    const { env } = environment();
    env.getStorage = () => { throw new Error("blocked"); };
    expect(createLanguagePreferenceStore(env).initialize()).toMatchObject({ locale: "en-US", persistence: "session" });
    expect(resolveUiLocale("system", ["bad_locale!", "fr-FR", "zh-Hant-TW"])).toBe("zh-CN");
    expect(resolveUiLocale("zh-CN", ["en-US"])).toBe("zh-CN");
  });
});


describe("locale-aware UI values", () => {
  it("formats numbers, sizes and dates without changing stored values", async () => {
    const { formatUiNumber, formatUiBytes, formatUiDate, formatUiRelativeTime } = await import("../app/shared/i18n/format");
    expect(formatUiNumber(1234.5, "en-US")).toBe("1,234.5");
    expect(formatUiBytes(1536, "en-US")).toBe("1.5\u00a0KiB");
    expect(formatUiBytes(0, "zh-CN")).toBe("0\u00a0B");
    expect(formatUiRelativeTime(-1, "day", "zh-CN")).toBe("昨天");
    expect(formatUiRelativeTime(-1, "day", "en-US")).toBe("yesterday");
    expect(formatUiDate("2026-10-05T12:00:00Z", "en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })).toBe("October 5, 2026");
    expect(formatUiDate("invalid date", "zh-CN")).toBe("—");
    expect(formatUiNumber(NaN, "en-US")).toBe("—");
    expect(formatUiBytes(-1, "en-US")).toBe("—");
  });
});
