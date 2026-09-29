export const readingFonts = {
  serif: { label: "衬线 · 宋体", family: '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", SimSun, Georgia, serif' },
  sans: { label: "无衬线 · 黑体", family: '"Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
  system: { label: "跟随界面", family: "inherit" },
};
export const readingFontOptions = Object.values(readingFonts).map((font) => ({ label: font.label, value: font.family }));
export const defaultReadingFontFamily = readingFonts.serif.family;
export const defaultReadingFontCss = `var(--reader-font-family, ${defaultReadingFontFamily})`;
export function normalizeReadingFontFamily(value: unknown): string {
  return typeof value === "string" && value.trim() && value.length <= 512 && !/[\x00-\x1f]/.test(value)
    ? value.trim() : defaultReadingFontFamily;
}
