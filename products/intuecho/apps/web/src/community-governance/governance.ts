import type { CommunityAnnotation } from "../community.types";
import type { CommunityPreference } from "./governance.types";

export const reportReasonLabels = { spam: "垃圾或重复内容", harassment: "骚扰或攻击", privacy: "隐私问题", other: "其他具体问题" };
export const reportStatusLabels = { pending: "待处理", resolved: "已处理", dismissed: "未采纳" };
export const resolutionLabels = { reviewed: "已核查并记录", insufficient_evidence: "材料不足", duplicate: "重复提交", outside_scope: "不属此处理范围" };
export function preferenceFor(preferences: CommunityPreference[], targetKind: CommunityPreference["targetKind"], targetId: string): CommunityPreference {
  return preferences.find((item) => item.targetKind === targetKind && item.targetId === targetId) ?? { targetKind, targetId, subscribed: false, muted: false, blocked: false };
}
export function contentFoldReason(annotation: CommunityAnnotation, preferences: CommunityPreference[]): "hidden_author" | "low_rating" | null {
  if (preferenceFor(preferences, "author", annotation.author.id).blocked) return "hidden_author";
  return annotation.ratingCount >= 3 && annotation.ratingAverage !== null && annotation.ratingAverage <= 2 ? "low_rating" : null;
}
