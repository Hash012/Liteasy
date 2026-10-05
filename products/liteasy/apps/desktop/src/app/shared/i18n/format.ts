import type { UiLocale } from "./localePolicy";

const invalidValue = "—";
export function formatUiNumber(value: number, locale: UiLocale, options?: Intl.NumberFormatOptions): string {
  return Number.isFinite(value) ? new Intl.NumberFormat(locale, options).format(value) : invalidValue;
}
export function formatUiDate(value: Date | string | number, locale: UiLocale, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(locale, options ?? { dateStyle: "medium", timeStyle: "short" }).format(date)
    : invalidValue;
}
export function formatUiRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, locale: UiLocale): string {
  return Number.isFinite(value) ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit) : invalidValue;
}
export function formatUiBytes(bytes: number, locale: UiLocale): string {
  if (!Number.isFinite(bytes) || bytes < 0) return invalidValue;
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;
  const index = bytes < 1 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${formatUiNumber(bytes / 1024 ** index, locale, { maximumFractionDigits: index ? 1 : 0 })}\u00a0${units[index]}`;
}
