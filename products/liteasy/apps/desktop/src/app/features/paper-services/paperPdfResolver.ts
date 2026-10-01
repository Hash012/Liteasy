import { requestPaperDocument, type FullTextProgress } from "./paperFullTextTransport";
import { readableBibliographicTitle } from "../metadata/pdfRecognition";
import { normalizeLiteratureIdentifier } from "../paper-identity/paperIdentity";
import type { DownloadedExternalPdf } from "../library/externalPdfDownload";
import { hasPaperServiceKey, paperServiceRequest, type PaperServiceConfig } from "./paperServiceTransport";

export type PaperPdfSource = { id: string; doi?: string; arxivId?: string; url?: string; pdfUrl?: string };
export type FullTextAttempt = { stage: "discovery" | "probe" | "download"; source: string; url: string; finalUrl?: string; httpStatus?: number; elapsedMs: number; outcome: string };
function diagnosticUrl(value: string) { try { const url = new URL(value); url.search = ""; url.hash = ""; url.username = ""; url.password = ""; return url.href; } catch { return ""; } }
export type ResolvedPaperPdf = DownloadedExternalPdf & { attempts?: FullTextAttempt[]; downloadId?: string; byteLength?: number; metadata?: { canonicalId?: string; title?: string; authors?: string[]; publishedYear?: number } };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value : "";

