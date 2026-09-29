import type { RecommendationItem, RecommendationResearchProfile } from "./recommendation.types";
import { recommendationTerms } from "./recommendationSeed";
/** Preference breaks close ties after topic qualification and discovery-style ranking.
 * It never adds candidates or substitutes a filename-only search for metadata. */
export function personalizeRecommendationOrder(items: RecommendationItem[], profile?: RecommendationResearchProfile) {
  const interests = [...new Set(recommendationTerms([...(profile?.topics ?? []), ...(profile?.methods ?? []), ...(profile?.datasets ?? [])].join(" ")))];
  if (!interests.length) return items;
  return items.map((item, index) => {
    const terms = new Set(recommendationTerms([item.title, item.abstract ?? "", ...(item.subjects ?? []), ...(item.keywords ?? [])].join(" ")));
    const matches = interests.filter((term) => terms.has(term)).length;
    // Promote at most two positions, preserving the chosen discovery style.
    return { item, order: index - Math.min(2, matches * 0.6), index };
  }).sort((a, b) => a.order - b.order || a.index - b.index).map(({ item }) => item);
}
