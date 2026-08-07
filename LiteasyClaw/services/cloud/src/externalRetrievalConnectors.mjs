const maximumProviderResponseBytes = 8 * 1024 * 1024;

export const retrievalConnectorEndpoints = Object.freeze({
  crossref: "https://api.crossref.org/works",
  openalex: "https://api.openalex.org/works",
  semantic_scholar: "https://api.semanticscholar.org/graph/v1/paper/search"
});

export class ExternalRetrievalError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function text(value, maximum = 2400) {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum)
    : "";
}

function doiKey(value) {
  const normalized = text(value, 500)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/i.test(normalized) ? normalized : "";
}

function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function authors(values, mapper) {
  return Array.isArray(values) ? values.map(mapper).map((value) => text(value, 200)).filter(Boolean).slice(0, 12) : [];
}

function yearFromCrossref(item) {
  const parts = item?.published_print?.["date-parts"] ??
    item?.published_online?.["date-parts"] ?? item?.issued?.["date-parts"];
  const year = Array.isArray(parts?.[0]) ? parts[0][0] : undefined;
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : undefined;
}

function reconstructAbstract(index) {
  if (!index || typeof index !== "object" || Array.isArray(index)) return "";
  const positions = [];
  for (const [word, offsets] of Object.entries(index)) {
    if (!Array.isArray(offsets)) continue;
    for (const offset of offsets) {
      if (Number.isInteger(offset) && offset >= 0 && offset < 100_000) positions.push([offset, word]);
    }
  }
  return text(positions.sort((left, right) => left[0] - right[0]).map((entry) => entry[1]).join(" "));
}

function crossrefSource(item, query, rank) {
  const sourceId = doiKey(item?.DOI);
  const title = text(Array.isArray(item?.title) ? item.title[0] : item?.title, 1000);
  if (!sourceId || !title) return null;
  const fullTextUrl = Array.isArray(item?.link)
    ? item.link.map((link) => /pdf/i.test(text(link?.["content-type"], 100))
      ? httpsUrl(link?.URL)
      : undefined).find(Boolean)
    : undefined;
  const isRetracted = Array.isArray(item?.["update-to"]) && item["update-to"].some(
    (update) => text(update?.type, 100).toLowerCase() === "retraction"
  );
  return {
    abstract: text(item?.abstract),
    accessStatus: fullTextUrl ? "open_access" : "metadata_only",
    authors: authors(item?.author, (author) => [author?.given, author?.family].filter(Boolean).join(" ")),
    doi: `https://doi.org/${sourceId}`,
    ...(fullTextUrl ? { fullTextUrl } : {}),
    id: `crossref:${sourceId}`,
    ...(isRetracted ? { isRetracted: true } : {}),
    provider: "crossref",
    relation: "topic_search",
    relevance: Number(Math.max(0.2, 1 - rank / 20).toFixed(3)),
    retrievalQuery: query,
    sourceId,
    sourceRecordUrl: `https://api.crossref.org/works/${encodeURIComponent(sourceId)}`,
    title,
    url: `https://doi.org/${sourceId}`,
    ...(yearFromCrossref(item) ? { year: yearFromCrossref(item) } : {})
  };
}

function openAlexSource(item, query, rank) {
  const sourceId = text(item?.id, 200).match(/(?:^|\/)(W\d+)$/i)?.[1]?.toUpperCase();
  const title = text(item?.display_name ?? item?.title, 1000);
  if (!sourceId || !title) return null;
  const doi = doiKey(item?.doi);
  const fullTextUrl = httpsUrl(item?.best_oa_location?.pdf_url) ??
    httpsUrl(item?.primary_location?.pdf_url);
  return {
    abstract: reconstructAbstract(item?.abstract_inverted_index),
    accessStatus: fullTextUrl ? "open_access" : "metadata_only",
    authors: authors(item?.authorships, (authorship) => authorship?.author?.display_name),
    ...(doi ? { doi: `https://doi.org/${doi}` } : {}),
    ...(fullTextUrl ? { fullTextUrl } : {}),
    id: `openalex:${sourceId}`,
    ...(typeof item?.is_retracted === "boolean" ? { isRetracted: item.is_retracted } : {}),
    provider: "openalex",
    relation: "topic_search",
    relevance: Number(Math.max(0.2, 1 - rank / 20).toFixed(3)),
    retrievalQuery: query,
    sourceId,
    sourceRecordUrl: `https://openalex.org/${sourceId}`,
    title,
    url: `https://openalex.org/${sourceId}`,
    ...(Number.isInteger(item?.publication_year) ? { year: item.publication_year } : {})
  };
}

