import { afterEach, expect, test } from "vitest";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { resolvePdfReadingBackground } from "../app/features/settings/viewSettings";
import { defaultReadingFontFamily } from "../app/features/settings/readingFonts";
import { languageFontKeys, resolveTypography } from "../app/features/settings/typography";

afterEach(() => {
  globalThis.localStorage?.removeItem("liteasy.view-settings.v1");
});

test("four script preferences persist independently while legacy fonts remain available", () => {
  localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.font_family": '"Old UI", sans-serif', "view.reader_font_family": '"Old Reader", serif' }));
  const store = createSettingsStore();
  expect(resolveTypography(store.getState())).toMatchObject({ interfaceFamily: '"Old UI", sans-serif', readerFamily: '"Old Reader", serif', css: "" });
  for (const [index, key] of languageFontKeys.entries()) store.apply({ intent: "update_setting", target: key, value: `"Font ${index}", serif` });
  const restored = createSettingsStore().getState();
  for (const [index, key] of languageFontKeys.entries()) expect(restored[key]).toBe(`"Font ${index}", serif`);
  expect(restored["view.font_family"]).toBe('"Old UI", sans-serif');
  expect(restored["view.reader_font_family"]).toBe('"Old Reader", serif');
  store.apply({ intent: "update_setting", target: "view.reader_font_family_en", value: "" });
  const reset = resolveTypography(createSettingsStore().getState());
  expect(reset.readerFamily).not.toContain("Liteasy-reader-en");
  expect(reset.readerFamily).toContain("Old Reader");
  expect(reset.interfaceFamily).toContain("Liteasy-ui-en");
});

test("invalid script fonts cannot inject styles or discard valid sibling preferences", () => {
  localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.font_family_zh": {}, "view.font_family_en": "bad; } body { color: red", "view.reader_font_family_zh": '"Noto Serif CJK SC", serif' }));
  const store = createSettingsStore();
  expect(store.getState()["view.font_family_zh"]).toBe("");
  expect(store.getState()["view.font_family_en"]).toBe("");
  expect(store.getState()["view.reader_font_family_zh"]).toBe('"Noto Serif CJK SC", serif');
  store.apply({ intent: "update_setting", target: "view.reader_font_family_en", value: "x".repeat(513) });
  expect(store.getState()["view.reader_font_family_en"]).toBe("");
  expect(resolveTypography(store.getState()).css).not.toContain("color: red");
});

test("reader scripts can independently follow interface fonts without overriding the other script", () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "view.font_family_zh", value: '"Chinese UI", serif' });
  store.apply({ intent: "update_setting", target: "view.reader_font_family_zh", value: "inherit" });
  store.apply({ intent: "update_setting", target: "view.reader_font_family_en", value: '"English Reader", serif' });
  const result = resolveTypography(store.getState());
  expect(result.css).toContain('font-family: "Liteasy-reader-zh-0"; src: local("Chinese UI")');
  expect(result.css).toContain('font-family: "Liteasy-reader-en-0"; src: local("English Reader")');
  expect(result.interfaceFamily).not.toContain("Liteasy-reader");
});

test("persists View preferences without persisting unrelated settings", () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "view.font_size", value: "16" });
  store.apply({ intent: "update_setting", target: "view.display_scale", value: "125" });
  store.apply({ intent: "update_setting", target: "view.pdf_background", value: "mint" });
  const interfaceFont = store.getState()["view.font_family"];
  store.apply({ intent: "update_setting", target: "view.reader_font_family", value: '"Source Han Serif SC", serif' });

  const restored = createSettingsStore().getState();
  expect(restored["view.font_size"]).toBe("16");
  expect(restored["view.display_scale"]).toBe("125");
  expect(restored["view.pdf_background"]).toBe("mint");
  expect(restored["view.reader_font_family"]).toBe('"Source Han Serif SC", serif');
  expect(restored["view.font_family"]).toBe(interfaceFont);
  expect(resolvePdfReadingBackground(restored)).toBe("#edf8ec");
});

test("restores old preferences with complete defaults and constrains invalid zoom values", () => {
  localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.font_size": "18" }));
  const store = createSettingsStore();
  expect(store.getState()).toMatchObject({
    "view.font_size": "18", "view.display_scale": "100", "view.pdf_background": "paper", "view.reader_font_family": defaultReadingFontFamily
  });
  store.apply({ intent: "update_setting", target: "view.display_scale", value: "Infinity" });
  expect(store.getState()["view.display_scale"]).toBe("100");
  store.apply({ intent: "update_setting", target: "view.display_scale", value: "999" });
  expect(createSettingsStore().getState()["view.display_scale"]).toBe("200");
  store.apply({ intent: "update_setting", target: "view.display_scale", value: "20" });
  expect(store.getState()["view.display_scale"]).toBe("75");
});

test("invalid stored reader fonts fall back without discarding other view settings", () => {
  localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.reader_font_family": { family: "invalid" }, "view.font_size": "16" }));
  expect(createSettingsStore().getState()).toMatchObject({ "view.reader_font_family": defaultReadingFontFamily, "view.font_size": "16" });
});

test("uses white as a safe fallback for an incomplete custom color", () => {
  expect(resolvePdfReadingBackground({
    "view.pdf_background": "custom",
    "view.pdf_custom_background": "not-a-color"
  })).toBe("#ffffff");
});


test("auto-closes empty panels by default, persists opting out, and rejects invalid old data", () => {
  expect(createSettingsStore().getState()["view.close_empty_panels"]).toBe(true);
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "view.close_empty_panels", value: false });
  expect(createSettingsStore().getState()["view.close_empty_panels"]).toBe(false);
  expect(() => store.apply({ intent: "update_setting", target: "view.close_empty_panels", value: "false" })).toThrow();
  localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.close_empty_panels": "false" }));
  expect(createSettingsStore().getState()["view.close_empty_panels"]).toBe(true);
});

test("Markdown live preview is the default and manual mode/autosave preferences persist with validation", () => {
  const store = createSettingsStore();
  expect(store.getState()["view.markdown_mode"]).toBe("live");
  expect(store.getState()["view.markdown_autosave"]).toBe(true);
  store.apply({ intent: "update_setting", target: "view.markdown_mode", value: "manual" });
  store.apply({ intent: "update_setting", target: "view.markdown_autosave", value: false });
  expect(createSettingsStore().getState()).toMatchObject({ "view.markdown_mode": "manual", "view.markdown_autosave": false });
  expect(() => store.apply({ intent: "update_setting", target: "view.markdown_mode", value: "unknown" })).toThrow();
  localStorage.setItem("liteasy.view-settings.v1", '{"view.markdown_mode":"future-mode"}');
  expect(createSettingsStore().getState()["view.markdown_mode"]).toBe("live");
});

test("persists night reading and original image colors independently from the application theme", () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "view.pdf_background", value: "night" });
  store.apply({ intent: "update_setting", target: "view.pdf_preserve_images", value: false });
  const restored = createSettingsStore().getState();
  expect(restored["view.pdf_background"]).toBe("night");
  expect(restored["view.pdf_preserve_images"]).toBe(false);
  expect(resolvePdfReadingBackground(restored)).toBe("#20252a");
});
