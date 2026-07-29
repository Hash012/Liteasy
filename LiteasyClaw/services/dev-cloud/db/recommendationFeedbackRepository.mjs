import { readJsonFile, writeJsonFile } from "./jsonFileStore.mjs";

const recommendationFeedbackFilename = "recommendation-feedback.json";
const maximumFeedbackPerUser = 500;

function readState() {
  return readJsonFile(recommendationFeedbackFilename, {});
}

function feedbackKey(feedback) {
  const canonicalId = typeof feedback.canonicalId === "string" ? feedback.canonicalId.trim() : "";
  return canonicalId || feedback.title.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, " ").trim();
}

export function listRecommendationFeedback(userId) {
  const state = readState();
  return Array.isArray(state[userId]) ? state[userId] : [];
}

export function saveRecommendationFeedback(userId, feedback, now = new Date()) {
  const state = readState();
  const current = Array.isArray(state[userId]) ? state[userId] : [];
  const record = {
    action: feedback.action,
    ...(feedback.canonicalId ? { canonicalId: feedback.canonicalId } : {}),
    candidateId: feedback.candidateId,
    createdAt: now.toISOString(),
    source: feedback.source,
    title: feedback.title
  };
  const key = feedbackKey(record);
  state[userId] = [
    record,
    ...current.filter((item) => feedbackKey(item) !== key)
  ].slice(0, maximumFeedbackPerUser);
  writeJsonFile(recommendationFeedbackFilename, state);
  return record;
}

export function resetRecommendationFeedbackData() {
  writeJsonFile(recommendationFeedbackFilename, {});
  return { reset: true };
}