function semanticScholarSource(item, query, rank) {
  const sourceId = text(item?.paperId, 200);
  const title = text(item?.title, 1000);
  if (!/^[A-Za-z0-9-]{8,128}$/.test(sourceId) || !title) return null;
  const doi = doiKey(item?.externalIds?.DOI);
  const fullTextUrl = httpsUrl(item?.openAccessPdf?.url);
  return {
    abstract: text(item?.abstract),
    accessStatus: fullTextUrl ? "open_access" : "metadata_only",
    authors: authors(item?.authors, (author) => author?.name),
    ...(Number.isFinite(item?.citationCount) ? { citationCount: Math.max(0, Math.trunc(item.citationCount)) } : {}),
    ...(doi ? { canonicalPaperId: `doi:${doi}`, doi: `https://doi.org/${doi}` } : {}),
    ...(fullTextUrl ? { fullTextUrl } : {}),
    id: `semantic_scholar:${sourceId}`,
    provider: "semantic_scholar",
    relation: "topic_search",
    relevance: Number(Math.max(0.2, 1 - rank / 20).toFixed(3)),
    retrievalQuery: query,
    sourceId,
    sourceRecordUrl: `https://www.semanticscholar.org/paper/${sourceId}`,
    title,
    url: httpsUrl(item?.url) ?? `https://www.semanticscholar.org/paper/${sourceId}`,
    ...(Number.isInteger(item?.year) ? { year: item.year } : {})
  };
}

async function fetchJson(url, input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await input.fetchImpl(url, {
      headers: input.headers,
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new ExternalRetrievalError("external_retrieval_provider_unavailable", 502);
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > maximumProviderResponseBytes) {
      throw new ExternalRetrievalError("external_retrieval_provider_response_too_large", 502);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumProviderResponseBytes) {
      throw new ExternalRetrievalError("external_retrieval_provider_response_too_large", 502);
    }
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid payload");
    return payload;
  } catch (error) {
    if (error instanceof ExternalRetrievalError) throw error;
    throw new ExternalRetrievalError(
      controller.signal.aborted ? "external_retrieval_provider_timeout" : "external_retrieval_provider_response_invalid",
      502
    );
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
  }
}

export function createExternalRetrievalConnectors(config, { fetchImpl = fetch } = {}) {
  const commonHeaders = {
    Accept: "application/json",
    "User-Agent": `Liteasy/0.1 (mailto:${config.contactEmail})`
  };
  const request = (url, headers, signal) => fetchJson(url, {
    fetchImpl,
    headers: { ...commonHeaders, ...headers },
    signal,
    timeoutMs: config.timeoutMs
  });
  return Object.freeze({
    async crossref(source, input) {
      if (source.baseUrl !== retrievalConnectorEndpoints.crossref) {
        throw new ExternalRetrievalError("external_retrieval_source_invalid", 503);
      }
      const url = new URL(source.baseUrl);
      url.searchParams.set("mailto", config.contactEmail);
      url.searchParams.set("query.bibliographic", input.query);
      url.searchParams.set("rows", String(input.limit));
      const payload = await request(url, {}, input.signal);
      return (Array.isArray(payload?.message?.items) ? payload.message.items : [])
        .map((item, rank) => crossrefSource(item, input.query, rank)).filter(Boolean);
    },
    async openalex(source, input) {
      if (source.baseUrl !== retrievalConnectorEndpoints.openalex) {
        throw new ExternalRetrievalError("external_retrieval_source_invalid", 503);
      }
      const url = new URL(source.baseUrl);
      url.searchParams.set("mailto", config.contactEmail);
      url.searchParams.set("per-page", String(input.limit));
      url.searchParams.set("search", input.query);
      const payload = await request(url, {}, input.signal);
      return (Array.isArray(payload?.results) ? payload.results : [])
        .map((item, rank) => openAlexSource(item, input.query, rank)).filter(Boolean);
    },
    async semantic_scholar(source, input) {
      if (source.baseUrl !== retrievalConnectorEndpoints.semantic_scholar) {
        throw new ExternalRetrievalError("external_retrieval_source_invalid", 503);
      }
      const url = new URL(source.baseUrl);
      url.searchParams.set("fields", "paperId,title,abstract,authors,year,url,externalIds,openAccessPdf,citationCount");
      url.searchParams.set("limit", String(input.limit));
      url.searchParams.set("query", input.query);
      const headers = config.semanticScholarApiKey
        ? { "x-api-key": config.semanticScholarApiKey }
        : {};
      const payload = await request(url, headers, input.signal);
      return (Array.isArray(payload?.data) ? payload.data : [])
        .map((item, rank) => semanticScholarSource(item, input.query, rank)).filter(Boolean);
    }
  });
}
