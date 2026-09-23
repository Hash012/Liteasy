import type { RecommendationItem, RecommendationRequestDocument, RecommendationStyle } from "./recommendation.types";

export const recommendationRankingVersion = "reading-discovery-v2";
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const normalizedTitle = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const stopWords = new Set(["the", "and", "for", "with", "from", "using", "study", "based", "approach", "analysis", "research"]);
function titleTerms(title: string) {
  const normalized = normalizedTitle(title);
  const chinese = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
  return new Set([
    ...(normalized.match(/[a-z0-9][a-z0-9-]+/g) ?? []).filter((word) => !stopWords.has(word)),
    ...chinese.flatMap((run) => Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2))),
  ]);
}
function overlap(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((term) => right.has(term)).length;
  return intersection / Math.max(1, left.size + right.size - intersection);
}
function identity(item: RecommendationItem) {
  const value = item.canonicalId ?? item.sourceUrl ?? item.id;
  return value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "doi:").toLowerCase();
}

/** Styles from older services are ranked locally; current server scores stay authoritative. */
export function rankRecommendations(items: RecommendationItem[], input: {
  style?: RecommendationStyle;
  sortMode?: "relevance" | "retrieved_at";
  selectedDocuments?: RecommendationRequestDocument[];
  now?: Date;
} = {}): RecommendationItem[] {
  const style = input.style ?? "balanced";
  const selectedTitles = new Set(input.selectedDocuments?.map((item) => normalizedTitle(item.title)));
  const selectedIds = new Set(input.selectedDocuments?.map((item) => item.id));
  const ids = new Set<string>(), titles = new Set<string>();
  const candidates = items.filter((item) => Number.isFinite(item.relevanceScore))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .filter((item) => {
      const key = identity(item), title = normalizedTitle(item.title);
      if (selectedIds.has(item.id) || selectedTitles.has(title) || ids.has(key) || titles.has(title) || item.qualityGate?.passed === false) return false;
      ids.add(key); titles.add(title); return true;
    });
  if (input.sortMode === "retrieved_at") {
    return candidates.sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
  }
  if (candidates.every((item) => item.rankingStyle === style && Number.isFinite(item.scoreComponents?.finalScore))) {
    return candidates.sort((a, b) => b.scoreComponents!.finalScore - a.scoreComponents!.finalScore || b.relevanceScore - a.relevanceScore);
  }
  // Balanced remains compatible with older cached scores. New services provide a
  // finalScore containing their richer retrieval and diversity signals.
  if (style === "balanced") return candidates;
  const now = input.now ?? new Date();
  const nowYear = now.getUTCFullYear();
  const scored = candidates.map((item) => {
    const publicationDay = item.publishedAt?.slice(0, 10);
    const date = item.publishedAt && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(item.publishedAt) ? Date.parse(item.publishedAt) : NaN;
    const age = Number.isFinite(date)
      ? date <= now.getTime() && new Date(date).toISOString().slice(0, 10) === publicationDay
        ? (now.getTime() - date) / (365.25 * 86400000) : undefined
      : Number.isInteger(item.publishedYear) && item.publishedYear! >= 1600 && item.publishedYear! <= nowYear
        ? nowYear - item.publishedYear! : undefined;
    const recency = age === undefined ? 0.5 : Math.exp(-age / 2);
    const citations = Number.isFinite(item.citationCount) && item.citationCount! >= 0 ? item.citationCount : undefined;
    const impact = citations === undefined ? 0.5 : clamp(Math.log1p(citations) / Math.log1p(1000));
    const foundational = age !== undefined && age >= 5 && citations !== undefined && citations >= 10
      ? clamp(age / 15) * impact : item.relation === "cited_by_target" ? 0.55 : 0.25;
    const relevance = clamp(item.relevanceScore);
    const score = style === "frontier" ? relevance * (0.72 + recency * 0.26 + impact * 0.02)
      : style === "classic" ? relevance * (0.68 + impact * 0.2 + foundational * 0.12)
        : relevance;
    return { item, score, terms: titleTerms(item.title) };
  });
  const selected: typeof scored = [];
  while (scored.length && selected.length < 100) {
    let best = 0, bestScore = -Infinity;
    scored.forEach((candidate, index) => {
      const similarity = Math.max(0, ...selected.map((prior) => overlap(candidate.terms, prior.terms)));
      const penalty = similarity * (style === "exploratory" ? 0.22 : 0.035);
      const score = candidate.score - penalty;
      if (score > bestScore) { bestScore = score; best = index; }
    });
    selected.push(scored.splice(best, 1)[0]);
  }
  return selected.map(({ item }) => item);
}
