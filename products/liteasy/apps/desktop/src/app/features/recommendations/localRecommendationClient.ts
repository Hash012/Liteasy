import { paperServiceRequest, type PaperServiceConfig } from "../paper-services/paperServiceTransport";
import { readBibliographicMetadata } from "../paper-services/bibliographicMetadata";
import { readableBibliographicTitle } from "../metadata/pdfRecognition";
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
  if (provider === "openalex") return httpsUrl(record(item.best_oa_location).pdf_url);
  if (provider === "semantic-scholar") return httpsUrl(record(item.openAccessPdf).url);
  return undefined;
}

export async function fetchLocalRecommendations(config: PaperServiceConfig, queries: Array<string | RecommendationRequestDocument>, style: RecommendationStyle, signal: AbortSignal): Promise<RecommendationItem[]> {
  const found = new Map<string, RecommendationItem>();
  for (const seed of queries.slice(0, 3)) {
    signal.throwIfAborted();
    if (typeof seed !== "string" && !hasRecommendationDescription(seed)) continue;
    const query = typeof seed === "string" ? seed.trim() : recommendationQuery(seed);
    if (!query) continue;
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
    const response = await paperServiceRequest(config, url.href, { timeoutMs: 20_000, maxResponseBytes: 4 * 1024 * 1024 });
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`文献 API 返回 HTTP ${response.status}，请检查文献服务地址、密钥或配额。`);
    const payload = record(await response.json());
    const items = array(config.provider === "crossref" ? record(payload.message).items : config.provider === "openalex" ? payload.results : payload.data);
    for (const [index, raw] of items.entries()) {
      const item = record(raw);
      const title = readableBibliographicTitle(text(config.provider === "crossref" ? array(item.title)[0] : item.title ?? item.display_name));
      const doi = text(item.DOI ?? item.doi ?? record(item.externalIds).DOI).replace(/^https?:\/\/(?:dx\.)?doi.org\//i, "").toLowerCase();
      const id = doi ? `doi:${doi}` : `${config.provider}:${text(item.id ?? item.paperId)}`;
      if (!title || id.endsWith(":")) continue;
      if (typeof seed !== "string" && (seed.doi?.toLowerCase() === doi || seed.title.toLocaleLowerCase() === title.toLocaleLowerCase())) continue;
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
        discoveredAt: new Date().toISOString(), relatedDocumentTitle: label, relation: "topic_search", relevanceBand: relevanceScore >= 0.65 ? "high" : "medium",
        relevanceScore, source: config.provider, sourceKind: "live",
        sourceUrl: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : undefined,
        ...(openAccessPdfUrl ? { openAccessPdfUrl, openAccessAvailable: true } : {}),
        reason: `根据《${label}》${typeof seed === "string" ? "" : "的题名与主题元信息"}检索；来源：${config.provider}。`,
      };
      if ((found.get(id)?.relevanceScore ?? -1) < relevanceScore) found.set(id, candidate);
    }
  }
  return [...found.values()].sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, 90);
}
