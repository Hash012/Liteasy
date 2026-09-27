export const paperReadingFonts = {
  serif: { label: "衬线 · 宋体", family: '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", SimSun, Georgia, serif' },
  sans: { label: "无衬线 · 黑体", family: '"Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
  system: { label: "跟随界面", family: "inherit" },
};
export type PaperReadingPreferences = {
  fontSize: number;
  font: keyof typeof paperReadingFonts;
  lineHeight: number;
  width: number;
  alignment: "left" | "justify";
};
export const defaultPaperReadingPreferences: PaperReadingPreferences = {
  fontSize: 18, font: "serif", lineHeight: 1.85, width: 800, alignment: "left",
};
export function loadPaperReadingPreferences(key: string): PaperReadingPreferences {
  let value: Partial<PaperReadingPreferences> | null = null;
  try { value = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { /* Use readable defaults. */ }
  return {
    fontSize: Number.isFinite(value?.fontSize) && value!.fontSize! >= 14 && value!.fontSize! <= 30 ? value!.fontSize! : 18,
    font: value?.font && Object.prototype.hasOwnProperty.call(paperReadingFonts, value.font) ? value.font : "serif",
    lineHeight: [1.5, 1.85, 2.2].includes(value?.lineHeight ?? 0) ? value!.lineHeight! : 1.85,
    width: [640, 800, 1080, 0].includes(value?.width ?? -1) ? value!.width! : 800,
    alignment: value?.alignment === "justify" ? "justify" : "left",
  };
}
