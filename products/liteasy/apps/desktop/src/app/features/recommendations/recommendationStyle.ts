import type { RecommendationStyle } from "./recommendation.types";

export const recommendationStyles: Record<RecommendationStyle, { label: string; description: string }> = {
  balanced: {
    label: "均衡",
    description: "兼顾相关新进展与有引用依据的基础研究。"
  },
  frontier: {
    label: "追踪前沿",
    description: "侧重近期发表的相关工作，帮助追踪领域进展。"
  },
  classic: {
    label: "经典基础",
    description: "侧重与研究主题相关、积累引用的基础文献。"
  },
  exploratory: {
    label: "跨域探索",
    description: "拓展相邻主题与方法，减少相似结果的重复。"
  }
};

export function isRecommendationStyle(value: unknown): value is RecommendationStyle {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(recommendationStyles, value);
}

export function normalizeRecommendationStyle(value: unknown): RecommendationStyle {
  return isRecommendationStyle(value) ? value : "balanced";
}
