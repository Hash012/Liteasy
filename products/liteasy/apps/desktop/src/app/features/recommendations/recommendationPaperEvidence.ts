import type { RecommendationContentEvidence, RecommendationItem } from "./recommendation.types";
import { paperServiceRequest, type PaperServiceConfig } from "../paper-services/paperServiceTransport";
import { readBibliographicMetadata } from "../paper-services/bibliographicMetadata";
import { knownPaperPdfUrl, paperPdfIdentity } from "../paper-services/paperPdfResolver";
import { parsePaperReadingSections, parsePdfReadingSections, type PaperReadingSections } from "../paper-services/paperReadingSections";
import { normalizeLiteratureIdentifier } from "../paper-identity/paperIdentity";
import type { RecommendationTask } from "./recommendationCoordinator";

const crossref: PaperServiceConfig = { provider: "crossref", endpoint: "https://api.crossref.org" };
const europePmc = "https://www.ebi.ac.uk/europepmc/webservices/rest";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value : "";
const normalizeDoi = (value: unknown) => normalizeLiteratureIdentifier("doi", text(value));
const queues = new Map<string, Promise<unknown>>();
let lastArxivRequest = 0;

function safeUrl(value?: string) {
  try {
    const url = new URL(value ?? "");
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    for (const key of [...url.searchParams.keys()]) if (/key|token|secret|signature|credential/i.test(key)) url.searchParams.delete(key);
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}
function pause(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
async function contentHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Explicit AI reading only: no background PDF downloads and no cross-account cache. */
export async function enrichRecommendationCandidates(
  config: PaperServiceConfig | undefined,
  items: RecommendationItem[],
  signal: AbortSignal,
  task?: RecommendationTask,
): Promise<RecommendationItem[]> {
  signal.throwIfAborted();
  const service = config && ["crossref", "openalex", "semantic-scholar"].includes(config.provider) ? config : crossref;
  const expiry = new AbortController();
  const revoked = new AbortController();
  const timer = setTimeout(() => expiry.abort(), 55_000);
  const workSignal = AbortSignal.any([signal, expiry.signal, revoked.signal]);
  const output = items.map(item => ({ ...item, contentEvidence: item.contentEvidence ? [...item.contentEvidence] : undefined }));
  const candidates = output.slice(0, 24);
  const pmcRecords = new Map<string, Record<string, unknown> | undefined>();
  const pdfUrls = new Map<string, string>();
  const unavailableMetadata = new Set<string>();
  let requests = 0;
  let pdfDownloads = 0;

  async function assertActive() {
    workSignal.throwIfAborted();
    if (task && !await task.active()) {
      revoked.abort(new DOMException("推荐上下文或访问权限已变化，请重新发起。", "AbortError"));
      revoked.signal.throwIfAborted();
    }
    workSignal.throwIfAborted();
  }

  async function request(url: string, sourceConfig = crossref, authenticate = false, pdf = false) {
    await assertActive();
    if (requests >= 48) throw new Error("本次论文内容读取已达到请求上限。");
    requests += 1;
    const target = new URL(url);
    const sourceKey = authenticate ? `${sourceConfig.provider}:${sourceConfig.endpoint}` : target.origin;
    const serialKey = target.hostname === "api.crossref.org" ? "crossref" : /^(?:export\.)?arxiv\.org$/.test(target.hostname) ? "arxiv" : undefined;
    const run = async () => {
      workSignal.throwIfAborted();
      if (serialKey === "arxiv") { await pause(Math.max(0, 3000 - (Date.now() - lastArxivRequest)), workSignal); lastArxivRequest = Date.now(); }
      const fetch = async () => {
        // Recheck the feed's expanded evidence/feedback permissions after any queue wait.
        await assertActive();
        const response = await paperServiceRequest(sourceConfig, url, { authenticate, signal: workSignal,
          followPublicRedirects: !authenticate, timeoutMs: pdf ? 8_000 : 5_000, maxResponseBytes: (pdf ? 8 : 2) * 1024 * 1024 });
        if (!response.ok) throw Object.assign(new Error(`论文来源暂时无法读取（HTTP ${response.status}）。`), { status: response.status });
        return response;
      };
      // The optional fourth argument isolates provider cooldowns in newer coordinators.
      const scheduled = task?.request as (<T>(kind: "provider", run: () => Promise<T>, units: number, serviceKey?: string) => Promise<T>) | undefined;
      return scheduled ? scheduled("provider", fetch, 0, sourceKey) : fetch();
    };
    if (!serialKey) return run();
    const pending = (queues.get(serialKey) ?? Promise.resolve()).catch(() => {}).then(run);
    queues.set(serialKey, pending);
    try { return await pending; } finally { if (queues.get(serialKey) === pending) queues.delete(serialKey); }
  }
  async function preserve(item: RecommendationItem, section: "abstract" | "introduction", value: string | undefined,
    sourceUrl: string, source: RecommendationContentEvidence["source"], truncated = false) {
    if (!value?.trim() || !safeUrl(sourceUrl)) return;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length < (section === "abstract" ? 40 : 80)) return;
    const limit = section === "abstract" ? 12000 : 16000;
    const bounded = normalized.slice(0, limit);
    item[section] = bounded;
    item.contentEvidence = [...(item.contentEvidence ?? []).filter(entry => entry.section !== section), {
      section, sourceUrl: safeUrl(sourceUrl)!, source, retrievedAt: new Date().toISOString(),
      textHash: await contentHash(bounded), ...(truncated || normalized.length > limit ? { truncated: true } : {})
    }];
  }
  async function acceptSections(item: RecommendationItem, sections: PaperReadingSections, url: string, source: RecommendationContentEvidence["source"]) {
    if (!item.abstract) await preserve(item, "abstract", sections.abstract, url, source);
    if (!item.introduction) await preserve(item, "introduction", sections.introduction, url, source, sections.introductionTruncated);
  }
  function identity(item: RecommendationItem) {
    return paperPdfIdentity({ id: item.canonicalId || item.id, doi: item.identityResolution?.doi,
      arxivId: item.identityResolution?.arxivId, url: item.sourceUrl });
  }
  async function metadata(item: RecommendationItem, selected: PaperServiceConfig) {
    const serviceKey = `${selected.provider}:${selected.endpoint}`;
    if (unavailableMetadata.has(serviceKey)) return;
    const { doi, arxivId } = identity(item);
    if (!doi && (selected.provider !== "semantic-scholar" || !arxivId)) return;
    const suffix = selected.provider === "crossref" ? `/works/${encodeURIComponent(doi)}`
      : selected.provider === "openalex" ? `/works/${encodeURIComponent(`https://doi.org/${doi}`)}`
        : `/paper/${encodeURIComponent(doi ? `DOI:${doi}` : `ARXIV:${arxivId}`)}?fields=title,abstract,externalIds,openAccessPdf`;
    const url = selected.endpoint.replace(/\/+$/, "") + suffix;
    let payload: Record<string, unknown>;
    try { payload = object(await (await request(url, selected, true)).json()); }
    catch (error) {
      if ([401, 403, 429].includes(Number((error as { status?: number })?.status))) unavailableMetadata.add(serviceKey);
      throw error;
    }
    const row = selected.provider === "crossref" ? object(payload.message) : payload;
    const external = object(row.externalIds);
    if (doi ? normalizeDoi(row.DOI || row.doi || external.DOI) !== doi
      : normalizeLiteratureIdentifier("arxiv_id", text(external.ArXiv)).replace(/v\d+$/, "") !== arxivId.replace(/v\d+$/, "")) return;
    await preserve(item, "abstract", readBibliographicMetadata(row).abstract, url, "metadata");
    // Use only provider-declared open copies; Crossref links can be paid publisher copies.
    const locations = [row.best_oa_location, ...array(row.locations)].map(object);
    const pdf = selected.provider === "openalex" ? locations.filter(location => location.is_oa === true).map(location => safeUrl(text(location.pdf_url))).find(Boolean)
      : selected.provider === "semantic-scholar" ? safeUrl(text(object(row.openAccessPdf).url)) : undefined;
    if (pdf) pdfUrls.set(item.id, pdf);
  }
  async function pmc(item: RecommendationItem) {
    const { doi } = identity(item);
    if (!doi) return;
    if (pmcRecords.has(doi)) return pmcRecords.get(doi);
    const url = `${europePmc}/search?query=${encodeURIComponent(`DOI:"${doi}"`)}&format=json&resultType=core&pageSize=3`;
    const payload = object(await (await request(url)).json());
    const row = array(object(payload.resultList).result).map(object).find(row => normalizeDoi(row.doi) === doi);
    pmcRecords.set(doi, row);
    if (row && !item.abstract) {
      const plain = new DOMParser().parseFromString(text(row.abstractText), "text/html").body.textContent ?? "";
      await preserve(item, "abstract", plain, url, "europe-pmc");
    }
    return row;
  }
  async function arxiv(item: RecommendationItem, html: boolean) {
    const { arxivId } = identity(item);
    if (!arxivId) return;
    const url = `https://arxiv.org/${html ? "html" : "abs"}/${arxivId}`;
    const response = await request(url);
    const finalUrl = new URL(response.url || url);
    const resolvedId = normalizeLiteratureIdentifier("arxiv_id", finalUrl.pathname.replace(/^\/(?:abs|html)\//, ""));
    if (!/^(?:export\.)?arxiv\.org$/.test(finalUrl.hostname) || (/v\d+$/.test(arxivId)
      ? resolvedId !== arxivId : resolvedId.replace(/v\d+$/, "") !== arxivId)) return;
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    const declaredId = page.querySelector('meta[name="citation_arxiv_id"]')?.getAttribute("content");
    const normalizedId = normalizeLiteratureIdentifier("arxiv_id", declaredId ?? "");
    if (declaredId && (normalizedId.replace(/v\d+$/, "") !== arxivId.replace(/v\d+$/, "")
      || /v\d+$/.test(arxivId) && /v\d+$/.test(normalizedId) && normalizedId !== arxivId)) return;
    await acceptSections(item, parsePaperReadingSections(page), finalUrl.href, "arxiv");
  }
  async function attempt(run: () => Promise<unknown>) {
    try { await run(); } catch {
      signal.throwIfAborted(); revoked.signal.throwIfAborted();
      /* A missing/blocked source does not discard obtained content. */
    }
  }
  async function parallel(run: (item: RecommendationItem) => Promise<void>) {
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(2, candidates.length) }, async () => {
      while (index < candidates.length && !workSignal.aborted && requests < 48) await run(candidates[index++]);
    }));
  }
  try {
    await assertActive();
    // Complete the inexpensive abstracts across the pool before spending time on introductions.
    await parallel(async item => {
      const sourceUrl = safeUrl(item.sourceUrl) ?? (identity(item).doi ? `https://doi.org/${identity(item).doi}` : undefined);
      if (item.abstract && sourceUrl && !item.contentEvidence?.some(entry => entry.section === "abstract")) await preserve(item, "abstract", item.abstract, sourceUrl, "metadata");
      if (item.abstract) return;
      if (identity(item).arxivId) await attempt(() => arxiv(item, false));
      if (!item.abstract) await attempt(() => metadata(item, service));
      if (!item.abstract && service.provider !== "crossref") await attempt(() => metadata(item, crossref));
      if (!item.abstract) await attempt(() => pmc(item));
    });
    await parallel(async item => {
      if (item.introduction) return;
      if (identity(item).arxivId) await attempt(() => arxiv(item, true));
      if (!item.introduction && identity(item).doi) await attempt(async () => {
        const row = await pmc(item);
        if (row?.isOpenAccess !== "Y" || !/^PMC\d+$/.test(text(row.pmcid))) return;
        const url = `${europePmc}/${row.pmcid}/fullTextXML`;
        const xml = new DOMParser().parseFromString(await (await request(url)).text(), "application/xml");
        if (xml.querySelector("parsererror")) return;
        const articleDoi = [...xml.querySelectorAll('article-meta > article-id[pub-id-type="doi"]')].map(node => normalizeDoi(node.textContent));
        if (!articleDoi.includes(identity(item).doi)) return;
        await acceptSections(item, parsePaperReadingSections(xml), url, "europe-pmc");
      });
    });
    // Only a small number of explicit open PDFs are read; never crawl the entire feed.
    await parallel(async item => {
      if (item.introduction || pdfDownloads >= 2) return;
      const known = knownPaperPdfUrl({ id: item.id, arxivId: identity(item).arxivId, url: item.sourceUrl });
      const url = pdfUrls.get(item.id) || (item.openAccessAvailable ? safeUrl(item.openAccessPdfUrl) : undefined) || known;
      if (!url) return;
      pdfDownloads += 1;
      await attempt(async () => {
        const response = await request(url, crossref, false, true);
        const expectedArxiv = identity(item).arxivId;
        const finalUrl = new URL(response.url || url);
        if (/v\d+$/.test(expectedArxiv) && /^(?:export\.)?arxiv\.org$/.test(finalUrl.hostname)
          && normalizeLiteratureIdentifier("arxiv_id", finalUrl.pathname.replace(/^\/pdf\//, "").replace(/\.pdf$/, "")) !== expectedArxiv) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") return;
        const { extractPdfPages } = await import("../import/pdfTextExtractor");
        const pages = await extractPdfPages(bytes, { ocrEnabled: false, maxPages: 4, signal: workSignal });
        await acceptSections(item, parsePdfReadingSections(pages.map(page => page.text).join("\n")), response.url || url, "open-access");
      });
    });
    signal.throwIfAborted();
    revoked.signal.throwIfAborted();
    if (!expiry.signal.aborted) await assertActive();
    return output;
  } finally { clearTimeout(timer); }
}
