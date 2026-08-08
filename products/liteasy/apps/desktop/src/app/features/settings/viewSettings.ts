import type { SettingsState } from "./settings.types";

export const viewFontOptions = [
  { label: "Segoe UI Variable（推荐）", value: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif' },
  { label: "Microsoft YaHei UI", value: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif' },
  { label: "Noto Sans CJK SC", value: '"Noto Sans CJK SC", "Source Han Sans SC", sans-serif' },
  { label: "系统无衬线", value: "system-ui, sans-serif" }
] as const;

export const viewFontSizeOptions = [
  { label: "紧凑 · 13 px", value: "13" },
  { label: "默认 · 14 px", value: "14" },
  { label: "舒适 · 16 px", value: "16" },
  { label: "大号 · 18 px", value: "18" }
] as const;

export const pdfBackgroundPresets = [
  { label: "纸白", value: "paper", color: "#ffffff" },
  { label: "暖黄护眼", value: "warm", color: "#fff7dd" },
  { label: "浅绿护眼", value: "mint", color: "#edf8ec" },
  { label: "自定义", value: "custom", color: "#ffffff" }
] as const;

export function isHexColor(value: string) {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function resolvePdfReadingBackground(settings: Pick<SettingsState, "view.pdf_background" | "view.pdf_custom_background">) {
  if (settings["view.pdf_background"] === "custom") {
    return isHexColor(settings["view.pdf_custom_background"])
      ? settings["view.pdf_custom_background"]
      : "#ffffff";
  }
  return pdfBackgroundPresets.find((preset) => preset.value === settings["view.pdf_background"])?.color ?? "#ffffff";
}
