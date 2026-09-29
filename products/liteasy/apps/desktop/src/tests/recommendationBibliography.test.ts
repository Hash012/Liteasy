import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchLocalRecommendations } from "../app/features/recommendations/localRecommendationClient";
import { hasRecommendationDescription, recommendationDocument, recommendationQuery } from "../app/features/recommendations/recommendationSeed";
import { bibliographicDate, pdfDescriptiveMetadata, readBibliographicMetadata } from "../app/features/paper-services/bibliographicMetadata";
import { createMetadataProviderClient } from "../app/features/paper-services/metadataProviderClient";
import { createLiteratureMetadataRepository } from "../app/features/paper-identity/literatureMetadataRepository";
import { hasRecommendationMetadata } from "../app/controllers/useRecommendationMetadataController";
import { normalizeLiteratureRecord } from "../app/features/paper-identity/literatureRecord";
import { confirmedLiterature } from "./fixtures/confirmedLiterature";

const config = { provider: "crossref" as const, endpoint: "https://api.crossref.org" };
afterEach(() => vi.unstubAllGlobals());

describe("bibliographic discovery", () => {
  test("preserves registry descriptions through confirmation, persistence and recommendation queries", async () => {
    const registry = { DOI: "10.1234/database", title: ["Cicada"], author: [{ given: "Ada", family: "Smith" }],
      subject: ["Database systems", "Concurrency control"], "container-title": ["Database Research"],
      abstract: "<jats:p>Multicore transactions use timestamp ordering and concurrency control for serializable database workloads.</jats:p>",
      published: { "date-parts": [[2024, 6]] } };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: registry })));
    const client = createMetadataProviderClient(config);
    const result = await client.resolveLiterature({ purpose: "liteasy_pdf_annotation", query: registry.DOI });
    if (result.status !== "exact") throw new Error("expected exact DOI");
    const { literature } = await client.confirmLiterature({ candidateKey: result.candidate.candidateKey, mode: "candidate" });
    let snapshot: unknown;
    const repository = createLiteratureMetadataRepository({ isAvailable: () => true,
      saveArtifact: async (input) => { snapshot = input.snapshot; },
      loadArtifact: async <T,>() => snapshot as T });
    await repository.save("paper", literature);
    const restored = await repository.load("paper");
    expect(restored).toMatchObject({ abstract: expect.stringContaining("Multicore transactions"), subjects: ["Database systems", "Concurrency control"], venue: "Database Research", publishedAt: "2024-06" });
    const paper = { id: "paper", title: "local-filename", literature: restored };
    expect(hasRecommendationMetadata(paper)).toBe(true);
    expect(recommendationQuery(recommendationDocument(paper))).toContain("database");
    expect(recommendationQuery(recommendationDocument(paper))).not.toContain("local-filename");
  });

  test("filters homonymous off-topic results despite provider rank and excludes the source DOI", async () => {
    const seed = { id: "paper", title: "Cicada", doi: "10.1234/source", authors: ["Ada Smith"],
      subjects: ["Database concurrency control"], abstract: "Timestamp ordering and multicore transactions improve serializable database execution." };
    const fetch = vi.fn(async (url: URL) => {
      const query = url.searchParams.get("query.bibliographic")!;
      expect(query).toContain("concurrency"); expect(query).toContain("database");
      return Response.json({ message: { items: [
        { DOI: "10.1234/insect", title: ["Cicada wing evolution and insect diversity"], subject: ["Entomology"], "is-referenced-by-count": 9999 },
        { DOI: "10.1234/source", title: ["Original database work"], subject: ["Database concurrency"] },
        { DOI: "10.1234/related", title: ["Timestamp ordering for scalable multicore transactions"], subject: ["Database concurrency"],
          published: { "date-parts": [[2025, 8]] }, author: [{ given: "Ada", family: "Smith" }] }
      ] } });
    });
    vi.stubGlobal("fetch", fetch);
    const results = await fetchLocalRecommendations(config, [seed], "classic", new AbortController().signal);
    expect(results.map((item) => item.id)).toEqual(["doi:10.1234/related"]);
    expect(results[0]).toMatchObject({ relatedDocumentTitle: "Cicada", publishedAt: "2025-08", publishedYear: 2025 });
  });

  test("does not search a confirmed but ambiguous single-word title until descriptive metadata exists", async () => {
    const paper = { id: "short", title: "Orion", literature: confirmedLiterature("Orion") };
    expect(hasRecommendationMetadata(paper)).toBe(false);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(fetchLocalRecommendations(config, [recommendationDocument(paper)], "balanced", new AbortController().signal)).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(hasRecommendationDescription({ id: "different-name", title: "Orion", subjects: ["Database concurrency"] })).toBe(true);
  });

  test("preserves valid old identities if optional descriptive data is malformed", () => {
    const old = confirmedLiterature("A sufficiently descriptive title");
    expect(normalizeLiteratureRecord(old)).toEqual(old);
    expect(normalizeLiteratureRecord({ ...old, abstract: 12, subjects: { huge: true }, publishedAt: "yesterday" })).toMatchObject({ title: old.title, status: "confirmed" });
  });
});

test("reads bounded OpenAlex inverted abstracts and topic metadata", () => {
  expect(readBibliographicMetadata({ abstract_inverted_index: { neural: [0], retrieval: [1], attack: [999999999], broken: ["0"] },
    topics: [{ display_name: "Search", field: { display_name: "Computer Science" } }], keywords: [{ display_name: "Ranking" }],
    publication_date: "2025-11-03" })).toEqual({ abstract: "neural retrieval", subjects: ["Search", "Computer Science"], keywords: ["Ranking"], publishedAt: "2025-11-03" });
});

test.each([[2025], [2025, 6], [2024, 2, 29]])("keeps actual date precision %j", (...parts) => {
  expect(bibliographicDate(parts)).toBe(parts.map((part, index) => index ? String(part).padStart(2, "0") : part).join("-"));
});

test("ignores invalid dates and derives an abstract only from an explicit PDF heading", () => {
  expect(bibliographicDate([2025, 2, 29])).toBeUndefined();
  expect(bibliographicDate([2025, 13])).toBeUndefined();
  expect(pdfDescriptiveMetadata("Title\nAbstract\nWe investigate serializable database execution using multicore timestamp ordering.\nKeywords: databases; transactions\n1 Introduction\nLater text")).toEqual({
    abstract: "We investigate serializable database execution using multicore timestamp ordering.", keywords: ["databases", "transactions"]
  });
  expect(pdfDescriptiveMetadata("Title without any abstract heading or metadata")).toEqual({});
});

test.each([
  ["crossref", { message: { items: [{ DOI: "10.1234/pdf", title: ["Graph networks"], link: [{ URL: "https://publisher.test/article.pdf", "content-type": "application/pdf" }] }] } }],
  ["openalex", { results: [{ id: "https://openalex.org/W1", title: "Graph networks", best_oa_location: { pdf_url: "https://publisher.test/article.pdf" } }] }],
  ["semantic-scholar", { data: [{ paperId: "id", title: "Graph networks", openAccessPdf: { url: "https://publisher.test/article.pdf" } }] }]
] as const)("uses only %s declared PDF links for the local download action", async (provider, payload) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
  const results = await fetchLocalRecommendations({ ...config, provider }, ["graph networks"], "balanced", new AbortController().signal);
  expect(results[0]).toMatchObject({ openAccessAvailable: true, openAccessPdfUrl: "https://publisher.test/article.pdf" });
});
