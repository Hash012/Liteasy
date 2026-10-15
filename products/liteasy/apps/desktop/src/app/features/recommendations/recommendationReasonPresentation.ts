import type { RecommendationItem } from "./recommendation.types";

/** Present supplied evidence, never manufacture an individual recommendation rationale. */
export function recommendationReasonText(item: RecommendationItem): string {
  if (item.reasonState === "generating") return "正在生成推荐理由…";
  if (item.reasonState === "failed") return "推荐理由暂未生成，可重新尝试。";
  if (item.reasonState === "stale") return "推荐依据已更新，请重新生成理由。";
  if (item.reasonState === "legacy" || item.reasonState === "unavailable") return "尚无当前资料的推荐理由。";
  return (item.reasonState === "grounded" ? item.researchReason?.text.trim() : undefined) || item.reason?.trim() || "尚无个别推荐理由。";
}
