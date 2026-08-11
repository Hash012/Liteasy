import { createHash } from "node:crypto";
import { Cite } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import { attachLiteratureSourceArtifact, normalizeLiteratureIdentifier } from "./literatureIdentity.mjs";

const MAX_CANDIDATES = 10;
const MAX_PMLR_BIBLIOGRAPHY_BYTES = 20 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 3_000;
const IDENTITY_PROVIDER_CAPABILITIES = Object.freeze([
  "resolveIdentity",
  "search",
  "refetchForConfirmation"
]);

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

function candidate({ identifiers, provider, recordUrl, relations = [], sourceEvidence, title, authors = [], documentType, year }) {
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
    ...(relations.length ? { relations } : {}),
    ...(recordUrl ? { recordUrl } : {}),
    ...(sourceEvidence ? { sourceEvidence } : {})
  };
}

function relation({ direction, relationType, sourceField, targetIdentifier }) {
  if (!targetIdentifier) return null;
  return {
    direction,
    evidence: { sourceField },
    relationType,
    targetIdentifier: { kind: targetIdentifier.kind, value: targetIdentifier.value }
  };
}

function crossrefRelations(work) {
  const mappings = {
    "has-preprint": { direction: "to_current", relationType: "is_preprint_of" },
    "has-translation": { direction: "to_current", relationType: "translation_of" },
    "has-version": { direction: "to_current", relationType: "version_of" },
    "is-preprint-of": { direction: "from_current", relationType: "is_preprint_of" },
    "is-translation-of": { direction: "from_current", relationType: "translation_of" },
    "is-version-of": { direction: "from_current", relationType: "version_of" }
  };
  return Object.entries(work?.relation ?? {}).flatMap(([sourceField, entries]) => {
    const mapping = mappings[sourceField];
    if (!mapping) return [];
    return (Array.isArray(entries) ? entries : []).map((entry) => relation({
      ...mapping,
      sourceField: `relation.${sourceField}`,
      targetIdentifier: entry?.["id-type"] === "doi" ? publicIdentifier("doi", entry.id) : null
    })).filter(Boolean);
  });
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

async function boundedResponseBytes(response, maximumBytes) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) throw new LiteratureProviderError();
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new LiteratureProviderError();
    return bytes;
  }
  const chunks = [];
  const reader = response.body.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new LiteratureProviderError();
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function request(fetchImpl, url, { accept, headers, maxBytes, responseType = "json", allowNotFound = false, timeoutMs = PROVIDER_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  let timeout;
  const operation = (async () => {
    const response = await fetchImpl(url.toString(), {
      headers: { accept: accept ?? (responseType === "json" ? "application/json" : "application/atom+xml"), ...headers },
      signal: controller.signal
    });
    if (allowNotFound && response?.status === 404) return null;
    if (!response?.ok) throw new LiteratureProviderError();
    if (responseType === "bytes") return boundedResponseBytes(response, maxBytes ?? Number.MAX_SAFE_INTEGER);
    return responseType === "text" ? response.text() : response.json();
  })();
  const deadline = new Promise((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new LiteratureProviderError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, deadline]);
  } catch {
    throw new LiteratureProviderError();
  } finally {
    clearTimeout(timeout);
  }
}

function createProviderTransport(fetchImpl, timeoutMs) {
  return (url, options = {}) => request(fetchImpl, url, { ...options, timeoutMs });
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
    relations: crossrefRelations(work),
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
  const isPublication = Boolean(nonEmptyString(paper?.venue, 300));
  return candidate({
    authors: bibliographicAuthors((paper.authors ?? []).map((author) => author?.name)),
    documentType: isPublication ? "publication" : arxivId ? "preprint" : undefined,
    identifiers: uniqueIdentifiers(isPublication
      ? [semanticScholarId, doi]
      : [semanticScholarId, arxivId, doi?.value.startsWith("10.48550/arxiv.") ? doi : null]),
    provider: "semantic_scholar",
    recordUrl: httpsUrl(paper.url, `https://www.semanticscholar.org/paper/${encodeURIComponent(semanticScholarId.value)}`),
    relations: isPublication && arxivId ? [relation({
      direction: "to_current",
      relationType: "is_preprint_of",
      sourceField: "externalIds.ArXiv",
      targetIdentifier: arxivId
    })] : [],
    title,
    year: yearFrom(paper.year)
  });
}

function openReviewValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, "value")
    ? value.value
    : value;
}

function openReviewYear(note) {
  const explicit = yearFrom(openReviewValue(note?.content?.year));
  if (explicit) return explicit;
  const timestamp = Number(note?.pdate ?? note?.cdate);
  if (!Number.isFinite(timestamp)) return undefined;
  return yearFrom(new Date(timestamp).getUTCFullYear());
}

function isPublishedOpenReviewVenue(value) {
  const venue = nonEmptyString(openReviewValue(value), 300);
  return Boolean(venue && !/(?:submitted to|under review|withdrawn|rejected|desk rejected|submission)$/i.test(venue));
}

function openReviewCandidate(note) {
  const id = publicIdentifier("openreview_id", note?.id);
  const title = bibliographicTitle(openReviewValue(note?.content?.title));
  const venue = openReviewValue(note?.content?.venue);
  if (!id || !title || !isPublishedOpenReviewVenue(venue)) return null;
  const doi = publicIdentifier("doi", openReviewValue(note?.content?.doi));
  const arxivId = publicIdentifier(
    "arxiv_id",
    openReviewValue(note?.content?.arxiv_id ?? note?.content?.arxiv)
  );
  return candidate({
    authors: bibliographicAuthors(openReviewValue(note?.content?.authors)),
    documentType: "conference-paper",
    identifiers: uniqueIdentifiers([id, doi]),
    provider: "openreview",
    recordUrl: `https://openreview.net/forum?id=${encodeURIComponent(id.value)}`,
    relations: arxivId ? [relation({
      direction: "to_current",
      relationType: "is_preprint_of",
      sourceField: note?.content?.arxiv_id ? "content.arxiv_id" : "content.arxiv",
      targetIdentifier: arxivId
    })] : [],
    title,
    year: openReviewYear(note)
  });
}

