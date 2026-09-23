const styles = new Set(["balanced", "frontier", "classic", "exploratory"]);

export function normalizeRecommendationStyle(value) {
  if (value === undefined) return { ok: true, value: "balanced" };
  return typeof value === "string" && styles.has(value)
    ? { ok: true, value }
    : { ok: false, error: "recommendation_style_invalid" };
}

export function recommendationPublicationDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10)
    ? value
    : undefined;
}

function publicationAge(candidate, now) {
  const date = recommendationPublicationDate(candidate.publishedAt);
  if (date) {
    const age = (now.getTime() - Date.parse(date)) / (365.25 * 24 * 60 * 60 * 1000);
    return age >= 0 ? age : undefined;
  }
  const year = candidate.publishedYear;
  return Number.isInteger(year) && year >= 1600 && year <= now.getUTCFullYear()
    ? now.getUTCFullYear() - year
    : undefined;
}

function topicTokens(title) {
  return new Set(String(title ?? "").toLowerCase().match(/[a-z0-9]{3,}|[\u3400-\u9fff]{2}/g) ?? []);
}

function topicSimilarity(left, right) {
  const a = topicTokens(left.title);
  const b = topicTokens(right.title);
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(1, a.size + b.size - intersection);
}

function styleSignal(candidate, style, now, selected) {
  const age = publicationAge(candidate, now);
  if (style === "frontier") return age === undefined ? 0.5 : Math.exp(-age / 2);
  if (style === "classic") {
    // Age alone never constitutes evidence of influence. Missing citation metadata
    // remains unknown; an explicit reference from the selected paper is separate evidence.
    const citations = Number.isSafeInteger(candidate.citationCount) && candidate.citationCount >= 0
      ? Math.min(1, Math.log1p(candidate.citationCount) / Math.log1p(1000))
      : undefined;
    const reference = candidate.relation === "cited_by_target" ? 0.65 : 0;
    const influence = Math.max(citations ?? 0, reference);
    if (age === undefined || (citations === undefined && reference === 0)) return 0.5;
    return Math.min(1, age / 5) * influence;
  }
  return 1 - selected.reduce((maximum, other) => Math.max(maximum, topicSimilarity(candidate, other)), 0);
}

function topicSupport(candidate) {
  if (candidate.relation === "cited_by_target" || candidate.relation === "cites_target") return 1;
  const measured = [
    candidate.scoreComponents?.lexicalRelevance,
    candidate.scoreComponents?.semanticRelevance,
    candidate.scoreComponents?.externalRerankerRelevance
  ].filter((value) => typeof value === "number" && Number.isFinite(value));
  // Metadata cannot make a weak textual/semantic match competitive. When no
  // independent topical signal is available, retain the calibrated relevance bound.
  return measured.length > 0 ? Math.max(0, Math.min(1, Math.max(...measured))) : 1;
}

/** Style is a bounded tie-breaker among relevant, quality-gated candidates.
 * It does not overwrite calibrated relevance or manufacture missing metadata.
 * Balanced preserves the upstream final score; other styles derive from calibrated
 * relevanceScore so reapplying after an external reranker does not compound weights.
 */
export function rankRecommendationStyle(candidates, style = "balanced", now = new Date(), limit = 8) {
  const normalized = normalizeRecommendationStyle(style);
  if (!normalized.ok) throw new Error(normalized.error);
  const remaining = candidates.map((candidate, index) => ({ candidate, index }));
  const selected = [];
  while (remaining.length > 0 && selected.length < limit) {
    const scored = remaining.map(({ candidate, index }) => {
      const relevance = Math.max(0, Math.min(1, Number(candidate.relevanceScore) || 0));
      const signal = style === "balanced" ? 1 : styleSignal(candidate, style, now, selected);
      const upstreamScore = candidate.scoreComponents?.finalScore;
      const finalScore = style === "balanced"
        ? (typeof upstreamScore === "number" && Number.isFinite(upstreamScore) ? upstreamScore : relevance)
        : Number((relevance * (0.75 + 0.25 * signal * topicSupport(candidate))).toFixed(6));
      return {
        candidate: {
          ...candidate,
          rankingStyle: style,
          styleScore: Number(signal.toFixed(6)),
          scoreComponents: {
            ...candidate.scoreComponents,
            finalScore
          }
        },
        index
      };
    });
    // Preserve the established balanced fusion/diversity order exactly.
    if (style !== "balanced") scored.sort((left, right) => right.candidate.scoreComponents.finalScore - left.candidate.scoreComponents.finalScore || left.index - right.index);
    const next = scored[0];
    remaining.splice(remaining.findIndex((entry) => entry.index === next.index), 1);
    selected.push(next.candidate);
  }
  return selected;
}
