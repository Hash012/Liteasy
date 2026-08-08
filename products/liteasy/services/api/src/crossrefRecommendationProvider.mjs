import { LibraryRepositoryError } from "./libraryRepository.mjs";

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

function publishedYear(item) {
  for (const field of ["published-print", "published-online", "issued", "created"]) {
    const year = item?.[field]?.["date-parts"]?.[0]?.[0];
    if (Number.isInteger(year) && year >= 1600 && year <= new Date().getUTCFullYear() + 1) {
      return year;
    }
  }
  return undefined;
}

function authors(item) {
  return (Array.isArray(item?.author) ? item.author : []).flatMap((author) => {
    const name = normalizedText([author?.given, author?.family].filter(Boolean).join(" "), 200);
    return name ? [name] : [];
  }).slice(0, 12);
}

function fullTextUrl(item) {
  const links = Array.isArray(item?.link) ? item.link : [];
  const candidates = links.filter((link) => (
    typeof link?.URL === "string" && link.URL.startsWith("https://") &&
    link["content-type"] === "application/pdf"
  ));
  return candidates[0]?.URL;
}

export class CrossrefRecommendationProvider {
  constructor(config, dependencies = {}) {
    this.endpoint = config.endpoint;
    this.mailto = config.mailto;
    this.timeoutMs = config.timeoutMs;
    this.fetch = dependencies.fetch ?? globalThis.fetch;
  }

  async search(query, limit = 8) {
    const normalizedQuery = normalizedText(query, 500);
    if (!normalizedQuery) throw new LibraryRepositoryError("recommendation_query_invalid");
    const url = new URL(this.endpoint);
    url.searchParams.set("query.bibliographic", normalizedQuery);
    url.searchParams.set("rows", String(Math.min(12, Math.max(1, limit))));
    url.searchParams.set("select", "DOI,URL,title,author,issued,published-print,published-online,created,score,link,type");
    url.searchParams.set("mailto", this.mailto);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": `Liteasy/1.0 (mailto:${this.mailto})`
        },
        signal: controller.signal
      });
    } catch (error) {
      throw new LibraryRepositoryError(
        error?.name === "AbortError" ? "recommendation_provider_timeout" : "recommendation_provider_unavailable",
        502
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new LibraryRepositoryError("recommendation_provider_unavailable", 502);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new LibraryRepositoryError("recommendation_provider_response_invalid", 502);
    }
    const items = Array.isArray(payload?.message?.items) ? payload.message.items : null;
    if (!items) throw new LibraryRepositoryError("recommendation_provider_response_invalid", 502);
    return items.flatMap((item, index) => {
      const doi = doiKey(item?.DOI);
      const title = normalizedText(Array.isArray(item?.title) ? item.title[0] : item?.title);
      const urlValue = doi ? `https://doi.org/${doi}` : normalizedText(item?.URL, 1000);
      if (!doi || title.length < 5 || !urlValue.startsWith("https://")) return [];
      const providerScore = Number.isFinite(Number(item?.score)) ? Number(item.score) : 0;
      const pdfUrl = fullTextUrl(item);
      return [{
        authors: authors(item),
        canonicalId: `doi:${doi}`,
        ...(pdfUrl ? { fullTextUrl: pdfUrl } : {}),
        id: `reading-candidate:doi:${doi}`,
        openAccessAvailable: Boolean(pdfUrl),
        providerRank: index + 1,
        providerScore,
        publishedYear: publishedYear(item),
        source: "Crossref",
        sourceUrl: urlValue,
        title
      }];
    });
  }
}