function dblpDoi(...values) {
  for (const value of values.flat()) {
    const text = nonEmptyString(value);
    if (!text) continue;
    const match = /(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)(10\.\d{4,9}\/\S+)/i.exec(text);
    const doi = publicIdentifier("doi", match?.[1] ?? (/^10\.\d{4,9}\//i.test(text) ? text : null));
    if (doi) return doi;
  }
  return null;
}

function dblpAuthors(value) {
  const authors = value?.author;
  return bibliographicAuthors((Array.isArray(authors) ? authors : authors ? [authors] : [])
    .map((author) => typeof author === "string" ? author : author?.text));
}

function dblpDocumentType(key) {
  if (String(key).startsWith("conf/")) return "conference-paper";
  if (String(key).startsWith("journals/")) return "journal-article";
  return undefined;
}

function dblpCandidate(info) {
  const key = publicIdentifier("dblp_key", info?.key);
  const title = bibliographicTitle(info?.title);
  if (!key || !title) return null;
  const doi = dblpDoi(info?.doi, info?.ee);
  return candidate({
    authors: dblpAuthors(info?.authors),
    documentType: dblpDocumentType(key.value),
    identifiers: uniqueIdentifiers([key, doi]),
    provider: "dblp",
    recordUrl: `https://dblp.org/rec/${key.value.split("/").map(encodeURIComponent).join("/")}`,
    title,
    year: yearFrom(info?.year)
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

function xmlValues(xml, tag) {
  return [...String(xml ?? "").matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi"))]
    .map((match) => decodeXml(match[1].replace(/<[^>]+>/g, " ")).trim())
    .filter(Boolean);
}

function dblpXmlCandidate(xml) {
  const record = /<(article|inproceedings)(?:\s[^>]*)?\skey="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/i.exec(String(xml ?? ""));
  if (!record) return null;
  const [, , key, body] = record;
  return dblpCandidate({
    authors: { author: xmlValues(body, "author") },
    ee: xmlValues(body, "ee"),
    key,
    title: xmlValue(body, "title"),
    year: xmlValue(body, "year")
  });
}

function pmlrIdentifierParts(value) {
  try {
    const normalized = normalizeLiteratureIdentifier("pmlr_id", value);
    const match = /^v(\d{1,4})\/(.+)$/.exec(normalized);
    return match ? { identifier: normalized, slug: match[2], volume: Number(match[1]) } : null;
  } catch {
    return null;
  }
}

function pmlrArtifactUrl(endpoint, volume) {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v${volume}/assets/bib/bibliography.bib`;
  return url;
}

function pmlrAuthors(values) {
  return bibliographicAuthors((Array.isArray(values) ? values : []).map((author) =>
    [author?.given, author?.family].filter(Boolean).join(" ")));
}

function pmlrVolume(value) {
  const volume = Number(value);
  return Number.isInteger(volume) && volume >= 1 && volume <= 9999 ? volume : undefined;
}

function pmlrEntries(bibliography) {
  if (Buffer.byteLength(bibliography, "utf8") > MAX_PMLR_BIBLIOGRAPHY_BYTES) {
    throw new LiteratureProviderError();
  }
  try {
    return new Cite(bibliography).data;
  } catch {
    throw new LiteratureProviderError();
  }
}

function pmlrCandidate(entry, { artifactBytes, artifactHash, artifactUrl, expectedIdentifier } = {}) {
  const entryKey = nonEmptyString(entry?.["citation-key"] ?? entry?.id, 300)?.toLocaleLowerCase("en-US");
  const identifier = entryKey ? pmlrIdentifierParts(entryKey) : null;
  const canonicalUrl = httpsUrl(entry?.URL);
  const urlIdentifier = canonicalUrl ? pmlrIdentifierParts(canonicalUrl) : null;
  const entryVolume = pmlrVolume(entry?.volume);
  const title = bibliographicTitle(entry?.title);
  if (!identifier || !urlIdentifier || identifier.identifier !== urlIdentifier.identifier ||
    identifier.identifier !== expectedIdentifier || identifier.volume !== entryVolume ||
    entry?.type !== "paper-conference" || String(entry?.publisher ?? "").trim() !== "PMLR" || !title) {
    return null;
  }
  const doi = publicIdentifier("doi", entry?.DOI);
  const projected = candidate({
    authors: pmlrAuthors(entry.author),
    documentType: "conference-paper",
    identifiers: uniqueIdentifiers([publicIdentifier("pmlr_id", identifier.identifier), doi]),
    provider: "pmlr",
    recordUrl: canonicalUrl,
    sourceEvidence: {
      artifactHash,
      artifactUrl,
      entryKey,
      sourceKind: "official_volume_bibtex",
      volume: identifier.volume
    },
    title,
    year: yearFrom(entry?.issued?.["date-parts"])
  });
  return projected && artifactBytes
    ? attachLiteratureSourceArtifact(projected, {
        artifactUrl,
        content: Buffer.from(artifactBytes),
        mediaType: "application/x-bibtex"
      })
    : projected;
}

function arxivCandidates(xml) {
  const entries = String(xml ?? "").match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
  return entries.map((entry) => {
    const rawId = xmlValue(entry, "id");
    const arxivId = publicIdentifier("arxiv_id", rawId);
    const publicationDoi = publicIdentifier("doi", xmlValue(entry, "arxiv:doi"));
    const title = bibliographicTitle(xmlValue(entry, "title"));
    if (!arxivId || !title) return null;
    const authors = [...entry.matchAll(/<author(?:\s[^>]*)?>[\s\S]*?<name(?:\s[^>]*)?>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)]
      .map((match) => decodeXml(match[1].replace(/<[^>]+>/g, " ")).trim());
    const revision = /^(.*)v([1-9]\d*)$/.exec(arxivId.value);
    const revisionRelation = revision && Number(revision[2]) > 1 ? relation({
      direction: "from_current",
      relationType: "version_of",
      sourceField: `id.version:v${revision[2]}`,
      targetIdentifier: publicIdentifier("arxiv_id", `${revision[1]}v${Number(revision[2]) - 1}`)
    }) : null;
    return candidate({
      authors,
      documentType: "preprint",
      identifiers: [arxivId],
      provider: "arxiv",
      recordUrl: `https://arxiv.org/abs/${arxivId.value}`,
      relations: [
        revisionRelation,
        publicationDoi ? relation({
          direction: "from_current",
          relationType: "is_preprint_of",
          sourceField: "arxiv:doi",
          targetIdentifier: publicationDoi
        }) : null
      ].filter(Boolean),
      title,
      year: yearFrom(String(xmlValue(entry, "published") ?? "").slice(0, 4))
    });
  }).filter(Boolean);
}

function createCrossrefProvider(endpoint, transport) {
  async function byDoi(doi) {
    const body = await transport(withPath(endpoint, doi), { allowNotFound: true });
    const projected = body ? crossrefCandidate(body.message) : null;
    return projected ? [projected] : [];
  }
  async function fetchCandidate(candidateKey) {
    const doi = parseCandidateKey(candidateKey, "crossref", "doi");
    if (!doi) return null;
    return (await byDoi(doi)).find((item) => item.candidateKey === candidateKey) ?? null;
  }
  async function search(input) {
    const doi = normalizedDoi(input);
    if (doi) return byDoi(doi);
    const query = searchText(input);
    if (!query) return [];
    const url = new URL(endpoint);
    url.searchParams.set("query.bibliographic", query);
    url.searchParams.set("rows", String(requestedLimit(input)));
    const body = await transport(url);
    return (Array.isArray(body?.message?.items) ? body.message.items : [])
      .map(crossrefCandidate).filter(Boolean).slice(0, requestedLimit(input));
  }
  return Object.freeze({
    capabilities: IDENTITY_PROVIDER_CAPABILITIES,
    fetchCandidate,
    name: "crossref",
    refetchForConfirmation: fetchCandidate,
    resolveIdentity: search,
    search
  });
}

function createOpenAlexProvider(endpoint, apiKey, transport) {
  async function byId(id) {
    const url = withPath(endpoint, id);
    url.searchParams.set("api_key", apiKey);
    const body = await transport(url, { allowNotFound: true });
    return body ? openAlexCandidate(body) : null;
  }
  async function fetchCandidate(candidateKey) {
    const id = parseCandidateKey(candidateKey, "openalex", "openalex_id");
    if (!id) return null;
    const projected = await byId(id);
    return projected?.candidateKey === candidateKey ? projected : null;
  }
  async function search(input) {
    const url = new URL(endpoint);
    url.searchParams.set("api_key", apiKey);
    const doi = normalizedDoi(input);
    if (doi) url.searchParams.set("filter", `doi:${doi}`);
    else {
      const query = searchText(input);
      if (!query) return [];
      url.searchParams.set("search", query);
    }
    url.searchParams.set("per-page", String(requestedLimit(input)));
    const body = await transport(url);
    return (Array.isArray(body?.results) ? body.results : []).map(openAlexCandidate).filter(Boolean).slice(0, requestedLimit(input));
  }
  return Object.freeze({
    capabilities: IDENTITY_PROVIDER_CAPABILITIES,
    fetchCandidate,
    name: "openalex",
    refetchForConfirmation: fetchCandidate,
    resolveIdentity: search,
    search
  });
}

function createArxivProvider(endpoint, transport) {
  async function requestEntries(searchParams) {
    const url = new URL(endpoint);
    for (const [name, value] of Object.entries(searchParams)) url.searchParams.set(name, value);
    return arxivCandidates(await transport(url, { responseType: "text" }));
  }
  async function fetchCandidate(candidateKey) {
    const id = parseCandidateKey(candidateKey, "arxiv", "arxiv_id");
    if (!id) return null;
    return (await requestEntries({ id_list: id, max_results: "1" })).find((item) => item.candidateKey === candidateKey) ?? null;
  }
  async function search(input) {
    const hinted = Array.isArray(input?.hints?.identifiers) ? input.hints.identifiers.find((item) => item?.kind === "arxiv_id")?.value : null;
    const searchQuery = hinted ?? searchText(input);
    if (!searchQuery) return [];
    const arxivId = publicIdentifier("arxiv_id", searchQuery);
    if (hinted || /^(?:arxiv:\s*)?\d{4}\.\d{4,5}(?:v\d+)?$/i.test(String(searchQuery).trim())) {
      return requestEntries({ id_list: arxivId?.value ?? searchQuery, max_results: "1" });
    }
    return (await requestEntries({ max_results: String(requestedLimit(input)), search_query: `all:${searchQuery}` })).slice(0, requestedLimit(input));
  }
  return Object.freeze({
    capabilities: IDENTITY_PROVIDER_CAPABILITIES,
    fetchCandidate,
    name: "arxiv",
    refetchForConfirmation: fetchCandidate,
    resolveIdentity: search,
    search
  });
}

function createSemanticScholarProvider(endpoint, apiKey, transport) {
  const headers = { "x-api-key": apiKey };
  async function byId(id) {
    const body = await transport(withPath(endpoint, id), { allowNotFound: true, headers });
    return body ? semanticScholarCandidate(body) : null;
  }
  async function fetchCandidate(candidateKey) {
    const id = parseCandidateKey(candidateKey, "semantic_scholar", "semantic_scholar_id");
    if (!id) return null;
    const projected = await byId(id);
    return projected?.candidateKey === candidateKey ? projected : null;
  }
  async function search(input) {
    const url = withPath(endpoint, "search");
    const doi = normalizedDoi(input);
    const query = doi ? `DOI:${doi}` : searchText(input);
    if (!query) return [];
    url.searchParams.set("limit", String(requestedLimit(input)));
    url.searchParams.set("query", query);
    url.searchParams.set("fields", "paperId,title,authors,year,externalIds,url,venue");
    const body = await transport(url, { headers });
    return (Array.isArray(body?.data) ? body.data : []).map(semanticScholarCandidate).filter(Boolean).slice(0, requestedLimit(input));
  }
  return Object.freeze({
    capabilities: IDENTITY_PROVIDER_CAPABILITIES,
    fetchCandidate,
    name: "semantic_scholar",
    refetchForConfirmation: fetchCandidate,
    resolveIdentity: search,
    search
  });
}

function createOpenReviewProvider(endpoint, searchEndpoint, transport) {
  async function byId(id) {
    const url = new URL(endpoint);
    url.searchParams.set("id", id);
    const body = await transport(url, { allowNotFound: true });
    const matches = (Array.isArray(body?.notes) ? body.notes : []).map(openReviewCandidate).filter(Boolean);
    return matches.length === 1 ? matches[0] : null;
  }
  async function fetchCandidate(candidateKey) {
    const id = parseCandidateKey(candidateKey, "openreview", "openreview_id");
    if (!id) return null;
    const projected = await byId(id);
    return projected?.candidateKey === candidateKey ? projected : null;
  }
  async function search(input) {
    const hinted = Array.isArray(input?.hints?.identifiers)
      ? input.hints.identifiers.find((item) => item?.kind === "openreview_id")?.value
      : null;
    if (hinted) {
      const id = publicIdentifier("openreview_id", hinted);
      return id ? [await byId(id.value)].filter(Boolean) : [];
    }
    const query = searchText(input);
    if (!query) return [];
    const url = new URL(searchEndpoint);
    url.searchParams.set("limit", String(requestedLimit(input)));
    url.searchParams.set("term", query);
    const body = await transport(url);
    return (Array.isArray(body?.notes) ? body.notes : [])
      .map(openReviewCandidate).filter(Boolean).slice(0, requestedLimit(input));
  }
  return Object.freeze({
    capabilities: IDENTITY_PROVIDER_CAPABILITIES,
    fetchCandidate,
    name: "openreview",
    refetchForConfirmation: fetchCandidate,
    resolveIdentity: search,
    search
  });
}

function dblpRecordUrl(endpoint, key) {
  const url = new URL(endpoint);
  const path = key.split("/").map(encodeURIComponent).join("/");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path}.xml`;
  return url;
}

function createDblpProvider(searchEndpoint, recordEndpoint, transport) {
  async function byKey(key) {
    return dblpXmlCandidate(await transport(dblpRecordUrl(recordEndpoint, key), {
      allowNotFound: true,
      responseType: "text"
    }));
  }
  async function fetchCandidate(candidateKey) {
    const key = parseCandidateKey(candidateKey, "dblp", "dblp_key");
    if (!key) return null;
    const projected = await byKey(key);
    return projected?.candidateKey === candidateKey ? projected : null;
  }
  async function search(input) {
    const hinted = Array.isArray(input?.hints?.identifiers)
      ? input.hints.identifiers.find((item) => item?.kind === "dblp_key")?.value
      : null;
    if (hinted) {
      const key = publicIdentifier("dblp_key", hinted);
      return key ? [await byKey(key.value)].filter(Boolean) : [];
    }
    const query = searchText(input);
    if (!query) return [];
    const url = new URL(searchEndpoint);
    url.searchParams.set("format", "json");
    url.searchParams.set("h", String(requestedLimit(input)));
    url.searchParams.set("q", query);
    const body = await transport(url);
    const hits = body?.result?.hits?.hit;
    return (Array.isArray(hits) ? hits : hits ? [hits] : [])
      .map((hit) => dblpCandidate(hit?.info)).filter(Boolean).slice(0, requestedLimit(input));
  }
  return Object.freeze({
    capabilities: IDENTITY_PROVIDER_CAPABILITIES,
    fetchCandidate,
    name: "dblp",
    refetchForConfirmation: fetchCandidate,
    resolveIdentity: search,
    search
  });
}

function createPmlrProvider(endpoint, transport) {
  async function volumeSnapshot(volume) {
    const artifactUrl = pmlrArtifactUrl(endpoint, volume);
    const artifactBytes = await transport(artifactUrl, {
      accept: "application/x-bibtex, text/plain;q=0.9",
      maxBytes: MAX_PMLR_BIBLIOGRAPHY_BYTES,
      responseType: "bytes"
    });
    if (artifactBytes.byteLength > MAX_PMLR_BIBLIOGRAPHY_BYTES) throw new LiteratureProviderError();
    let bibliography;
    try {
      bibliography = new TextDecoder("utf-8", { fatal: true }).decode(artifactBytes);
    } catch {
      throw new LiteratureProviderError();
    }
    return {
      artifactBytes: Buffer.from(artifactBytes),
      artifactHash: `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}`,
      artifactUrl: artifactUrl.toString(),
      entries: pmlrEntries(bibliography)
    };
  }
  async function byId(id) {
    const parts = pmlrIdentifierParts(id);
    if (!parts) return null;
    const snapshot = await volumeSnapshot(parts.volume);
    const matching = snapshot.entries.filter((entry) =>
      String(entry?.["citation-key"] ?? entry?.id ?? "").toLocaleLowerCase("en-US") ===
        `pmlr-${parts.identifier.replace("/", "-")}`);
    if (matching.length !== 1) return null;
    return pmlrCandidate(matching[0], { ...snapshot, expectedIdentifier: parts.identifier });
  }
  async function fetchCandidate(candidateKey) {
    const id = parseCandidateKey(candidateKey, "pmlr", "pmlr_id");
    if (!id) return null;
    const projected = await byId(id);
    return projected?.candidateKey === candidateKey ? projected : null;
  }
  async function search(input) {
    const hintedIdentifier = Array.isArray(input?.hints?.identifiers)
      ? input.hints.identifiers.find((item) => item?.kind === "pmlr_id")?.value
      : null;
    if (hintedIdentifier) return [await byId(hintedIdentifier)].filter(Boolean);
    const explicitQuery = /^(?:pmlr:\s*|pmlr-v\d{1,4}-|v\d{1,4}\/|https?:\/\/(?:www\.)?proceedings\.mlr\.press\/v\d{1,4}\/)/i
      .test(String(input?.query ?? "").trim());
    if (explicitQuery) return [await byId(input.query)].filter(Boolean);
    const volume = Number(input?.hints?.pmlr?.volume);
    if (!Number.isInteger(volume) || volume < 1 || volume > 9999) return [];
    const snapshot = await volumeSnapshot(volume);
    const requestedTitle = nonEmptyString(input?.hints?.title ?? input?.query)?.toLocaleLowerCase("en-US");
    const requestedYear = yearFrom(input?.hints?.year ?? input?.hints?.pmlr?.year);
    return snapshot.entries.flatMap((entry) => {
      const entryKey = String(entry?.["citation-key"] ?? entry?.id ?? "");
      const parts = pmlrIdentifierParts(entryKey);
      if (!parts || parts.volume !== volume) return [];
      const projected = pmlrCandidate(entry, { ...snapshot, expectedIdentifier: parts.identifier });
      if (!projected || (requestedYear && projected.record.year !== requestedYear) ||
        (requestedTitle && !projected.record.title.toLocaleLowerCase("en-US").includes(requestedTitle))) return [];
      return [projected];
    }).slice(0, requestedLimit(input));
  }
  return Object.freeze({
    capabilities: IDENTITY_PROVIDER_CAPABILITIES,
    fetchCandidate,
    name: "pmlr",
    refetchForConfirmation: fetchCandidate,
    resolveIdentity: search,
    search
  });
}

export function createLiteratureProviders(config = {}, { fetchImpl, timeoutMs = PROVIDER_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("timeoutMs must be positive");
  const transport = createProviderTransport(fetchImpl, timeoutMs);
  const providers = [];
  if (nonEmptyString(config.openAlexApiKey)) {
    providers.push(createOpenAlexProvider(config.openAlexEndpoint ?? "https://api.openalex.org/works", config.openAlexApiKey.trim(), transport));
  }
  providers.push(createCrossrefProvider(config.crossrefEndpoint ?? "https://api.crossref.org/works", transport));
  providers.push(createArxivProvider(config.arxivEndpoint ?? "https://export.arxiv.org/api/query", transport));
  providers.push(createOpenReviewProvider(
    config.openReviewEndpoint ?? "https://api2.openreview.net/notes",
    config.openReviewSearchEndpoint ?? "https://api2.openreview.net/notes/search",
    transport
  ));
  providers.push(createDblpProvider(
    config.dblpSearchEndpoint ?? "https://dblp.org/search/publ/api",
    config.dblpRecordEndpoint ?? "https://dblp.org/rec",
    transport
  ));
  providers.push(createPmlrProvider(
    config.pmlrEndpoint ?? "https://proceedings.mlr.press",
    transport
  ));
  if (nonEmptyString(config.semanticScholarApiKey)) {
    providers.push(createSemanticScholarProvider(config.semanticScholarEndpoint ?? "https://api.semanticscholar.org/graph/v1/paper", config.semanticScholarApiKey.trim(), transport));
  }
  return Object.freeze(providers);
}
