import { normalizeLiteratureIdentifier } from "./literatureIdentity.mjs";

const MAX_CANDIDATES = 10;
const PROVIDER_TIMEOUT_MS = 3_000;

export class LiteratureProviderError extends Error {
  constructor(code = "LITERATURE_PROVIDER_UNAVAILABLE") {
    super(code);
    this.code = code;
    this.name = "LiteratureProviderError";
  }
}

function nonEmptyString(value, maximum = 1_000) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maximum) : null;
}

function bibliographicTitle(value) {
  if (Array.isArray(value)) return nonEmptyString(value[0]);
  return nonEmptyString(value);
}

function bibliographicAuthors(values) {
  return (Array.isArray(values) ? values : []).map((value) => nonEmptyString(value, 300)).filter(Boolean).slice(0, 200);
}

function providerAuthors(values) {
  return (Array.isArray(values) ? values : []).map((author) => {
    if (typeof author === "string") return author;
    return [author?.given, author?.family].filter(Boolean).join(" ");
  }).map((author) => nonEmptyString(author, 300)).filter(Boolean).slice(0, 200);
}

function yearFrom(value) {
  const year = Number(Array.isArray(value) ? value[0]?.[0] : value);
  return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : undefined;
}

function publicIdentifier(kind, value) {
  try {
    return {
      kind,
      source: "public_registry",
      value: normalizeLiteratureIdentifier(kind, value)
    };
  } catch {
    return null;
  }
}

function uniqueIdentifiers(identifiers) {
  return [...new Map(identifiers.filter(Boolean).map((identifier) => [
    `${identifier.kind}:${identifier.value}`,
    identifier
  ])).values()];
}

function httpsUrl(...values) {
  for (const value of values) {
    try {
      const parsed = new URL(String(value ?? ""));
      if (parsed.protocol === "https:") return parsed.toString();
    } catch {
      // External responses can contain malformed optional URLs.
    }
  }
  return null;
}

function candidate({ identifiers, provider, recordUrl, title, authors = [], documentType, year }) {
  const primary = identifiers[0];
  if (!primary || !title) return null;
  return {
    candidateKey: `${provider}:${primary.kind}:${primary.value}`,
    provider,
    record: {
      authors: bibliographicAuthors(authors),
      ...(documentType ? { documentType: nonEmptyString(documentType, 100) } : {}),
      identifiers,
      title,
      ...(year ? { year } : {})
    },
    ...(recordUrl ? { recordUrl } : {})
  };
}

function normalizedDoi(input) {
  const hints = input?.hints?.identifiers;
  const fromHints = Array.isArray(hints) ? hints.find((item) => item?.kind === "doi")?.value : null;
  const value = fromHints ?? input?.query;
  if (!value) return null;
  const raw = String(value).trim();
  if (!/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?10\.\d{4,9}\/.+/i.test(raw)) return null;
  try {
    return normalizeLiteratureIdentifier("doi", raw);
  } catch {
    return null;
  }
}

function searchText(input) {
  const title = nonEmptyString(input?.hints?.title);
  const query = nonEmptyString(input?.query);
  const identifier = Array.isArray(input?.hints?.identifiers) ? nonEmptyString(input.hints.identifiers[0]?.value) : null;
  return query ?? title ?? identifier;
}

function requestedLimit(input) {
  const requested = Number(input?.limit ?? MAX_CANDIDATES);
  return Math.max(1, Math.min(Number.isInteger(requested) ? requested : MAX_CANDIDATES, MAX_CANDIDATES));
}

function withPath(endpoint, segment) {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodeURIComponent(segment)}`;
  return url;
}

async function request(fetchImpl, url, { headers, responseType = "json", allowNotFound = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.toString(), {
      headers: { accept: responseType === "json" ? "application/json" : "application/atom+xml", ...headers },
      signal: controller.signal
    });
    if (allowNotFound && response?.status === 404) return null;
    if (!response?.ok) throw new LiteratureProviderError();
    return responseType === "text" ? await response.text() : await response.json();
  } catch {
    throw new LiteratureProviderError();
  } finally {
    clearTimeout(timeout);
  }
}

function parseCandidateKey(candidateKey, provider, kind) {
  const prefix = `${provider}:${kind}:`;
  if (typeof candidateKey !== "string" || !candidateKey.startsWith(prefix)) return null;
  const value = candidateKey.slice(prefix.length);
  if (!value) return null;
  try {
    return normalizeLiteratureIdentifier(kind, value);
  } catch {
    return null;
  }
}

function crossrefCandidate(work) {
  const doi = publicIdentifier("doi", work?.DOI);
  const title = bibliographicTitle(work?.title);
  if (!doi || !title) return null;
  return candidate({
    authors: providerAuthors(work.author),
    documentType: work.type,
    identifiers: [doi],
    provider: "crossref",
    recordUrl: httpsUrl(work.URL, `https://doi.org/${doi.value}`),
    title,
    year: yearFrom(work.published?.["date-parts"] ?? work.issued?.["date-parts"])
  });
}

