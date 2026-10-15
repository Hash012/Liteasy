import { afterEach, expect, test, vi } from "vitest";
import { enrichRecommendationCandidates } from "../app/features/recommendations/recommendationPaperEvidence";
import { parsePaperReadingSections, parsePdfReadingSections } from "../app/features/paper-services/paperReadingSections";
import { savePaperServiceKey, deletePaperServiceKey } from "../app/features/paper-services/paperServiceTransport";
import { hashText } from "../app/features/context/objectContext";
import type { RecommendationItem } from "../app/features/recommendations/recommendation.types";

const config = { provider: "crossref" as const, endpoint: "https://api.crossref.org" };
const abstract = "We investigate graph retrieval with structured filters and show improved search accuracy across several benchmark datasets.";
const introduction = "Existing approaches struggle with selective filters. This paper introduces a graph traversal method that preserves recall and reduces the number of distance computations.";
const item = (extra: Partial<RecommendationItem> = {}): RecommendationItem => ({ id: "doi:10.1234/graph", title: "Filtered graph retrieval", source: "crossref", sourceKind: "live", discoveredAt: "2026-10-15", relatedDocumentTitle: "Graphs", relevanceBand: "high", relevanceScore: .8, reason: "Related research", ...extra });
const run = (items: RecommendationItem[]) => enrichRecommendationCandidates(config, items, new AbortController().signal);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("obtains a DOI-verified abstract and introduction from open Europe PMC XML with provenance", async () => {
  const fetch = vi.fn(async (input: URL) => {
    const url = String(input);
    if (url.includes("api.crossref.org")) return Response.json({ message: { DOI: "10.1234/graph" } });
    if (url.includes("/search?")) return Response.json({ resultList: { result: [{ doi: "10.1234/graph", pmcid: "PMC1234", isOpenAccess: "Y", abstractText: `<p>${abstract}</p>` }] } });
    return new Response(`<article><front><article-meta><article-id pub-id-type="doi">10.1234/graph</article-id></article-meta></front><body><sec><title>Introduction</title><p>${introduction}</p></sec><sec><title>Results</title><p>Excluded later section.</p></sec></body></article>`);
  });
  vi.stubGlobal("fetch", fetch);
  const original = item();
  const [result] = await run([original]);
  expect(result.abstract).toBe(abstract);
  expect(result.introduction).toBe(introduction);
  expect(result.contentEvidence).toEqual([
    expect.objectContaining({ section: "abstract", source: "europe-pmc", textHash: await hashText(abstract), sourceUrl: expect.stringContaining("/search?") }),
    expect.objectContaining({ section: "introduction", source: "europe-pmc", textHash: await hashText(introduction), sourceUrl: expect.stringContaining("PMC1234/fullTextXML") }),
  ]);
  expect(original.abstract).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("reads arXiv HTML sections and excludes references, scripts and unrelated later sections", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(`<meta name="citation_arxiv_id" content="2401.02954"><div class="ltx_abstract"><h6>Abstract</h6>${abstract}</div><section class="ltx_section"><h2><span>1 </span>Introduction</h2><p>${introduction}</p><script>execute()</script></section><section><h2>2 Results</h2>Excluded result</section>`)));
  const [result] = await run([item({ id: "arxiv:2401.02954", sourceUrl: "https://arxiv.org/abs/2401.02954", abstract })]);
  expect(result.introduction).toBe(introduction);
  expect(result.contentEvidence).toContainEqual(expect.objectContaining({ source: "arxiv", section: "introduction", sourceUrl: "https://arxiv.org/html/2401.02954" }));
});

test("falls back from a configured authenticated metadata service without forwarding its key", async () => {
  const selected = { provider: "semantic-scholar" as const, endpoint: "https://api.semanticscholar.org/graph/v1" };
  await savePaperServiceKey(selected, "test-only-private-key");
  const fetch = vi.fn(async (input: URL, options: RequestInit) => {
    if (String(input).includes("semanticscholar.org")) {
      expect(options.headers).toMatchObject({ "x-api-key": "test-only-private-key" });
      return new Response("", { status: 401 });
    }
    expect(options.headers ?? {}).not.toHaveProperty("x-api-key");
    expect(String(input)).not.toContain("test-only-private-key");
    if (String(input).includes("crossref.org")) return Response.json({ message: { DOI: "10.1234/graph", abstract } });
    return new Response("", { status: 503 });
  });
  vi.stubGlobal("fetch", fetch);
  try {
    const [result] = await enrichRecommendationCandidates(selected, [item()], new AbortController().signal);
    expect(result.abstract).toBe(abstract);
    expect(result.introduction).toBeUndefined();
    expect(result.contentEvidence?.[0].sourceUrl).toContain("api.crossref.org");
  } finally { await deletePaperServiceKey(selected); }
});

