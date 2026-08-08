import {
  listRecommendationFeedback,
  saveRecommendationFeedback
} from "../db/recommendationFeedbackRepository.mjs";

function normalizedString(value, maximumLength) {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : "";
}

export function buildRecommendationFeedbackPayload(body = {}) {
  const action = body.action;
  const candidate = body.candidate;
  const userId = normalizedString(body.sessionId, 180);
  const candidateId = normalizedString(candidate?.id, 240);
  const canonicalId = candidate?.canonicalId === undefined
    ? undefined
    : normalizedString(candidate.canonicalId, 240);
  const source = normalizedString(candidate?.source, 120);
  const title = normalizedString(candidate?.title, 500);
  if ((action !== "saved" && action !== "dismissed") || !userId || !candidateId || !source || !title ||
    (candidate?.canonicalId !== undefined && !canonicalId)) {
    return { error: "invalid_recommendation_feedback" };
  }
  return {
    feedback: saveRecommendationFeedback(userId, {
      action,
      candidateId,
      canonicalId,
      source,
      title
    })
  };
}

export function getRecommendationFeedback(userId) {
  return listRecommendationFeedback(userId);
}
