import { expect, test } from "vitest";
import { estimateRecommendationRequestTokens, estimateRecommendationTextTokens, RECOMMENDATION_AI_BUDGET as budget } from "../app/features/recommendations/recommendationAiBudget";

test("mixed-language estimates distinguish token units from UTF-8 storage bytes", () => {
  const chinese = "带过滤条件的向量近邻检索".repeat(50);
  expect(estimateRecommendationTextTokens(chinese)).toBeLessThan(new TextEncoder().encode(chinese).length);
  const ascii = "vector search query".repeat(50);
  expect(estimateRecommendationTextTokens(ascii)).toBeLessThan(ascii.length);
  expect(estimateRecommendationTextTokens(chinese + ascii)).toBeGreaterThan(estimateRecommendationTextTokens(chinese));
});

test("request reservation includes structured-output schema, message overhead, and bounded completion", () => {
  const schema = { type: "object", properties: { reasons: { type: "array", items: { type: "string" } } } };
  const input = "Research question and two actual abstracts.";
  expect(estimateRecommendationRequestTokens(input, schema)).toBeGreaterThan(estimateRecommendationTextTokens(input) + budget.maxOutputTokens);
  expect(budget.maxRequestTokens - budget.maxOutputTokens).toBe(budget.maxInputTokens);
  expect(budget.maxCandidates).toBe(budget.maxBatches * budget.maxCandidatesPerBatch);
});
