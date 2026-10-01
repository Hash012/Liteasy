import { afterEach, expect, test, vi } from "vitest";
import { discoverPaperPdfUrl, knownPaperPdfUrl, paperPdfIdentity, resolvePaperPdf, probePaperPdf } from "../app/features/paper-services/paperPdfResolver";
import { deletePaperServiceKey, savePaperServiceKey } from "../app/features/paper-services/paperServiceTransport";

const doi = "10.1234/memory";
const pdf = "%PDF-1.7\nverified research";
afterEach(() => vi.unstubAllGlobals());
function network(route: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn((url: URL, init?: RequestInit) => route(url, init));
  vi.stubGlobal("fetch", mock); return mock;
}
const absent = () => new Response(null, { status: 404 });

test("resolves an exact Crossref DOI and downloads its PDF without a prior open-access flag", async () => {
  const fetch = network((url) => url.hostname === "api.crossref.org" ? Response.json({ message: {
    DOI: doi, title: ["Episodic memory"], author: [{ given: "Ada", family: "Lovelace" }], published: { "date-parts": [[2024, 6]] },
    link: [{ URL: "https://publisher.test/article.pdf", "content-type": "application/pdf" }],
  } }) : url.hostname === "publisher.test" ? new Response(pdf) : absent());
  const result = await resolvePaperPdf({ id: `doi:${doi}` });
  expect(new TextDecoder().decode(result?.bytes)).toBe(pdf);
  expect(result?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result?.metadata).toEqual({ canonicalId: `doi:${doi}`, title: "Episodic memory", authors: ["Ada Lovelace"], publishedYear: 2024 });
  expect(fetch.mock.calls.some(([url]) => url.href === "https://doi.org/10.1234/memory")).toBe(false);
});

test("tries repository locations when the publisher URL is denied and the best OA location lacks a PDF", async () => {
  const fetch = network((url) => url.hostname === "publisher.test" ? new Response(null, { status: 403 })
    : url.hostname === "api.openalex.org" ? Response.json({ doi: `https://doi.org/${doi}`, best_oa_location: { landing_page_url: "https://repository.test/work" },
      locations: [{ pdf_url: "http://repository.test/accepted.pdf" }] })
    : url.hostname === "repository.test" ? new Response(pdf) : absent());
  const result = await resolvePaperPdf({ id: `doi:${doi}`, pdfUrl: "https://publisher.test/closed.pdf" });
  expect(result?.finalUrl).toBe("https://repository.test/accepted.pdf");
  expect(fetch.mock.calls.filter(([url]) => url.hostname === "publisher.test")).toHaveLength(1);
});

test("reads the citation PDF link on a publisher landing page, resolves relative URLs and ignores scripts/reference links", async () => {
  const fetch = network((url) => url.pathname === "/v235/das24a.html" ? new Response(`<html><head>
    <meta name="citation_title" content="Larimar"><meta name="citation_author" content="Researcher"><meta name="citation_date" content="2024/07/01">
    <meta name="citation_pdf_url" content="./das24a/das24a.pdf?download=1&amp;type=full">
    </head><body><script>fetch('https://malicious.test')</script><a href="https://wrong.test/references.pdf">Reference</a></body></html>`)
    : url.pathname === "/v235/das24a/das24a.pdf" ? new Response(pdf) : absent());
  const result = await resolvePaperPdf({ id: "larimar", url: "https://proceedings.test/v235/das24a.html" });
  expect(result?.finalUrl).toBe("https://proceedings.test/v235/das24a/das24a.pdf?download=1&type=full");
  expect(result?.metadata).toEqual({ title: "Larimar", authors: ["Researcher"], publishedYear: 2024 });
  expect(fetch.mock.calls).toHaveLength(2);
});

test.each([
  { id: "arxiv:2402.12482" },
  { id: "doi:10.48550/arXiv.2402.12482" },
  { id: "x", url: "https://arxiv.org/abs/2402.12482" },
])("uses arXiv identifiers directly and avoids unrelated provider queries: %j", async (source) => {
  const fetch = network(() => new Response(pdf));
  expect((await resolvePaperPdf(source))?.finalUrl).toBe("https://arxiv.org/pdf/2402.12482");
  expect(fetch).toHaveBeenCalledOnce();
});

test("does not infer arXiv identifiers from arbitrary filenames", () => {
  expect(paperPdfIdentity({ id: "Cicada" })).toEqual({ doi: "", arxivId: "" });
});

test("uses Semantic Scholar's exact DOI match, but never a differently identified metadata record", async () => {
  const fetch = network((url) => url.hostname === "api.crossref.org" ? Response.json({ message: { DOI: "10.1234/wrong", link: [{ URL: "https://wrong.test/paper.pdf", "content-type": "application/pdf" }] } })
    : url.hostname === "api.semanticscholar.org" ? Response.json({ externalIds: { DOI: doi }, openAccessPdf: { url: "https://repository.test/paper.pdf" } })
    : url.hostname === "repository.test" ? new Response(pdf) : absent());
  expect((await resolvePaperPdf({ id: `doi:${doi}` }))?.finalUrl).toContain("repository.test");
  expect(fetch.mock.calls.some(([url]) => url.hostname === "wrong.test")).toBe(false);
});