/** Only exact identifiers and links supplied by the paper's own record/page are used. */
export function paperPdfIdentity(source: PaperPdfSource) {
  let doi = normalizeLiteratureIdentifier("doi", source.doi || source.id.replace(/^(?:reading-candidate:)?doi:/i, ""));
  let arxivId = normalizeLiteratureIdentifier("arxiv_id", source.arxivId || source.id.replace(/^arxiv:/i, ""));
  try {
    const url = new URL(source.url || "");
    if (/^(?:dx\.)?doi\.org$/i.test(url.hostname)) doi ||= normalizeLiteratureIdentifier("doi", decodeURIComponent(url.pathname.slice(1)));
    if (/^(?:export\.)?arxiv\.org$/i.test(url.hostname)) arxivId ||= normalizeLiteratureIdentifier("arxiv_id", url.pathname.replace(/^\/(?:abs|pdf)\//, "").replace(/\.pdf$/, ""));
  } catch { /* The caller may only have an identifier. */ }
  if (/^10\.48550\/arxiv\./i.test(doi)) arxivId ||= normalizeLiteratureIdentifier("arxiv_id", doi.replace(/^10\.48550\/arxiv\./i, ""));
  return { doi, arxivId };
}
function publicUrl(value: unknown, base?: string) {
  try {
    const url = new URL(text(value), base);
    if (!text(value) || url.protocol !== "https:" || url.username || url.password) return undefined;
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}
function repositoryPdf(value: string) {
  const url = new URL(value);
  if (/^(?:export\.)?arxiv\.org$/.test(url.hostname) && /^\/(abs|pdf)\//.test(url.pathname))
    return `https://arxiv.org/pdf/${url.pathname.replace(/^\/(abs|pdf)\//, "").replace(/\.pdf$/, "")}`;
  if (url.hostname === "openreview.net" && url.pathname === "/forum" && url.searchParams.get("id"))
    return `https://openreview.net/pdf?id=${encodeURIComponent(url.searchParams.get("id")!)}`;
  if (url.hostname === "aclanthology.org" && /^\/[\w.-]+\/?$/.test(url.pathname)) return /\.pdf$/.test(url.pathname) ? value : value.replace(/\/$/, "") + ".pdf";
  return undefined;
}


async function discoverPdfMetadata(source: PaperPdfSource, options: { service?: PaperServiceConfig; signal: AbortSignal }) {
  const { doi, arxivId } = paperPdfIdentity(source);
  const signal = options.signal;
  const urls: string[] = [], pages: string[] = [], failures: string[] = [];
  let metadata: ResolvedPaperPdf["metadata"];
  let reachedSource = false;
  const add = (value: unknown) => { const url = publicUrl(text(value).replace(/^http:/i, "https:")); if (url && !urls.includes(url)) urls.push(url); };
  if (doi || arxivId) {
    const defaults: PaperServiceConfig[] = [
      { provider: "crossref", endpoint: "https://api.crossref.org" },
      { provider: "openalex", endpoint: "https://api.openalex.org" },
      { provider: "semantic-scholar", endpoint: "https://api.semanticscholar.org/graph/v1" },
    ];
    const records = await Promise.allSettled(defaults.filter((config) => doi || config.provider === "semantic-scholar").map(async (fallback) => {
      const config = options.service?.provider === fallback.provider ? options.service : fallback;
      const suffix = config.provider === "crossref" ? `/works/${encodeURIComponent(doi)}`
        : config.provider === "openalex" ? `/works/${encodeURIComponent(`https://doi.org/${doi}`)}`
        : `/paper/${encodeURIComponent(doi ? `DOI:${doi}` : `ARXIV:${arxivId}`)}?fields=title,authors,year,externalIds,openAccessPdf,url`;
      const response = await paperServiceRequest(config, config.endpoint.replace(/\/+$/, "") + suffix, { maxResponseBytes: 2 * 1024 * 1024, timeoutMs: 12_000, signal });
      if (!response.ok) { if (response.status === 404) reachedSource = true; else failures.push(`${config.provider}: HTTP ${response.status}`); return; }
      const payload = object(await response.json());
      const row = config.provider === "crossref" ? object(payload.message) : payload;
      const external = object(row.externalIds);
      const recordDoi = normalizeLiteratureIdentifier("doi", text(row.DOI || row.doi || external.DOI));
      const recordArxiv = normalizeLiteratureIdentifier("arxiv_id", text(external.ArXiv));
      if (doi ? recordDoi !== doi : recordArxiv !== arxivId) return;
      reachedSource = true;
      return { provider: config.provider, row };
    }));
    signal.throwIfAborted();
    const landingPages: unknown[] = [];
    for (const result of records) {
      if (result.status === "rejected") { failures.push(String(result.reason)); continue; }
      if (!result.value) continue;
      const { row, provider } = result.value;
      const title = readableBibliographicTitle(text(Array.isArray(row.title) ? row.title[0] : row.title || row.display_name)).slice(0, 1000);
      const authors = list(row.author || row.authors || row.authorships).slice(0, 100).map((raw) => {
        const author = object(raw); return text(author.name || object(author.author).display_name) || [text(author.given), text(author.family)].filter(Boolean).join(" ");
      }).filter(Boolean).map((author) => author.slice(0, 240));
      const date = list(list(object(row.published)["date-parts"])[0]);
      const year = Number(row.year || row.publication_year || date[0]);
      if (!metadata && title) metadata = { title, ...(authors.length ? { authors } : {}), ...(year >= 1000 && year <= 9999 ? { publishedYear: year } : {}) };
      if (provider === "crossref") {
        for (const raw of list(row.link)) { const link = object(raw); if (text(link["content-type"]).includes("pdf") || /\.pdf(?:$|\?)/i.test(text(link.URL))) add(link.URL); }
        landingPages.push(object(object(row.resource).primary).URL);
      } else if (provider === "openalex") {
        if (object(row.has_content).pdf === true && options.service?.provider === "openalex" && await hasPaperServiceKey(options.service).catch(() => false)) {
          const contentUrl = publicUrl(object(row.content_urls).pdf);
          if (contentUrl && new URL(contentUrl).hostname === "content.openalex.org") add(contentUrl);
        }
        const locations = [row.best_oa_location, ...list(row.locations)].map(object);
        for (const location of locations) add(location.pdf_url);
        for (const location of locations) if (location.is_oa === true) landingPages.push(location.landing_page_url);
      } else { add(object(row.openAccessPdf).url); }
    }
    for (const page of landingPages) { if (publicUrl(page)) add(repositoryPdf(publicUrl(page)!)); }
    for (const page of landingPages) { const url = publicUrl(page); if (url) pages.push(url); }
  }
  return { urls, pages, metadata, reachedSource, failures };
}

/** Links from known repositories can be recognized without fetching a PDF. */
export function knownPaperPdfUrl(source: PaperPdfSource) {
  const { arxivId } = paperPdfIdentity(source);
  const url = publicUrl(source.url);
  return publicUrl(source.pdfUrl) || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined)
    || (url ? repositoryPdf(url) || (/\.pdf(?:$|\?)/i.test(url) ? url : undefined) : undefined);
}

/** Metadata only: filtering must never download every paper's full PDF into memory. */
export async function discoverPaperPdfUrl(source: PaperPdfSource, options: { service?: PaperServiceConfig; signal?: AbortSignal } = {}) {
  options.signal?.throwIfAborted();
  const known = knownPaperPdfUrl(source);
  if (known) return known;
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  const result = await discoverPdfMetadata(source, { ...options, signal });
  signal.throwIfAborted();
  if (result.urls.length) return result.urls[0];
  if (result.failures.length) throw new Error("部分全文来源暂不可用，可稍后重试。");
  return undefined;
}

export async function resolvePaperPdf(source: PaperPdfSource, options: { service?: PaperServiceConfig; signal?: AbortSignal; probe?: boolean; nativeDownload?: boolean; onProgress?: (value: FullTextProgress) => void } = {}): Promise<ResolvedPaperPdf | null> {
  if (source.pdfUrl && !publicUrl(source.pdfUrl)) throw new Error("开放全文地址无效。");
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.probe ? 25_000 : 90_000)]) : AbortSignal.timeout(options.probe ? 25_000 : 90_000);
  const { doi, arxivId } = paperPdfIdentity(source);
  const queue: string[] = [];
  const visited = new Set<string>();
  let metadata: ResolvedPaperPdf["metadata"];
  const failures: string[] = [];
  const attempts: FullTextAttempt[] = [];
  const add = (value: unknown, base?: string) => { const url = publicUrl(text(value).replace(/^http:/i, "https:"), base); if (url && !visited.has(url) && !queue.includes(url)) queue.push(url); };
  add(source.pdfUrl);
  if (arxivId) add(`https://arxiv.org/pdf/${arxivId}`);
  if (publicUrl(source.url)) {
    add(repositoryPdf(publicUrl(source.url)!));
    if (/\.pdf(?:$|\?)/i.test(source.url!)) add(source.url);
  }
  // Try immediately known PDFs before spending any time on metadata services.
  async function drain(): Promise<ResolvedPaperPdf | null> {
    while (queue.length && visited.size < 10) {
      signal.throwIfAborted();
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);
      const started = Date.now();
      let attempt: FullTextAttempt | undefined;
      try {
        const { response, native } = await requestPaperDocument(url, { ...options, signal });
        attempt = { stage: options.probe ? "probe" : "download", source: new URL(url).hostname, url: diagnosticUrl(url), finalUrl: diagnosticUrl(response.url || url), httpStatus: response.status, elapsedMs: Date.now() - started, outcome: response.ok ? "received" : "http-error" };
        attempts.push(attempt);
        if (!response.ok) { if (![404, 410].includes(response.status)) failures.push(`HTTP ${response.status}`); continue; }
        if (native) { attempt.outcome = "pdf"; return { attempts, bytes: new Uint8Array(), ...native, finalUrl: response.url || url, sourceId: source.id,
          ...((metadata || doi) ? { metadata: { ...metadata, ...(doi ? { canonicalId: `doi:${doi}` } : {}) } } : {}) }; }
        const bytes = new Uint8Array(await response.arrayBuffer());
        signal.throwIfAborted();
        if (new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-") {
          attempt.outcome = "pdf";
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
          return { attempts, bytes, contentHash: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""), finalUrl: response.url || url, sourceId: source.id, ...((metadata || doi) ? { metadata: { ...metadata, ...(doi ? { canonicalId: `doi:${doi}` } : {}) } } : {}) };
        }
        attempt.outcome = "html";
        if (url === source.pdfUrl || /\.pdf(?:$|\?)/i.test(url)) failures.push("来源返回网页或登录页，未返回有效 PDF");
        // Parse a bounded, inert page. Never render scripts or follow arbitrary article links.
        if (bytes.length > 2 * 1024 * 1024) continue;
        const page = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "text/html");
        const base = response.url || url;
        const citation = (name: string) => [...page.querySelectorAll("meta[name]")].filter((node) => node.getAttribute("name")?.toLowerCase() === name)
          .map((node) => node.getAttribute("content")?.trim() || "").filter(Boolean);
        if (!metadata && citation("citation_title")[0]) {
          const year = Number((citation("citation_publication_date")[0] || citation("citation_date")[0] || "").slice(0, 4));
          const authors = citation("citation_author").slice(0, 100).map((author) => author.slice(0, 240));
          metadata = { title: readableBibliographicTitle(citation("citation_title")[0]).slice(0, 1000), ...(authors.length ? { authors } : {}), ...(year >= 1000 && year <= 9999 ? { publishedYear: year } : {}) };
        }
        for (const meta of page.querySelectorAll("meta[name], meta[property]")) {
          if (["citation_pdf_url", "wkhealth_pdf_url", "eprints.document_url"].includes((meta.getAttribute("name") || meta.getAttribute("property") || "").toLowerCase())) add(meta.getAttribute("content"), base);
        }
        for (const link of page.querySelectorAll('link[type="application/pdf"], a[type="application/pdf"]')) add(link.getAttribute("href"), base);
        // Some publishers expose only a download control. Do not crawl reference lists.
        for (const link of page.querySelectorAll('a[download], a[href]')) {
          const label = link.textContent?.trim() || "";
          if (/^(?:download\s+)?(?:full[ -]?text\s+)?pdf(?:\s+download)?$/i.test(label)) add(link.getAttribute("href"), base);
        }
      } catch (error) {
        signal.throwIfAborted();
        const message = (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/[^\s)]+/g, diagnosticUrl);
        failures.push(message);
        if (attempt) attempt.outcome = "error";
        else attempts.push({ stage: options.probe ? "probe" : "download", source: new URL(url).hostname, url: diagnosticUrl(url), elapsedMs: Date.now()-started, outcome: "error" });
      }
    }
    return null;
  }
  const immediate = await drain();
  if (immediate) return immediate;
  const discoveryStarted = Date.now();
  const discovered = await discoverPdfMetadata(source, { ...options, signal });
  attempts.push({ stage: "discovery", source: options.service?.provider || "public registries", url: "", elapsedMs: Date.now()-discoveryStarted, outcome: discovered.urls.length ? "candidates" : discovered.failures.length ? "partial-error" : "no-links" });
  metadata ??= discovered.metadata;
  failures.push(...discovered.failures);
  discovered.urls.forEach((url) => { if (!options.probe) visited.delete(url); add(url); });
  discovered.pages.forEach((url) => add(url));
  add(source.url);
  if (doi) add(`https://doi.org/${doi}`);
  const resolved = await drain();
  if (resolved) return resolved;
  signal.throwIfAborted();
  if (failures.length) throw new PaperFullTextError(failures.some((message) => /HTTP (401|403|429)/.test(message)) ? "blocked" : "error", failures, attempts);

  return null;
}

