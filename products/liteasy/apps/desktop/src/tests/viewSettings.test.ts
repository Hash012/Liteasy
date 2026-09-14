import { afterEach, expect, test } from "vitest";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { resolvePdfReadingBackground } from "../app/features/settings/viewSettings";

afterEach(() => {
  globalThis.localStorage?.removeItem("liteasy.view-settings.v1");
});

test("persists View preferences without persisting unrelated settings", () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "view.font_size", value: "16" });
  store.apply({ intent: "update_setting", target: "view.display_scale", value: "125" });
  store.apply({ intent: "update_setting", target: "view.pdf_background", value: "mint" });

  const restored = createSettingsStore().getState();
  expect(restored["view.font_size"]).toBe("16");
  expect(restored["view.display_scale"]).toBe("125");
  expect(restored["view.pdf_background"]).toBe("mint");
  expect(resolvePdfReadingBackground(restored)).toBe("#edf8ec");
});

test("restores old preferences with complete defaults and constrains invalid zoom values", () => {
  localStorage.setItem("liteasy.view-settings.v1", JSON.stringify({ "view.font_size": "18" }));
  const store = createSettingsStore();
  expect(store.getState()).toMatchObject({
    "view.font_size": "18", "view.display_scale": "100", "view.pdf_background": "paper"
  });
  store.apply({ intent: "update_setting", target: "view.display_scale", value: "Infinity" });
  expect(store.getState()["view.display_scale"]).toBe("100");
  store.apply({ intent: "update_setting", target: "view.display_scale", value: "999" });
  expect(createSettingsStore().getState()["view.display_scale"]).toBe("200");
  store.apply({ intent: "update_setting", target: "view.display_scale", value: "20" });
  expect(store.getState()["view.display_scale"]).toBe("75");
});

test("uses white as a safe fallback for an incomplete custom color", () => {
  expect(resolvePdfReadingBackground({
    "view.pdf_background": "custom",
    "view.pdf_custom_background": "not-a-color"
  })).toBe("#ffffff");
});
