import { LibraryRepositoryError } from "./libraryRepository.mjs";
import { recommendationStyle } from "./recommendationRanking.mjs";

function normalizedText(value, maximum = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function doiKey(value) {
  const doi = normalizedText(value, 300)
    .replace(/^doi:/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : "";
}

function publication(item, now) {
  const dates = ["published-print", "published-online", "issued"].flatMap((field) => {
    const parts = item?.[field]?.["date-parts"]?.[0];
    if (!Array.isArray(parts)) return [];
    const [year, month, day] = parts;
    if (!Number.isInteger(year) || year < 1600 || year > now.getUTCFullYear() + 1) return [];
    if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) return [];
    if (day !== undefined && (!Number.isInteger(day) || month === undefined || day < 1 ||
      day > new Date(Date.UTC(year, month, 0)).getUTCDate())) return [];
    return [{
      publishedYear: year,
      ...(month !== undefined && day !== undefined ? {
        publishedAt: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      } : {}),
      order: Date.UTC(year, (month ?? 1) - 1, day ?? 1)
    }];
  }).sort((left, right) => left.order - right.order);
  const { order: _, ...metadata } = dates[0] ?? {};
  return metadata;
}

function authors(item) {
  return (Array.isArray(item?.author) ? item.author : []).flatMap((author) => {
    const name = normalizedText([author?.given, author?.family].filter(Boolean).join(" "), 200);
    return name ? [name] : [];
  }).slice(0, 12);
}

function fullTextUrl(item) {
  const links = Array.isArray(item?.link) ? item.link : [];
  return links.find((link) => typeof link?.URL === "string" && link.URL.startsWith("https://") &&
    link["content-type"] === "application/pdf")?.URL;
}

export class CrossrefRecommendationProvider {
  constructor(config, dependencies = {}) {
    this.endpoint = config.endpoint;
    this.mailto = config.mailto;
    this.timeoutMs = config.timeoutMs;
    this.fetch = dependencies.fetch ?? globalThis.fetch;
    this.now = dependencies.now ?? (() => new Date());
  }

  async search(query, limit = 8, options = {}) {
    const normalizedQuery = normalizedText(query, 500);
    if (!normalizedQuery) throw new LibraryRepositoryError("recommendation_query_invalid");
    const style = recommendationStyle(options.style);
    const now = this.now();
    const lanes = ["relevance", ...(style === "classic" ? [] : ["frontier"]),
      ...(style === "frontier" ? [] : ["classic"])];
    const settled = await Promise.allSettled(lanes.map((lane) => this.searchLane(normalizedQuery, limit, lane, now)));
    const complete = settled.filter((result) => result.status === "fulfilled");
    if (!complete.length) throw settled[0].reason;
    // Preserve the relevance lane's rank when a DOI also occurs in a date/citation lane.
    const candidates = new Map();
    for (const result of complete) {
      for (const candidate of result.value) {
        if (!candidates.has(candidate.canonicalId)) candidates.set(candidate.canonicalId, candidate);
      }
    }
    return [...candidates.values()];
  }

  async searchLane(query, limit, lane, now) {
    const url = new URL(this.endpoint);
    url.searchParams.set("query.bibliographic", query);
    url.searchParams.set("rows", String(Math.min(12, Math.max(1, limit))));
    url.searchParams.set("select", "DOI,URL,title,author,issued,published-print,published-online,is-referenced-by-count,score,link,type");
    url.searchParams.set("mailto", this.mailto);
    // https://github.com/CrossRef/rest-api-doc#sorting
    // https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-filters/
    url.searchParams.set("sort", lane === "classic" ? "is-referenced-by-count" : "relevance");
    url.searchParams.set("order", "desc");
    if (lane === "frontier") {
      const since = new Date(now);
      since.setUTCFullYear(since.getUTCFullYear() - 2);
      url.searchParams.set("filter", `from-pub-date:${since.toISOString().slice(0, 10)},until-pub-date:${now.toISOString().slice(0, 10)}`);
    } else if (lane === "classic") {
      const until = new Date(now);
      until.setUTCFullYear(until.getUTCFullYear() - 5);
      url.searchParams.set("filter", `until-pub-date:${until.toISOString().slice(0, 10)}`);
    }
    const controller = new AbortController();
    let timeout;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new LibraryRepositoryError("recommendation_provider_timeout", 502));
      }, this.timeoutMs);
    });
    let payload;
    try {
      payload = await Promise.race([deadline, (async () => {
        const response = await this.fetch(url, {
          headers: {
            accept: "application/json",
            "user-agent": `Liteasy/1.0 (mailto:${this.mailto})`
          },
          signal: controller.signal
        });
        if (!response.ok) throw new LibraryRepositoryError("recommendation_provider_unavailable", 502);
        try {
          return await response.json();
        } catch (error) {
          if (error?.name === "AbortError") throw error;
          throw new LibraryRepositoryError("recommendation_provider_response_invalid", 502);
        }
      })()]);
    } catch (error) {
      if (error instanceof LibraryRepositoryError) throw error;
      throw new LibraryRepositoryError(
        error?.name === "AbortError" ? "recommendation_provider_timeout" : "recommendation_provider_unavailable", 502
      );
    } finally {
      clearTimeout(timeout);
    }
    const items = Array.isArray(payload?.message?.items) ? payload.message.items : null;
    if (!items) throw new LibraryRepositoryError("recommendation_provider_response_invalid", 502);
    return items.slice(0, 12).flatMap((item, index) => {
      const doi = doiKey(item?.DOI);
      const title = normalizedText(Array.isArray(item?.title) ? item.title[0] : item?.title);
      if (!doi || title.length < 5) return [];
      const providerScore = Number.isFinite(Number(item?.score)) ? Number(item.score) : 0;
      const pdfUrl = fullTextUrl(item);
      return [{
        authors: authors(item),
        canonicalId: `doi:${doi}`,
        ...(Number.isSafeInteger(item?.["is-referenced-by-count"]) && item["is-referenced-by-count"] >= 0
          ? { citationCount: item["is-referenced-by-count"] } : {}),
        ...(pdfUrl ? { fullTextUrl: pdfUrl } : {}),
        id: `reading-candidate:doi:${doi}`,
        openAccessAvailable: Boolean(pdfUrl),
        providerRank: index + 1,
        providerScore,
        ...publication(item, now),
        retrievalLane: lane,
        source: "Crossref",
        sourceUrl: `https://doi.org/${doi}`,
        title
      }];
    });
  }
}
