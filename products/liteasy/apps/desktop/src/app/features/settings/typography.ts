import type { SettingsState } from "./settings.types";
import { normalizeReadingFontFamily } from "./readingFonts";
import { viewFontOptions } from "./viewSettings";

export const languageFontKeys = ["view.font_family_zh", "view.font_family_en", "view.reader_font_family_zh", "view.reader_font_family_en"] as const;
export function normalizeLanguageFont(value: unknown): string {
  return typeof value === "string" && value.length <= 512 && !/[\x00-\x1f;{}<>]/.test(value) ? value.trim() : "";
}

export const chineseFontOptions = [
  { label: "微软雅黑", value: '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif' },
  { label: "思源黑体", value: '"Noto Sans CJK SC", "Source Han Sans SC", sans-serif' },
  { label: "宋体", value: 'SimSun, "Songti SC", serif' },
  { label: "思源宋体", value: '"Noto Serif CJK SC", "Source Han Serif SC", serif' },
  { label: "楷体", value: 'KaiTi, STKaiti, serif' },
];
export const englishFontOptions = ["Segoe UI", "Arial", "Georgia", "Cambria", "Times New Roman", "Courier New"]
  .map((name) => ({ label: name, value: `${JSON.stringify(name)}, sans-serif` }));

// Limit local faces to their script: a CJK font often also contains Latin glyphs.
// Separate aliases prevent it from overriding the user's English choice (and vice versa).
const ranges = {
  zh: "U+2E80-2FFF, U+3000-303F, U+3100-312F, U+31A0-31BF, U+31C0-31EF, U+3400-4DBF, U+4E00-9FFF, U+F900-FAFF, U+FE10-FE1F, U+FE30-FE4F, U+FF00-FFEF, U+20000-323AF",
  en: "U+0000-024F, U+0300-036F, U+1E00-1EFF, U+2000-206F, U+20A0-20CF, U+FB00-FB06",
};
const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|inherit)$/i;
function fontNames(stack: string): string[] {
  return (stack.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^,]+/g) ?? []).map((part) => {
    const value = part.trim();
    if (value.startsWith('"')) { try { return JSON.parse(value) as string; } catch { return ""; } }
    return value.replace(/^'|'$/g, "");
  }).filter((name) => name && !generic.test(name));
}
const quote = (value: string) => JSON.stringify(value).replace(/</g, "\\3c ");

/** Shared by the shell, Fluent portals and previews; old font stacks remain valid fallbacks. */
export function resolveTypography(settings: Partial<SettingsState> = {}) {
  const ui = normalizeLanguageFont(settings["view.font_family"]) || viewFontOptions[0].value;
  const reader = normalizeReadingFontFamily(settings["view.reader_font_family"]);
  const rules: string[] = [];
  function family(area: "ui" | "reader", fallback: string) {
    const aliases: string[] = [];
    for (const script of ["en", "zh"] as const) {
      const key = area === "ui" ? `view.font_family_${script}` as const : `view.reader_font_family_${script}` as const;
      let stack = normalizeLanguageFont(settings[key]);
      if (stack === "inherit") stack = normalizeLanguageFont(settings[`view.font_family_${script}`]) || ui;
      fontNames(stack).forEach((name, index) => {
        const alias = `Liteasy-${area}-${script}-${index}`;
        // local() matches a full face/PostScript name, not just a family (e.g. Lato Regular).
        const compact = name.replace(/\s+/g, "");
        const sources = [...new Set([name, `${name} Regular`, `${name}-Regular`, compact, `${compact}-Regular`])]
          .map((face) => `local(${quote(face)})`).join(", ");
        aliases.push(quote(alias));
        rules.push(`@font-face { font-family: ${quote(alias)}; src: ${sources}; unicode-range: ${ranges[script]}; font-display: swap; }`);
      });
    }
    return [...aliases, fallback].join(", ");
  }
  const interfaceFamily = family("ui", ui);
  const readerFamily = family("reader", reader === "inherit" ? interfaceFamily : reader);
  return { interfaceFamily, readerFamily, css: rules.join("\n") };
}
