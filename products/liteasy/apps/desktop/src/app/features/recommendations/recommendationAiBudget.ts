/** Explicit AI actions are bounded per run; these are estimates, not provider billing. */
export const RECOMMENDATION_AI_BUDGET = Object.freeze({
  maxBatches: 3,
  maxCandidatesPerBatch: 8,
  maxCandidates: 24,
  maxInputTokens: 12_000,
  // Providers can count reasoning against this same completion allowance.
  // Keep room for the bounded JSON decision without changing model settings.
  maxOutputTokens: 4_096,
  maxRequestTokens: 16_096,
  maxRunTokens: 48_288,
  deadlineMs: 180_000
});

/** Mixed-language estimate: never equate UTF-8 bytes with model tokens. */
export function estimateRecommendationTextTokens(text: string) {
  let ascii = 0, other = 0;
  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3 + other * 2);
}

export function estimateRecommendationRequestTokens(prompt: string, schema: Record<string, unknown>) {
  // The existing gateway appends the schema to the prompt. json_schema providers
  // can also receive it as response_format; reserve both plus message overhead.
  return estimateRecommendationTextTokens(prompt) + estimateRecommendationTextTokens(JSON.stringify(schema)) * 2
    + 256 + RECOMMENDATION_AI_BUDGET.maxOutputTokens;
}