test.each(["different-doi", "not-open", "xml-mismatch"])("does not attach unrelated or non-open introduction content: %s", async condition => {
  const fetch = vi.fn(async (input: URL) => {
    if (String(input).includes("/search?")) return Response.json({ resultList: { result: [{ doi: condition === "different-doi" ? "10.1234/other" : "10.1234/graph", pmcid: "PMC1234", isOpenAccess: condition === "not-open" ? "N" : "Y" }] } });
    return new Response(`<article><article-meta><article-id pub-id-type="doi">10.1234/other</article-id></article-meta><body><sec><title>Introduction</title><p>${introduction}</p></sec></body></article>`);
  });
  vi.stubGlobal("fetch", fetch);
  const [result] = await run([item({ abstract })]);
  expect(result.introduction).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(condition === "xml-mismatch" ? 2 : 1);
});

test("does not replace a missing identifier with a title-only lookup or invent an introduction", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const [result] = await run([item({ id: "local-without-external-identity" })]);
  expect(fetch).not.toHaveBeenCalled();
  expect(result.abstract).toBeUndefined();
  expect(result.introduction).toBeUndefined();
  expect(parsePaperReadingSections(new DOMParser().parseFromString(`<article><p>${introduction}</p></article>`, "text/html"))).toEqual({});
});

test("keeps the bounded first 24 candidates and serializes public Crossref requests", async () => {
  let active = 0, maximum = 0;
  const fetch = vi.fn(async (input: URL) => {
    if (!String(input).includes("crossref.org")) return Response.json({ resultList: { result: [] } });
    active += 1; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active -= 1;
    const doi = decodeURIComponent(new URL(String(input)).pathname.split("/works/")[1]);
    return Response.json({ message: { DOI: doi, abstract } });
  });
  vi.stubGlobal("fetch", fetch);
  const results = await run(Array.from({ length: 26 }, (_, index) => item({ id: `doi:10.1234/graph${index}` })));
  expect(maximum).toBe(1);
  expect(results).toHaveLength(26);
  expect(results.slice(0, 24).every(result => result.abstract === abstract)).toBe(true);
  expect(results[24].abstract).toBeUndefined();
  expect(fetch.mock.calls.length).toBeLessThanOrEqual(48);
});

test("propagates user cancellation rather than returning an apparently successful empty result", async () => {
  const controller = new AbortController();
  vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); throw new DOMException("cancelled", "AbortError"); }));
  await expect(enrichRecommendationCandidates(config, [item()], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

test("keeps obtained abstracts when the soft reading deadline expires", async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal("fetch", vi.fn(async (_input: URL, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true });
    })));
    const pending = run([item({ abstract })]);
    await vi.advanceTimersByTimeAsync(55_100);
    const [result] = await pending;
    expect(result.abstract).toBe(abstract);
    expect(result.introduction).toBeUndefined();
  } finally { vi.useRealTimers(); }
});

test("does not use an HTML redirect to a different arXiv version", async () => {
  const fetch = vi.fn(async (input: URL) => {
    if (String(input).includes("/pdf/")) return new Response("", { status: 404 });
    const response = new Response(`<section><h2>Introduction</h2><p>${introduction}</p></section>`);
    Object.defineProperty(response, "url", { value: "https://arxiv.org/html/2401.02954v2" });
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  const [result] = await run([item({ id: "arxiv:2401.02954v1", abstract })]);
  expect(result.introduction).toBeUndefined();
});

test("extracts PDF introduction only between explicit section headings and marks an incomplete prefix", () => {
  const document = `Abstract\n${abstract}\n1 Introduction\n${introduction}\n2 Related Work\nLater unrelated text`;
  expect(parsePdfReadingSections(document)).toMatchObject({ abstract, introduction, introductionTruncated: false });
  expect(parsePdfReadingSections(`1 Introduction\n${introduction}`)).toMatchObject({ introduction, introductionTruncated: true });
  expect(parsePdfReadingSections(introduction).introduction).toBeUndefined();
});
