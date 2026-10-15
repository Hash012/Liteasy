import type { RecommendationTask } from "./recommendationCoordinator";
import { recallCitations } from "./recommendationCitationRecall";
import { paperServiceRequest, type PaperServiceConfig } from "../paper-services/paperServiceTransport";
import { readBibliographicMetadata } from "../paper-services/bibliographicMetadata";
import { readableBibliographicTitle } from "../metadata/pdfRecognition";
import { redactDiagnostic } from "../context/objectContext";
import { hasRecommendationDescription, recommendationQuery, recommendationTopicalScore } from "./recommendationSeed";
import type { RecommendationItem, RecommendationRequestDocument, RecommendationStyle } from "./recommendation.types";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value.slice(0, 1000) : "";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
function httpsUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}
function pdfUrl(item: Record<string, unknown>, provider: PaperServiceConfig["provider"]) {
  if (provider === "crossref") return array(item.link).map(record).flatMap((link) => link["content-type"] === "application/pdf" ? [httpsUrl(link.URL)] : []).find(Boolean);
  if (provider === "openalex") return [item.best_oa_location, ...array(item.locations)].map((location) => httpsUrl(record(location).pdf_url)).find(Boolean);
  if (provider === "semantic-scholar") return httpsUrl(record(item.openAccessPdf).url);
  return undefined;
}

export type RecommendationSourceFailure = { provider: PaperServiceConfig["provider"]; message: string; status?: number; fallback: "crossref" };
type RecommendationFetchOptions = { task?: RecommendationTask; citations?: boolean; onCandidates?: (items: RecommendationItem[]) => void; onSourceFailure?: (failure: RecommendationSourceFailure) => void };

export async function fetchLocalRecommendations(config: PaperServiceConfig, queries: Array<string | RecommendationRequestDocument>, style: RecommendationStyle, signal: AbortSignal, options: RecommendationFetchOptions = {}): Promise<RecommendationItem[]> {
  try { return await fetchProviderRecommendations(config, queries, style, signal, options); }
  catch (error) {
    signal.throwIfAborted();
    const fallback = { provider: "crossref" as const, endpoint: "https://api.crossref.org" };
    if (config.provider === fallback.provider && config.endpoint.replace(/\/+$/, "") === fallback.endpoint) throw error;
    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined;
    const failure: RecommendationSourceFailure = { provider: config.provider, status, fallback: "crossref",
      message: redactDiagnostic(error instanceof Error ? error.message : String(error)).slice(0, 1200) };
    options.onSourceFailure?.(failure);
    try { return await fetchProviderRecommendations(fallback, queries, style, signal, options); }
    catch (fallbackError) {
      signal.throwIfAborted();
      throw Object.assign(new Error("配置的文献服务与公开备用来源暂时均无法连接，请稍后重试或检查文献服务设置。"), {
        sourceFailures: [failure, { provider: "crossref", message: redactDiagnostic(fallbackError instanceof Error ? fallbackError.message : String(fallbackError)).slice(0, 1200) }]
      });
    }
  }
}

