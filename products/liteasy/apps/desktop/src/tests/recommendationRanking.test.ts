import { expect, test } from "vitest";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import { rankRecommendations } from "../app/features/recommendations/recommendationRanking";

const now = new Date("2026-09-21T12:00:00Z");
function paper(id: string, extra: Partial<RecommendationItem> = {}): RecommendationItem {
  return {
    id, title: id, discoveredAt: "2026-09-21T00:00:00Z", relatedDocumentTitle: "Seed",
    relevanceBand: "high", relevanceScore: 0.9, reason: "Related work", source: "Crossref",
    sourceKind: "live", sourceUrl: `https://doi.org/10.1234/${id}`, ...extra
  };
}
const ids = (items: RecommendationItem[]) => items.map((item) => item.id);

test("frontier prioritizes actual publication age while classic favors established related work", () => {
  const papers = [
    paper("foundational", { publishedYear: 2010, citationCount: 2000 }),
    paper("recent", { publishedAt: "2026-08-01", publishedYear: 2026, citationCount: 3 })
  ];
  expect(ids(rankRecommendations(papers, { style: "frontier", now }))).toEqual(["recent", "foundational"]);
  expect(ids(rankRecommendations(papers, { style: "classic", now }))).toEqual(["foundational", "recent"]);
  expect(papers[0].id).toBe("foundational");
});

test("neither style lets weak relevance win through citations or freshness alone", () => {
  const papers = [
    paper("unrelated", { relevanceScore: 0.25, publishedAt: "2026-09-21", citationCount: 1000000 }),
    paper("relevant", { relevanceScore: 0.85, publishedYear: 2018, citationCount: 15 })
  ];
  for (const style of ["frontier", "classic"] as const) {
    expect(rankRecommendations(papers, { style, now })[0].id).toBe("relevant");
  }
});

test("frontier accepts publication timestamps, ignores retrieval age, and gives future dates no freshness boost", () => {
  const papers = [
    paper("future", { publishedAt: "2026-12-01", publishedYear: 2026 }),
    paper("old-but-just-retrieved", { publishedYear: 2010, discoveredAt: "2026-09-21T10:00:00Z" }),
    paper("recent", { publishedAt: "2026-08-01T00:00:00Z", discoveredAt: "2026-08-02T00:00:00Z" }),
    paper("unknown")
  ];
  const ranked = ids(rankRecommendations(papers, { style: "frontier", now }));
  expect(ranked[0]).toBe("recent");
  expect(ranked.indexOf("unknown")).toBeLessThan(ranked.indexOf("old-but-just-retrieved"));
  expect(ids(rankRecommendations(papers, { style: "frontier", sortMode: "retrieved_at", now }))[0]).toBe("old-but-just-retrieved");
});

test("exploratory promotes a different related direction over near-identical titles", () => {
  const papers = [
    paper("first", { title: "Graph Neural Networks", relevanceScore: 0.95 }),
    paper("similar", { title: "Graph Neural Networks Applications", relevanceScore: 0.94 }),
    paper("extension", { title: "Geometric Representation Learning", relevanceScore: 0.88 })
  ];
  expect(ids(rankRecommendations(papers, { style: "exploratory", now }))).toEqual(["first", "extension", "similar"]);
});

test("removes selected papers and duplicate DOI or exact titles while retaining title extensions", () => {
  const papers = [
    paper("original", { canonicalId: "doi:10.1234/test", title: "Graph Retrieval" }),
    paper("duplicate-doi", { canonicalId: "https://doi.org/10.1234/TEST", title: "Other title" }),
    paper("duplicate-title", { title: "GRAPH RETRIEVAL" }),
    paper("extension", { title: "Graph Retrieval at Scale" }),
    paper("selected", { title: "Already Selected" }),
    paper("rejected", { qualityGate: { passed: false, checks: {}, reasons: [], version: "1" } })
  ];
  expect(ids(rankRecommendations(papers, { selectedDocuments: [{ id: "local-id", title: "Already selected" }] })))
    .toEqual(["original", "extension"]);
});

test("uses the server final ranking score rather than topical relevance or style evidence alone", () => {
  const scored = (id: string, relevanceScore: number, styleScore: number, finalScore: number) => paper(id, {
    relevanceScore, styleScore, rankingStyle: "classic",
    scoreComponents: { baseRelevance: relevanceScore, diversityPenalty: 0, finalScore, preference: 0, sourceRelevance: relevanceScore }
  });
  expect(ids(rankRecommendations([
    scored("more-cited", 0.95, 1, 0.65), scored("best-combined", 0.85, 0.8, 0.8)
  ], { style: "classic", now }))).toEqual(["best-combined", "more-cited"]);
});
