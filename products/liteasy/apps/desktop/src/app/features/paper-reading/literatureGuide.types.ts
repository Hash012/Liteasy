export const guideModes = { detailed: "详细", balanced: "均衡", advanced: "高阶", auto: "自动" } as const;
export type GuideMode = keyof typeof guideModes;
export type GuideLevel = Exclude<GuideMode, "auto">;
export const guideCategories = { term: "术语", claim: "关键论断", reasoning: "关键推理", insight: "精妙之处", formula: "公式", figure: "图表与数据" } as const;
export type GuideCategory = keyof typeof guideCategories;
export type GuideOptions = { systemPrompt: string; categories: GuideCategory[]; existing: "replace" | "append" };
export const defaultGuideOptions = (): GuideOptions => ({ systemPrompt: "", categories: Object.keys(guideCategories) as GuideCategory[], existing: "replace" });
export type GuideAnnotation = { mode: GuideMode; level: GuideLevel; category: GuideCategory; runId: string };
export function isGuideAnnotation(value: unknown): value is GuideAnnotation {
  if (!value || typeof value !== "object") return false;
  const data = value as GuideAnnotation;
  return Object.prototype.hasOwnProperty.call(guideModes, data.mode) && ["detailed", "balanced", "advanced"].includes(data.level) &&
    Object.prototype.hasOwnProperty.call(guideCategories, data.category) && typeof data.runId === "string" && data.runId.length > 0 && data.runId.length <= 160;
}