async function fetchProviderRecommendations(config: PaperServiceConfig, queries: Array<string | RecommendationRequestDocument>, style: RecommendationStyle, signal: AbortSignal, options: RecommendationFetchOptions): Promise<RecommendationItem[]> {
  const found = new Map<string, RecommendationItem>();
  const seeds = queries.slice(0, 16);
  const failures: unknown[] = [];
  let sourceUnavailable = false;
  const graphSeeds = new Set(seeds.filter((seed) => typeof seed !== "string" && seed.doi).slice(0, 3));
  const groups = new Map<string, string[]>();
  async function retrieve(seed: string | RecommendationRequestDocument) {
    signal.throwIfAborted();
    if (typeof seed !== "string" && !hasRecommendationDescription(seed)) return;
    const query = typeof seed === "string" ? seed.trim() : recommendationQuery(seed);
    if (!query) return;
    const label = typeof seed === "string" ? seed : seed.title;
    const url = new URL(config.endpoint.replace(/\/+$/, "") + (config.provider === "semantic-scholar" ? "/paper/search" : "/works"));
    if (config.provider === "crossref") {
      url.searchParams.set("query.bibliographic", query); url.searchParams.set("rows", "30");
      if (style === "classic") { url.searchParams.set("sort", "is-referenced-by-count"); url.searchParams.set("order", "desc"); }
      if (style === "frontier") url.searchParams.set("filter", `from-pub-date:${new Date().getUTCFullYear() - 2}-01-01`);
    } else if (config.provider === "openalex") {
      url.searchParams.set("search", query); url.searchParams.set("per-page", "30");
      if (style === "classic") url.searchParams.set("sort", "cited_by_count:desc");
      if (style === "frontier") url.searchParams.set("filter", `from_publication_date:${new Date().getUTCFullYear() - 2}-01-01`);
    } else {
      url.searchParams.set("query", query); url.searchParams.set("limit", "30");
      url.searchParams.set("fields", "title,authors,year,externalIds,url,citationCount,publicationDate,abstract,fieldsOfStudy,venue,openAccessPdf");
      if (style === "frontier") url.searchParams.set("year", `${new Date().getUTCFullYear() - 2}-`);
    }
    const request = async () => {
      const response = await paperServiceRequest(config, url.href, { timeoutMs: 12_000, maxResponseBytes: 4 * 1024 * 1024, signal });
      if (!response.ok) { const retry = response.headers.get("Retry-After"); throw Object.assign(new Error(`文献 API 返回 HTTP ${response.status}`), { status: response.status, retryAfterMs: retry ? /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) : undefined }); }
      return response;
    };
    const scheduled = options.task?.request as (<T>(kind: "provider", run: () => Promise<T>, units: number, serviceKey?: string) => Promise<T>) | undefined;
    const response = scheduled ? await scheduled("provider", request, 0, `${config.provider}:${config.endpoint}`) : await request();
    signal.throwIfAborted();
    if (!response.ok) throw Object.assign(new Error(`文献 API 返回 HTTP ${response.status}，请检查文献服务地址、密钥或配额。`), { status: response.status });
    const payload = record(await response.json());
    const items = array(config.provider === "crossref" ? record(payload.message).items : config.provider === "openalex" ? payload.results : payload.data);
    ingest(seed, items);
    if (options.citations && typeof seed !== "string" && graphSeeds.has(seed)) {
      try { for (const result of await recallCitations(config, seed, signal, options.task)) ingest(seed, result.items, result.relation); }
      catch { signal.throwIfAborted(); /* Topic results remain usable when a graph source is unavailable. */ }
    }
  }
  function ingest(seed: string | RecommendationRequestDocument, items: unknown[], relation: RecommendationItem["relation"] = "topic_search") {
    const label = typeof seed === "string" ? seed : seed.title;
    const group = groups.get(label) ?? []; groups.set(label, group);
    for (const [index, raw] of items.slice(0, 200).entries()) {
      const item = record(raw);
      const title = readableBibliographicTitle(text(config.provider === "crossref" ? array(item.title)[0] : item.title ?? item.display_name));
      const doi = text(item.DOI ?? item.doi ?? record(item.externalIds).DOI).replace(/^https?:\/\/(?:dx\.)?doi.org\//i, "").toLowerCase();
      const id = doi ? `doi:${doi}` : `${config.provider}:${text(item.id ?? item.paperId)}`;
      if (!title || id.endsWith(":")) continue;
      if (typeof seed !== "string" && (seed.doi?.toLowerCase() === doi)) continue;
      const authors = array(item.author ?? item.authorships ?? item.authors).slice(0, 12).map((rawAuthor) => {
        const author = record(rawAuthor); return text(author.name ?? record(author.author).display_name) || [text(author.given), text(author.family)].filter(Boolean).join(" ");
      }).filter(Boolean);
      const metadata = readBibliographicMetadata(item);
      const year = number(item.year ?? item.publication_year ?? (metadata.publishedAt ? Number(metadata.publishedAt.slice(0, 4)) : undefined));
      const sourceUrl = doi ? `https://doi.org/${doi}` : text(item.URL ?? item.url ?? item.id);
      const topicScore = typeof seed === "string" ? undefined : recommendationTopicalScore(seed, { title, authors, ...metadata });
      if (topicScore === 0) continue;
      const relevanceScore = topicScore === undefined ? Math.max(0.3, 0.9 - index * 0.015) : Math.min(1, 0.15 + topicScore * 0.8 + Math.max(0, 0.05 - index * 0.002));
      const openAccessPdfUrl = pdfUrl(item, config.provider);
      const candidate: RecommendationItem = { ...metadata, id, canonicalId: id, title, authors, publishedYear: year,
        citationCount: number(item["is-referenced-by-count"] ?? item.cited_by_count ?? item.citationCount),
        discoveredAt: new Date().toISOString(), relatedDocumentTitle: label, relation, relevanceBand: relevanceScore >= 0.65 ? "high" : "medium",
        relevanceScore, source: config.provider, sourceKind: "live",
        sourceUrl: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : undefined,
        ...(openAccessPdfUrl ? { openAccessPdfUrl, openAccessAvailable: true } : {}),
        reason: relation !== "topic_search" ? `${relation === "cites_target" ? "引用了" : "被引用于"}《${label}》；来源：${config.provider}。` : `根据《${label}》${typeof seed === "string" ? "" : "的题名与主题元信息"}检索；来源：${config.provider}。`,
      };
      const prior = found.get(id);
      if (!group.includes(id)) group.push(id);
      const merged = !prior || prior.relevanceScore < relevanceScore ? candidate : prior;
      found.set(id, { ...merged, relatedDocumentTitles: [...new Set([...(prior?.relatedDocumentTitles ?? []), label])] });
    }
    if (found.size) options.onCandidates?.([...found.values()].slice(0, 200));
  }
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(config.provider === "crossref" ? 1 : 2, seeds.length) }, async () => {
    while (cursor < seeds.length && !signal.aborted && !sourceUnavailable) {
      const seed = seeds[cursor++];
      try { await retrieve(seed); } catch (error) {
        signal.throwIfAborted(); failures.push(error);
        if ([401, 403, 429].includes(Number((error as { status?: number })?.status))) sourceUnavailable = true;
      }
    }
  }));
  signal.throwIfAborted();
  if (!found.size && failures.length) throw failures[0];
  const selected = new Set<string>();
  const rankedGroups = [...groups.values()].map((ids) => ids.sort((a,b) => found.get(b)!.relevanceScore - found.get(a)!.relevanceScore));
  for (let index = 0; selected.size < 200 && rankedGroups.some((group) => index < group.length); index++) {
    for (const group of rankedGroups) if (group[index] && selected.size < 200) selected.add(group[index]);
  }
  return [...selected].map((id) => found.get(id)!);
}
