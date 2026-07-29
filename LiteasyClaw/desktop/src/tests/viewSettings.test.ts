import { afterEach, expect, test } from "vitest";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { resolvePdfReadingBackground } from "../app/features/settings/viewSettings";

afterEach(() => {
  globalThis.localStorage?.removeItem("liteasy.view-settings.v1");
});

test("persists View preferences without persisting unrelated settings", () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "view.font_size", value: "16" });
  store.apply({ intent: "update_setting", target: "view.pdf_background", value: "mint" });

  const restored = createSettingsStore().getState();
  expect(restored["view.font_size"]).toBe("16");
  expect(restored["view.pdf_background"]).toBe("mint");
  expect(resolvePdfReadingBackground(restored)).toBe("#edf8ec");
});

test("uses white as a safe fallback for an incomplete custom color", () => {
  expect(resolvePdfReadingBackground({
    "view.pdf_background": "custom",
    "view.pdf_custom_background": "not-a-color"
  })).toBe("#ffffff");
});
