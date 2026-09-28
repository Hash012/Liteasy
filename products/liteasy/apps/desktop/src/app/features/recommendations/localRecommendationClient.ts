import { paperServiceRequest, type PaperServiceConfig } from "../paper-services/paperServiceTransport";
import type { RecommendationItem, RecommendationStyle } from "./recommendation.types";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value.slice(0, 1000) : "";
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
export async function fetchLocalRecommendations(config: PaperServiceConfig, queries: string[], style: RecommendationStyle, signal: AbortSignal): Promise<RecommendationItem[]> {
  const found = new Map<string, RecommendationItem>();
  for (const query of queries.slice(0, 3)) {
    signal.throwIfAborted();
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
      url.searchParams.set("fields", "title,authors,year,externalIds,url,citationCount,publicationDate");
      if (style === "frontier") url.searchParams.set("year", `${new Date().getUTCFullYear() - 2}-`);
    }
    const response = await paperServiceRequest(config, url.href);
    signal.throwIfAborted();
    if (!response.ok) throw new Error(`文献 API 返回 HTTP ${response.status}，请检查文献服务地址、密钥或配额。`);
    const payload = record(await response.json());
    const items = array(config.provider === "crossref" ? record(payload.message).items : config.provider === "openalex" ? payload.results : payload.data);
    for (const [index, raw] of items.entries()) {
      const item = record(raw);
      const title = text(config.provider === "crossref" ? array(item.title)[0] : item.title ?? item.display_name).replace(/<[^>]+>/g, "").trim();
      const doi = text(item.DOI ?? item.doi ?? record(item.externalIds).DOI).replace(/^https?:\/\/doi.org\//i, "").toLowerCase();
      const id = doi ? `doi:${doi}` : `${config.provider}:${text(item.id ?? item.paperId)}`;
      if (!title || id.endsWith(":")) continue;
      const authors = array(item.author ?? item.authorships ?? item.authors).slice(0, 12).map((rawAuthor) => {
        const author = record(rawAuthor); return text(author.name ?? record(author.author).display_name) || [text(author.given), text(author.family)].filter(Boolean).join(" ");
      }).filter(Boolean);
      const year = number(item.year ?? item.publication_year ?? array(array(record(item.published)["date-parts"])[0])[0]);
      const sourceUrl = doi ? `https://doi.org/${doi}` : text(item.URL ?? item.url ?? item.id);
      found.set(id, { id, canonicalId: id, title, authors, publishedYear: year, publishedAt: text(item.publication_date ?? item.publicationDate) || undefined,
        citationCount: number(item["is-referenced-by-count"] ?? item.cited_by_count ?? item.citationCount),
        discoveredAt: new Date().toISOString(), relatedDocumentTitle: query, relation: "topic_search", relevanceBand: index < 10 ? "high" : "medium",
        relevanceScore: Math.max(0.3, 0.9 - index * 0.015), source: config.provider, sourceKind: "live",
        sourceUrl: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : undefined,
        reason: `根据「${query}」检索；由 ${config.provider} 提供文献信息。`,
      });
    }
  }
  return [...found.values()].slice(0, 90);
}