export class PaperFullTextError extends Error {
  constructor(readonly status: "blocked" | "error", readonly diagnostics: string[], readonly attempts: FullTextAttempt[] = []) {
    super(`全文服务暂时未能连接或拒绝访问（${diagnostics[0]?.slice(0, 180)}）。请稍后重试或打开论文网站。`);
  }
}
export type PaperFullTextAvailability = {
  status: "unknown" | "checking" | "available" | "unavailable" | "blocked" | "error";
  checkedAt?: number; url?: string; reason?: string; attempts?: FullTextAttempt[];
};
export async function probePaperPdf(source: PaperPdfSource, options: { service?: PaperServiceConfig; signal?: AbortSignal } = {}): Promise<PaperFullTextAvailability> {
  try {
    const pdf = await resolvePaperPdf(source, { ...options, probe: true });
    return pdf ? { status: "available", attempts: pdf.attempts, url: pdf.finalUrl, checkedAt: Date.now() }
      : { status: "unavailable", checkedAt: Date.now(), reason: "来源尚未提供开放 PDF。" };
  } catch (error) {
    options.signal?.throwIfAborted();
    return { status: error instanceof PaperFullTextError ? error.status : "error", checkedAt: Date.now(), ...(error instanceof PaperFullTextError ? { attempts: error.attempts } : {}), reason: error instanceof Error ? error.message : String(error) };
  }
}
