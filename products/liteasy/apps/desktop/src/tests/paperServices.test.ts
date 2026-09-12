import { afterEach, expect, test, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createMetadataProviderClient } from "../app/features/paper-services/metadataProviderClient";
import { extractWithConfiguredMineru, parseMineruArchive } from "../app/features/paper-services/mineruServiceClient";
import { deletePaperServiceKey, paperServiceRequest, savePaperServiceKey } from "../app/features/paper-services/paperServiceTransport";
import { loadDurableEntries } from "../app/features/persistence/durableJsonStore";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const paper = { id: "mineru-paper", title: "Paper", sourcePath: "C:\\Library\\paper.pdf" };
function archive() {
  return zipSync({
    "paper/full.md": strToU8("# 方法\n\n![结构图](images/figure.png)\n\nThis is the complete paper."),
    "paper/paper_content_list.json": strToU8(JSON.stringify([
      { type: "text", page_idx: 0, text: "The method compares throughput and memory costs." },
      { type: "image", page_idx: 1, img_path: "images/figure.png", image_caption: ["Model architecture"] }
    ])),
    "paper/images/figure.png": new Uint8Array([137, 80, 78, 71])
  });
}

test("parses the official MinerU archive into persistent Markdown, pages and offline images", () => {
  const result = parseMineruArchive(archive(), paper);
  expect(result.chunks[0]).toMatchObject({ paperId: paper.id, page: 1, textExtraction: "mineru", sourceMarkdown: expect.stringContaining("![结构图]") });
  expect(result.chunks.some((chunk) => chunk.page === 2)).toBe(true);
  expect(result.figures[0]).toMatchObject({ page: 2, alt: "Model architecture", sourcePath: "paper/images/figure.png", dataUrl: expect.stringContaining("data:image/png;base64,") });
  expect(() => parseMineruArchive(zipSync({ "missing.txt": strToU8("no body") }), paper)).toThrow("Markdown 正文");
});

test("resumes an uploaded MinerU batch after a network interruption without reuploading", async () => {
  const config = { provider: "mineru" as const, endpoint: "https://mineru.example.test" };
  await savePaperServiceKey(config, "test-mineru-key");
  const loadPdfSource = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
  let queryCount = 0;
  const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
    if (url.pathname === "/api/v4/file-urls/batch") {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer test-mineru-key" });
      return Response.json({ code: 0, data: { batch_id: "batch-1", file_urls: ["https://files.example.test/upload?signature=test"] } });
    }
    if (url.pathname === "/upload") {
      expect(init?.method).toBe("PUT");
      expect(init?.headers).not.toHaveProperty("Authorization");
      return new Response("", { status: 200 });
    }
    if (url.pathname === "/api/v4/extract-results/batch/batch-1") {
      if (++queryCount === 1) throw new TypeError("Failed to fetch");
      return Response.json({ code: 0, data: { extract_result: [{ state: "done", full_zip_url: "https://files.example.test/result.zip" }] } });
    }
    expect(url.pathname).toBe("/result.zip");
    expect(init?.headers).not.toHaveProperty("Authorization");
    return new Response(archive() as BodyInit);
  });
  vi.stubGlobal("fetch", fetch);
  const input = { config, mode: "official" as const, paper, loadPdfSource };
  await expect(extractWithConfiguredMineru(input)).rejects.toThrow("Failed to fetch");
  expect((await loadDurableEntries("paper-services"))[`mineru:${paper.id}`]).toMatchObject({ batchId: "batch-1", uploaded: true });
  const result = await extractWithConfiguredMineru(input);
  expect(result.chunks.length).toBeGreaterThan(0);
  expect(loadPdfSource).toHaveBeenCalledOnce();
  expect(fetch.mock.calls.filter(([url]) => url.pathname === "/api/v4/file-urls/batch")).toHaveLength(1);
  fetch.mockClear();
  expect(await extractWithConfiguredMineru(input)).toEqual(result);
  expect(fetch).not.toHaveBeenCalled();
  await deletePaperServiceKey(config);
});

test("queries Crossref and confirms an actual registry identifier with offline persistence", async () => {
  const fetch = vi.fn(async (url: URL) => {
    expect(url.pathname).toBe("/works");
    expect(url.searchParams.get("query.bibliographic")).toBe("Attention");
    return Response.json({ message: { items: [{ title: ["Attention Is All You Need"], DOI: "10.5555/3295222.3295349", author: [{ given: "Ashish", family: "Vaswani" }], published: { "date-parts": [[2017]] } }] } });
  });
  vi.stubGlobal("fetch", fetch);
  const config = { provider: "crossref" as const, endpoint: "https://api.crossref.org" };
  const client = createMetadataProviderClient(config);
  const match = await client.resolveLiterature({ purpose: "liteasy_pdf_annotation", query: "Attention" });
  expect(match.status).toBe("ambiguous");
  if (match.status !== "ambiguous") throw new Error("expected candidates");
  const confirmed = await client.confirmLiterature({ candidateKey: match.candidates[0].candidateKey, mode: "candidate" });
  expect(confirmed.literature).toMatchObject({ title: "Attention Is All You Need", authors: ["Ashish Vaswani"], status: "confirmed", year: 2017, identifiers: [expect.objectContaining({ value: "10.5555/3295222.3295349", source: "public_registry" })] });
  expect(await createMetadataProviderClient(config).verifyLiterature({ literatureId: confirmed.literature.literatureId, revision: 1 })).toEqual(confirmed.literature);
});

test.each([
  ["openalex", "https://api.openalex.org", "api_key"],
  ["semantic-scholar", "https://api.semanticscholar.org/graph/v1", "x-api-key"]
] as const)("authenticates %s using its documented field without persisting keys in settings", async (provider, endpoint, field) => {
  const config = { provider, endpoint };
  await savePaperServiceKey(config, "test-public-service-key");
  const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
    if (field === "api_key") expect(url.searchParams.get(field)).toBe("test-public-service-key");
    else expect(init?.headers).toHaveProperty(field, "test-public-service-key");
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);
  await paperServiceRequest(config, endpoint + "/works");
  await expect(paperServiceRequest(config, "https://other.example.test/works")).rejects.toThrow("禁止");
  expect(Object.values(localStorage).join("")).not.toContain("test-public-service-key");
  await deletePaperServiceKey(config);
});

test.each(["crossref", "openalex", "semantic-scholar"] as const)("uses an exact DOI lookup for %s instead of treating a DOI as search words", async (provider) => {
  const doi = "10.1038/nature14539";
  const fetch = vi.fn(async (url: URL) => {
    expect(decodeURIComponent(url.pathname)).toContain(doi);
    expect(url.searchParams.has("search")).toBe(false);
    expect(url.searchParams.has("query.bibliographic")).toBe(false);
    const record = provider === "crossref" ? { DOI: doi, title: ["Deep learning"], author: [] }
      : provider === "openalex" ? { doi: `https://doi.org/${doi}`, title: "Deep learning", authorships: [] }
      : { externalIds: { DOI: doi }, title: "Deep learning", authors: [] };
    return Response.json(provider === "crossref" ? { message: record } : record);
  });
  vi.stubGlobal("fetch", fetch);
  const result = await createMetadataProviderClient({ provider, endpoint: "https://registry.example.test" }).resolveLiterature({ purpose: "liteasy_pdf_annotation", query: `https://doi.org/${doi}` });
  expect(result).toMatchObject({ status: "exact", candidate: { record: { title: "Deep learning" } } });
  expect(fetch).toHaveBeenCalledOnce();
});
