import { keywords } from "../../../../../../packages/recommendation-core/index.mjs";
import type { RecommendationItem } from "./recommendation.types";
export function recommendationKeywords(item: RecommendationItem, corpus: RecommendationItem[] = []) {
  return keywords(item, corpus, item.keywordScores).map((tag) => ({ ...tag, description: `${tag.kind === "method" ? "方法" : tag.kind === "object" ? "研究对象" : "主题"}：${tag.label} · ${tag.source === "provider" ? "文献元数据" : "提取自题名／摘要"}` }));
}
