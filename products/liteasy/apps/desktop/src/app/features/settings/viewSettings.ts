import { message } from "../../shared/i18n/i18n";
import type { SettingsState } from "./settings.types";

export const viewFontOptions = [
  { get label() { return message("view.font.recommended"); }, value: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif' },
  { label: "Microsoft YaHei UI", value: '"Microsoft YaHei UI", "Microsoft YaHei", sans-serif' },
  { label: "Noto Sans CJK SC", value: '"Noto Sans CJK SC", "Source Han Sans SC", sans-serif' },
  { get label() { return message("view.font.systemSans"); }, value: "system-ui, sans-serif" }
] as const;

export const viewFontSizeOptions = [
  { get label() { return message("view.size.13"); }, value: "13" },
  { get label() { return message("view.size.14"); }, value: "14" },
  { get label() { return message("view.size.16"); }, value: "16" },
  { get label() { return message("view.size.18"); }, value: "18" },
  { get label() { return message("view.size.20"); }, value: "20" },
  { get label() { return message("view.size.24"); }, value: "24" }
] as const;

export const viewDisplayScaleOptions = [75, 90, 100, 110, 125, 150, 175, 200].map((scale) => ({
  get label() { return scale === 100 ? message("view.scale.default") : `${scale}%`; },
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
  { get label() { return message("view.pdf.paper"); }, value: "paper", color: "#ffffff" },
  { get label() { return message("view.pdf.warm"); }, value: "warm", color: "#fff7dd" },
  { get label() { return message("view.pdf.mint"); }, value: "mint", color: "#edf8ec" },
  { get label() { return message("view.pdf.night"); }, value: "night", color: "#20252a" },
  { get label() { return message("view.pdf.custom"); }, value: "custom", color: "#ffffff" }
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
