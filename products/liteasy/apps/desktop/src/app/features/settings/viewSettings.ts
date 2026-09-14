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
  { label: "大号 · 18 px", value: "18" },
  { label: "特大 · 20 px", value: "20" },
  { label: "超大 · 24 px", value: "24" }
] as const;

export const viewDisplayScaleOptions = [75, 90, 100, 110, 125, 150, 175, 200].map((scale) => ({
  label: scale === 100 ? "100%（默认）" : `${scale}%`,
  value: String(scale)
}));

export function normalizeDisplayScale(value: unknown): string {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0
    ? String(Math.min(200, Math.max(75, Math.round(scale))))
    : "100";
}

export function normalizeViewFontSize(value: unknown): string {
  const size = Number(value);
  return Number.isFinite(size) && size > 0
    ? String(Math.min(24, Math.max(12, Math.round(size))))
    : "14";
}

export function stepDisplayScale(value: string, direction: 1 | -1): string {
  const scale = Number(normalizeDisplayScale(value));
  const choices = viewDisplayScaleOptions.map((option) => Number(option.value));
  return String(direction === 1
    ? choices.find((choice) => choice > scale) ?? choices[choices.length - 1]
    : [...choices].reverse().find((choice) => choice < scale) ?? choices[0]);
}

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
