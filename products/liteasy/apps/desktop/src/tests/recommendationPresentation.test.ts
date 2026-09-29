import { expect, test, vi } from "vitest";
import { filterRecommendations, loadRecommendationMetadata } from "../app/features/recommendations/recommendationPresentation";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";
import type { LiteratureAuthorityClient } from "../app/features/paper-identity/literatureAuthorityClient";

const item = { id: "doi:10.1234/memory", title: "Memory", authors: [], source: "crossref", relevanceScore: 0.8 } as RecommendationItem;
test("loads exact source metadata without substituting a near title match", async () => {
  const resolveLiterature = vi.fn().mockResolvedValue({ status: "exact", candidate: { provider: "crossref", record: {
    title: "Memory: An Overview", authors: ["A. Researcher"], abstract: "Evidence and results.", venue: "Research", year: 2024,
    identifiers: [{ kind: "doi", value: "10.1234/memory" }],
  } } });
  const client = { resolveLiterature } as unknown as LiteratureAuthorityClient;
  expect((await loadRecommendationMetadata(item, client)).item).toMatchObject({ title: "Memory: An Overview", abstract: "Evidence and results.", authors: ["A. Researcher"] });
  expect(resolveLiterature.mock.calls[0][0].hints).toEqual({ identifiers: [{ kind: "doi", value: "10.1234/memory" }] });
  resolveLiterature.mockResolvedValue({ status: "exact", candidate: { record: { title: "Another Memory", identifiers: [{ kind: "doi", value: "10.1234/other" }] } } });
  expect((await loadRecommendationMetadata(item, client)).item).toBe(item);
});

test("retains unknown dates and citation counts at the end when sorting", () => {
  const items = [item, { ...item, id: "2024", publishedYear: 2024, citationCount: 20 }, { ...item, id: "2026", publishedAt: "2026-03", citationCount: 0 }];
  expect(filterRecommendations(items, "", false, "", "newest").map((value) => value.id)).toEqual(["2026", "2024", item.id]);
  expect(filterRecommendations(items, "", false, "", "citations").map((value) => value.id)).toEqual(["2024", "2026", item.id]);
  expect(items[0]).toBe(item);
});