test("uses configured provider credentials only for the registry, never for PDF publishers", async () => {
  const service = { provider: "semantic-scholar" as const, endpoint: "https://custom-registry.test/v1" };
  await savePaperServiceKey(service, "secret");
  network((url, init) => {
    if (url.hostname === "custom-registry.test") {
      expect(init?.headers).toMatchObject({ "x-api-key": "secret" });
      return Response.json({ externalIds: { DOI: doi }, openAccessPdf: { url: "https://publisher.test/paper.pdf" } });
    }
    expect(init?.headers ?? {}).not.toHaveProperty("x-api-key");
    return url.hostname === "publisher.test" ? new Response(pdf) : absent();
  });
  try { expect((await resolvePaperPdf({ id: `doi:${doi}` }, { service }))?.bytes.length).toBeGreaterThan(5); }
  finally { await deletePaperServiceKey(service); }
});

test("bounded page discovery stops loops, rejects HTML-as-PDF, and cancellation prevents further requests", async () => {
  const fetch = network(() => new Response('<meta name="citation_pdf_url" content="https://publisher.test/paper.pdf">', { headers: { "Content-Type": "application/pdf" } }));
  await expect(resolvePaperPdf({ id: "paper", pdfUrl: "https://publisher.test/paper.pdf" })).rejects.toThrow("未返回有效 PDF");
  expect(fetch).toHaveBeenCalledOnce();
  const abort = new AbortController(); abort.abort();
  await expect(resolvePaperPdf({ id: `doi:${doi}` }, { signal: abort.signal })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledOnce();
});

test("distinguishes service failures from a successful lookup with no public PDF", async () => {
  network(() => new Response(null, { status: 503 }));
  await expect(resolvePaperPdf({ id: `doi:${doi}` })).rejects.toThrow("全文服务暂时未能连接或拒绝访问");
});


test("availability discovery resolves repository and registry links without downloading PDF bytes", async () => {
  const fetch = network((url) => url.hostname === "api.openalex.org" ? Response.json({ doi: `https://doi.org/${doi}`,
    locations: [{ is_oa: true, landing_page_url: "https://arxiv.org/abs/2402.12482" }] }) : absent());
  expect(await discoverPaperPdfUrl({ id: `doi:${doi}` })).toBe("https://arxiv.org/pdf/2402.12482");
  expect(fetch.mock.calls.every(([url]) => url.hostname.startsWith("api."))).toBe(true);
  fetch.mockClear();
  expect(await discoverPaperPdfUrl({ id: "arxiv:2402.12482" })).toBe("https://arxiv.org/pdf/2402.12482");
  expect(knownPaperPdfUrl({ id: "x", url: "https://aclanthology.org/2025.acl-long.1.pdf" })).toBe("https://aclanthology.org/2025.acl-long.1.pdf");
  expect(fetch).not.toHaveBeenCalled();
});

test("a partial metadata outage is unknown availability, not a definitive missing PDF", async () => {
  network((url) => url.hostname === "api.crossref.org" ? Response.json({ message: { DOI: doi } }) : new Response(null, { status: 503 }));
  await expect(discoverPaperPdfUrl({ id: `doi:${doi}` })).rejects.toThrow("暂不可用");
});


test.each([403, 429, 503])("does not turn HTTP %s into missing full text", async (status) => {
  network(() => new Response(null, { status }));
  const result = await probePaperPdf({ id: "paper", pdfUrl: "https://repo.test/paper.pdf?token=private" });
  expect(result.status).toBe(status === 503 ? "error" : "blocked");
  expect(result.attempts?.[0]).toMatchObject({ httpStatus: status, stage: "probe", source: "repo.test", url: "https://repo.test/paper.pdf" });
  expect(JSON.stringify(result.attempts)).not.toContain("private");
});

test("probe stops a server that ignores Range and never buffers a whole paper", async () => {
  const cancel = vi.fn(); let pulls = 0;
  network((_url, init) => {
    expect(init?.headers).toMatchObject({ Range: "bytes=0-2097151" });
    return new Response(new ReadableStream({ pull(controller) { pulls++; const data = new Uint8Array(512 * 1024); if (pulls === 1) data.set(new TextEncoder().encode("%PDF-1.7")); controller.enqueue(data); }, cancel }), { headers: { "Content-Length": "100000000" } });
  });
  expect((await probePaperPdf({ id: "arxiv:2402.12482" })).status).toBe("available");
  expect(cancel).toHaveBeenCalledOnce(); expect(pulls).toBeLessThanOrEqual(6);
});
