import type { Paper } from "../workspace/workspace.types";
import type { RecommendationItem, RecommendationRequestDocument } from "./recommendation.types";

const stop = new Set("a an and are as at be been by can did do does for from has have how in into is it its not of on or our that the their these this those to use used using was we were what which will with without study based approach analysis research paper present propose proposed results show shows new method methods system systems general other such through across than also more most however demonstrate performance effective efficient different problem work works large novel high first one two three".split(" "));
export function recommendationTerms(value: string): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const latin = (normalized.match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => !/[\u3400-\u9fff]/.test(word) && word.length > 2 && !stop.has(word) && !/^\d+$/.test(word));
  const chinese = (normalized.match(/[\u3400-\u9fff]+/g) ?? []).flatMap((run) => Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)));
  return [...latin, ...chinese];
}

export function recommendationDocument(paper: Paper): RecommendationRequestDocument {
  const metadata = paper.literature;
  const authors = metadata?.authors ?? (Array.isArray(paper.authors) ? [...paper.authors] : typeof paper.authors === "string" ? [paper.authors] : []);
  const year = Number(metadata?.year ?? paper.year);
  const doi = metadata?.identifiers.find((identifier) => identifier.kind === "doi")?.value ?? paper.doi;
  return { id: paper.id, title: metadata?.title ?? paper.title,
    ...(authors.length ? { authors } : {}), ...(doi ? { doi } : {}),
    ...(Number.isInteger(year) && year >= 1000 && year <= 9999 ? { year } : {}),
    ...(metadata?.abstract ? { abstract: metadata.abstract } : {}),
    ...(metadata?.subjects?.length ? { subjects: metadata.subjects } : {}),
    ...(metadata?.keywords?.length ? { keywords: metadata.keywords } : {}),
    ...(metadata?.venue ? { venue: metadata.venue } : {}) };
}

export function recommendationContextTerms(seed: RecommendationRequestDocument): string[] {
  const title = new Set(recommendationTerms(seed.title));
  const explicit = recommendationTerms([...(seed.keywords ?? []), ...(seed.subjects ?? []), seed.venue ?? ""].join(" ")).filter((word) => !title.has(word));
  const frequency = new Map<string, number>();
  for (const term of recommendationTerms(seed.abstract ?? "")) if (!title.has(term)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const abstract = [...frequency].sort((a, b) => b[1] - a[1]).map(([word]) => word);
  return [...new Set([...explicit, ...abstract])].slice(0, 24);
}

export function hasRecommendationDescription(seed: RecommendationRequestDocument) {
  return new Set(recommendationTerms(seed.title)).size >= 3 || recommendationContextTerms(seed).length >= 2;
}

/** Keep the title as a label; the query carries topic evidence beyond its acronym. */
export function recommendationQuery(seed: RecommendationRequestDocument) {
  return `${seed.title} ${recommendationContextTerms(seed).slice(0, 8).join(" ")}`.trim().slice(0, 500);
}

/** Provider rank and citations alone are not evidence of topical relevance. */
export function recommendationTopicalScore(seed: RecommendationRequestDocument, item: Pick<RecommendationItem, "title" | "abstract" | "subjects" | "keywords" | "venue" | "authors">): number {
  const title = [...new Set(recommendationTerms(seed.title))];
  const context = recommendationContextTerms(seed);
  const candidate = new Set(recommendationTerms([item.title, item.abstract ?? "", ...(item.subjects ?? []), ...(item.keywords ?? []), item.venue ?? ""].join(" ")));
  const titleMatches = title.filter((term) => candidate.has(term)).length;
  const contextMatches = context.filter((term) => candidate.has(term)).length;
  const authorMatches = (seed.authors ?? []).some((author) => (item.authors ?? []).some((other) => author.toLocaleLowerCase() === other.toLocaleLowerCase()));
  // An ambiguous acronym/name requires topic evidence even when the same word
  // occurs in the candidate; this prevents unrelated homonyms winning by rank.
  if (title.length < 3 && context.length && contextMatches < 2 && !(contextMatches && authorMatches)) return 0;
  if (title.length >= 3 && titleMatches < 2 && contextMatches < 2 && !(titleMatches && authorMatches)) return 0;
  if (!titleMatches && !contextMatches) return 0;
  return Math.min(1, titleMatches / Math.max(3, title.length) * 0.65 + contextMatches / Math.max(3, Math.min(8, context.length)) * 0.3 + (authorMatches ? 0.05 : 0));
}