function openAlexCandidate(work) {
  const openAlexId = publicIdentifier("openalex_id", work?.id);
  const doi = publicIdentifier("doi", work?.doi);
  const title = bibliographicTitle(work?.display_name ?? work?.title);
  if (!openAlexId || !title) return null;
  return candidate({
    authors: bibliographicAuthors((work.authorships ?? []).map((item) => item?.author?.display_name)),
    documentType: work.type,
    identifiers: uniqueIdentifiers([openAlexId, doi]),
    provider: "openalex",
    recordUrl: httpsUrl(work.id, work.primary_location?.landing_page_url, `https://openalex.org/${openAlexId.value}`),
    title,
    year: yearFrom(work.publication_year)
  });
}

function semanticScholarCandidate(paper) {
  const semanticScholarId = publicIdentifier("semantic_scholar_id", paper?.paperId);
  const doi = publicIdentifier("doi", paper?.externalIds?.DOI);
  const arxivId = publicIdentifier("arxiv_id", paper?.externalIds?.ArXiv);
  const title = bibliographicTitle(paper?.title);
  if (!semanticScholarId || !title) return null;
  return candidate({
    authors: bibliographicAuthors((paper.authors ?? []).map((author) => author?.name)),
    documentType: paper.venue ? "publication" : undefined,
    identifiers: uniqueIdentifiers([semanticScholarId, doi, arxivId]),
    provider: "semantic_scholar",
    recordUrl: httpsUrl(paper.url, `https://www.semanticscholar.org/paper/${encodeURIComponent(semanticScholarId.value)}`),
    title,
    year: yearFrom(paper.year)
  });
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function xmlValue(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, " ")).trim() : null;
}

function arxivCandidates(xml) {
  const entries = String(xml ?? "").match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
  return entries.map((entry) => {
    const rawId = xmlValue(entry, "id");
    const arxivId = publicIdentifier("arxiv_id", rawId);
    const title = bibliographicTitle(xmlValue(entry, "title"));
    if (!arxivId || !title) return null;
    const authors = [...entry.matchAll(/<author(?:\s[^>]*)?>[\s\S]*?<name(?:\s[^>]*)?>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
      .map((match) => decodeXml(match[1].replace(/<[^>]+>/g, " ")).trim());
    return candidate({
      authors,
      documentType: "preprint",
      identifiers: [arxivId],
      provider: "arxiv",
      recordUrl: `https://arxiv.org/abs/${arxivId.value}`,
      title,
      year: yearFrom(String(xmlValue(entry, "published") ?? "").slice(0, 4))
    });
  }).filter(Boolean);
}

function createCrossrefProvider(endpoint, fetchImpl) {
  async function byDoi(doi) {
    const body = await request(fetchImpl, withPath(endpoint, doi), { allowNotFound: true });
    const projected = body ? crossrefCandidate(body.message) : null;
    return projected ? [projected] : [];
  }
  return Object.freeze({
    name: "crossref",
    async fetchCandidate(candidateKey) {
      const doi = parseCandidateKey(candidateKey, "crossref", "doi");
      if (!doi) return null;
      return (await byDoi(doi)).find((item) => item.candidateKey === candidateKey) ?? null;
    },
    async search(input) {
      const doi = normalizedDoi(input);
      if (doi) return byDoi(doi);
      const query = searchText(input);
      if (!query) return [];
      const url = new URL(endpoint);
      url.searchParams.set("query.bibliographic", query);
      url.searchParams.set("rows", String(requestedLimit(input)));
      const body = await request(fetchImpl, url);
      return (Array.isArray(body?.message?.items) ? body.message.items : [])
        .map(crossrefCandidate).filter(Boolean).slice(0, requestedLimit(input));
    }
  });
}

function createOpenAlexProvider(endpoint, apiKey, fetchImpl) {
  async function byId(id) {
    const body = await request(fetchImpl, withPath(endpoint, id), {
      allowNotFound: true,
      headers: { authorization: `Bearer ${apiKey}` }
    });
    return body ? openAlexCandidate(body) : null;
  }
  return Object.freeze({
    name: "openalex",
    async fetchCandidate(candidateKey) {
      const id = parseCandidateKey(candidateKey, "openalex", "openalex_id");
      if (!id) return null;
      const projected = await byId(id);
      return projected?.candidateKey === candidateKey ? projected : null;
    },
    async search(input) {
      const url = new URL(endpoint);
      const doi = normalizedDoi(input);
      if (doi) url.searchParams.set("filter", `doi:${doi}`);
      else {
        const query = searchText(input);
        if (!query) return [];
        url.searchParams.set("search", query);
      }
      url.searchParams.set("per-page", String(requestedLimit(input)));
      const body = await request(fetchImpl, url, { headers: { authorization: `Bearer ${apiKey}` } });
      return (Array.isArray(body?.results) ? body.results : []).map(openAlexCandidate).filter(Boolean).slice(0, requestedLimit(input));
    }
  });
}

function createArxivProvider(endpoint, fetchImpl) {
  async function requestEntries(searchParams) {
    const url = new URL(endpoint);
    for (const [name, value] of Object.entries(searchParams)) url.searchParams.set(name, value);
    return arxivCandidates(await request(fetchImpl, url, { responseType: "text" }));
  }
  return Object.freeze({
    name: "arxiv",
    async fetchCandidate(candidateKey) {
      const id = parseCandidateKey(candidateKey, "arxiv", "arxiv_id");
      if (!id) return null;
      return (await requestEntries({ id_list: id, max_results: "1" })).find((item) => item.candidateKey === candidateKey) ?? null;
    },
    async search(input) {
      const hinted = Array.isArray(input?.hints?.identifiers) ? input.hints.identifiers.find((item) => item?.kind === "arxiv_id")?.value : null;
      const searchQuery = hinted ?? searchText(input);
      if (!searchQuery) return [];
      const arxivId = publicIdentifier("arxiv_id", searchQuery);
      if (hinted || /^(?:arxiv:\s*)?\d{4}\.\d{4,5}(?:v\d+)?$/i.test(String(searchQuery).trim())) {
        return requestEntries({ id_list: arxivId?.value ?? searchQuery, max_results: "1" });
      }
      return (await requestEntries({ max_results: String(requestedLimit(input)), search_query: `all:${searchQuery}` })).slice(0, requestedLimit(input));
    }
  });
}

function createSemanticScholarProvider(endpoint, apiKey, fetchImpl) {
  const headers = { "x-api-key": apiKey };
  async function byId(id) {
    const body = await request(fetchImpl, withPath(endpoint, id), { allowNotFound: true, headers });
    return body ? semanticScholarCandidate(body) : null;
  }
  return Object.freeze({
    name: "semantic_scholar",
    async fetchCandidate(candidateKey) {
      const id = parseCandidateKey(candidateKey, "semantic_scholar", "semantic_scholar_id");
      if (!id) return null;
      const projected = await byId(id);
      return projected?.candidateKey === candidateKey ? projected : null;
    },
    async search(input) {
      const url = withPath(endpoint, "search");
      const doi = normalizedDoi(input);
      const query = doi ? `DOI:${doi}` : searchText(input);
      if (!query) return [];
      url.searchParams.set("limit", String(requestedLimit(input)));
      url.searchParams.set("query", query);
      url.searchParams.set("fields", "paperId,title,authors,year,externalIds,url,venue");
      const body = await request(fetchImpl, url, { headers });
      return (Array.isArray(body?.data) ? body.data : []).map(semanticScholarCandidate).filter(Boolean).slice(0, requestedLimit(input));
    }
  });
}

export function createLiteratureProviders(config = {}, { fetchImpl } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  const providers = [];
  if (nonEmptyString(config.openAlexApiKey)) {
    providers.push(createOpenAlexProvider(config.openAlexEndpoint ?? "https://api.openalex.org/works", config.openAlexApiKey.trim(), fetchImpl));
  }
  providers.push(createCrossrefProvider(config.crossrefEndpoint ?? "https://api.crossref.org/works", fetchImpl));
  providers.push(createArxivProvider(config.arxivEndpoint ?? "https://export.arxiv.org/api/query", fetchImpl));
  if (nonEmptyString(config.semanticScholarApiKey)) {
    providers.push(createSemanticScholarProvider(config.semanticScholarEndpoint ?? "https://api.semanticscholar.org/graph/v1/paper", config.semanticScholarApiKey.trim(), fetchImpl));
  }
  return Object.freeze(providers);
}
