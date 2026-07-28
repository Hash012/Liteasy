const openAlexEndpoint = "https://api.openalex.org/works";
const crossrefEndpoint = "https://api.crossref.org/works";
const maximumQueryLength = 500;
const maximumResults = 8;

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeTitle(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, " ").trim();
}

function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object" || Array.isArray(invertedIndex)) {
    return "";
  }
  const positionedWords = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) {
      continue;
    }
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0 && position < 10000) {
        positionedWords.push([position, word]);
      }
    }
  }
  return positionedWords
    .sort((left, right) => left[0] - right[0])
    .map(([, word]) => word)
    .join(" ")
    .slice(0, 2400);
}

function normalizeDoi(value) {
  const doi = normalizeText(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  return doi ? `https://doi.org/${doi}` : undefined;
}

function normalizeDoiKey(value) {
  return normalizeText(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .toLowerCase();
}

function sourceDoiKey(source) {
  return normalizeDoiKey(source?.doi ?? source?.sourceId);
}

function normalizeArxivKey(value) {
  const match = normalizeText(value).match(
    /(?:arxiv[:/\s]+|abs\/|pdf\/)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)/i
  );
  return (match?.[1] ?? "").replace(/\.pdf$/i, "").replace(/v\d+$/i, "").toLowerCase();
}

function sourceIdFromValue(value) {
  const rawId = normalizeText(value);
  const match = rawId.match(/(?:openalex\.org\/)?(W\d+)$/i);
  return match ? match[1].toUpperCase() : "";
}

function sourceIdFromWork(work) {
  return sourceIdFromValue(work?.id);
}

function workOpenAlexIds(work) {
  const values = [work?.id, ...(Array.isArray(work?.referenced_works) ? work.referenced_works : [])];
  return new Set(values.map(sourceIdFromValue).filter(Boolean));
}

function workExternalValues(work) {
  const locations = Array.isArray(work?.locations) ? work.locations : [];
  return [
    work?.doi,
    work?.primary_location?.landing_page_url,
    ...Object.values(work?.ids ?? {}),
    ...locations.flatMap((location) => [location?.landing_page_url, location?.pdf_url])
  ].map(normalizeText).filter(Boolean);
}

function matchesTargetIdentity(work, identity) {
  const kind = normalizeText(identity?.kind);
  const value = normalizeText(identity?.value);
  if (!kind || !value) {
    return false;
  }
  const externalValues = workExternalValues(work);
  if (kind === "doi") {
    const targetDoi = normalizeDoiKey(value);
    return Boolean(targetDoi) && externalValues.some((candidate) => normalizeDoiKey(candidate) === targetDoi);
  }
  if (kind === "arxiv_id") {
    const targetArxiv = normalizeArxivKey(value);
    return Boolean(targetArxiv) && externalValues.some((candidate) => normalizeArxivKey(candidate) === targetArxiv);
  }
  return false;
}

function findTargetWork(works, input) {
  const identityMatch = works.find((work) => matchesTargetIdentity(work, input.targetPaperIdentity));
  if (identityMatch) {
    return identityMatch;
  }
  const targetTitle = normalizeTitle(input.targetPaperTitle);
  return targetTitle
    ? works.find((work) => normalizeTitle(work?.display_name ?? work?.title) === targetTitle)
    : undefined;
}

function relationToTarget(work, targetWork) {
  const sourceId = sourceIdFromWork(work);
  const targetId = sourceIdFromWork(targetWork);
  if (!sourceId || !targetId) {
    return "topic_search";
  }
  if (workOpenAlexIds(targetWork).has(sourceId)) {
    return "cited_by_target";
  }
  if (workOpenAlexIds(work).has(targetId)) {
    return "cites_target";
  }
  const relatedIds = new Set(
    (Array.isArray(targetWork?.related_works) ? targetWork.related_works : [])
      .map(sourceIdFromValue)
      .filter(Boolean)
  );
  return relatedIds.has(sourceId) ? "related" : "topic_search";
}

function lexicalOverlap(query, title) {
  const stopWords = new Set([
    "follow", "following", "paper", "related", "research", "study", "work",
    "后续", "文献", "论文", "工作", "研究", "相关"
  ]);
  const queryTokens = new Set(
    normalizeTitle(query)
      .split(" ")
      .filter((token) => token.length > 2 && !stopWords.has(token))
  );
  if (queryTokens.size === 0) {
    return 0;
  }
  const titleTokens = new Set(normalizeTitle(title).split(" ").filter(Boolean));
  const overlap = [...queryTokens].filter((queryToken) => [...titleTokens].some((titleToken) => (
    titleToken === queryToken ||
    (queryToken.length >= 5 && titleToken.startsWith(queryToken)) ||
    (titleToken.length >= 5 && queryToken.startsWith(titleToken))
  ))).length;
  return overlap / queryTokens.size;
}

function normalizeWork(work, input, rank) {
  const sourceId = sourceIdFromWork(work);
  const title = normalizeText(work?.display_name ?? work?.title);
  if (
    !sourceId ||
    !title ||
    sourceId === sourceIdFromWork(input.targetWork) ||
    normalizeTitle(title) === normalizeTitle(input.targetPaperTitle)
  ) {
    return null;
  }
  const doi = normalizeDoi(work?.doi);
  const landingPage = normalizeText(work?.primary_location?.landing_page_url);
  const url = landingPage || doi || normalizeText(work?.id);
  if (!url || !/^https?:\/\//i.test(url)) {
    return null;
  }
  const authors = Array.isArray(work?.authorships)
    ? work.authorships
        .map((authorship) => normalizeText(authorship?.author?.display_name))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  const relevance = Math.min(
    1,
    Number((0.55 / (rank + 1) + 0.45 * lexicalOverlap(input.query, title)).toFixed(3))
  );
  return {
    abstract: reconstructAbstract(work?.abstract_inverted_index),
    authors,
    doi,
    id: `openalex:${sourceId}`,
    provider: "openalex",
    relation: relationToTarget(work, input.targetWork),
    relevance,
    retrievalQuery: input.query,
    sourceRecordUrl: `https://openalex.org/${sourceId}`,
    sourceId,
    title,
    url,
    year: Number.isInteger(work?.publication_year) ? work.publication_year : undefined
  };
}

export class ExternalKnowledgeError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function defaultOpenAlexTransport(url, options) {
  return fetch(url, options);
}

async function fetchOpenAlexPayload(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  let response;
  try {
    response = await (options.transport ?? defaultOpenAlexTransport)(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "LiteasyClaw/0.1" },
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === "AbortError";
    throw new ExternalKnowledgeError(
      timedOut ? "openalex_timeout" : "openalex_unavailable",
      timedOut ? "OpenAlex 检索超时。" : "OpenAlex 当前不可用。",
      timedOut ? 504 : 502
    );
  } finally {
    clearTimeout(timeout);
  }
  if (options.allowNotFound && response?.status === 404) {
    return null;
  }
  if (!response?.ok) {
    throw new ExternalKnowledgeError(
      "openalex_upstream_error",
      `OpenAlex 返回 HTTP ${response?.status ?? "unknown"}。`,
      502
    );
  }
  try {
    return await response.json();
  } catch {
    throw new ExternalKnowledgeError("openalex_invalid_response", "OpenAlex 返回格式无效。", 502);
  }
}

async function resolveTargetWork(works, input, options) {
  const targetFromSearch = findTargetWork(works, input);
  if (targetFromSearch) {
    return targetFromSearch;
  }
  const identity = input.targetPaperIdentity;
  if (!identity) {
    return undefined;
  }
  let externalId;
  if (identity.kind === "doi") {
    const doi = normalizeDoiKey(identity.value);
    externalId = doi ? `https://doi.org/${doi}` : "";
  } else if (identity.kind === "arxiv_id") {
    const arxivId = normalizeArxivKey(identity.value);
    externalId = arxivId ? `https://arxiv.org/abs/${arxivId}` : "";
  }
  if (!externalId) {
    return undefined;
  }
  const exactUrl = new URL(`${openAlexEndpoint}/${externalId}`);
  const target = await fetchOpenAlexPayload(exactUrl, { ...options, allowNotFound: true });
  return target && sourceIdFromWork(target) ? target : undefined;
}

export async function searchOpenAlexExternalKnowledge(body, options = {}) {
  const query = normalizeText(body?.query);
  const targetPaperTitle = normalizeText(body?.targetPaperTitle);
  const limit = Number.isInteger(body?.limit)
    ? Math.min(maximumResults, Math.max(1, body.limit))
    : 5;
  if (!query || query.length > maximumQueryLength) {
    throw new ExternalKnowledgeError(
      "invalid_external_knowledge_query",
      `query 必须为 1-${maximumQueryLength} 个字符。`,
      400
    );
  }

  const url = new URL(openAlexEndpoint);
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(Math.min(maximumResults + 1, limit + 1)));
  const payload = await fetchOpenAlexPayload(url, options);
  const works = Array.isArray(payload?.results) ? payload.results : [];
  const targetWork = await resolveTargetWork(works, {
    targetPaperIdentity: body?.targetPaperIdentity,
    targetPaperTitle
  }, options);
  const sources = works
    .map((work, rank) => normalizeWork(work, { query, targetPaperTitle, targetWork }, rank))
    .filter(Boolean)
    .filter((source) => (
      source.relation !== "topic_search" ||
      lexicalOverlap(query, `${source.title} ${source.abstract}`) > 0
    ))
    .slice(0, limit);
  return {
    provider: "openalex",
    query,
    sources,
    status: sources.length > 0 ? "available" : "empty"
  };
}

function crossrefAuthors(item) {
  return Array.isArray(item?.author)
    ? item.author
        .map((author) => normalizeText([author?.given, author?.family].filter(Boolean).join(" ")))
        .filter(Boolean)
        .slice(0, 12)
    : [];
}

function crossrefYear(item) {
  const dateParts = item?.published_print?.["date-parts"] ?? item?.published_online?.["date-parts"] ?? item?.issued?.["date-parts"];
  const year = Array.isArray(dateParts) && Array.isArray(dateParts[0]) ? dateParts[0][0] : undefined;
  return Number.isInteger(year) ? year : undefined;
}

function normalizeCrossrefWork(item, query, rank) {
  const doiKey = normalizeDoiKey(item?.DOI);
  const title = normalizeText(Array.isArray(item?.title) ? item.title[0] : "");
  if (!doiKey || !title) {
    return null;
  }
  const relevance = Math.min(
    1,
    Number((0.45 / (rank + 1) + 0.55 * lexicalOverlap(query, title)).toFixed(3))
  );
  return {
    abstract: normalizeText(item?.abstract).replace(/<[^>]*>/g, "").slice(0, 2400),
    authors: crossrefAuthors(item),
    doi: `https://doi.org/${doiKey}`,
    id: `crossref:${doiKey}`,
    provider: "crossref",
    relation: "topic_search",
    relevance,
    retrievalQuery: query,
    sourceRecordUrl: `${crossrefEndpoint}/${encodeURIComponent(doiKey)}`,
    sourceId: doiKey,
    title,
    url: `https://doi.org/${doiKey}`,
    year: crossrefYear(item)
  };
}

async function searchCrossrefExternalKnowledge(body, options = {}) {
  const query = normalizeText(body?.query);
  const limit = Number.isInteger(body?.limit)
    ? Math.min(maximumResults, Math.max(1, body.limit))
    : 5;
  const url = new URL(crossrefEndpoint);
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", String(Math.min(maximumResults, limit)));
  let payload;
  try {
    payload = await fetchOpenAlexPayload(url, {
      ...options,
      transport: options.transport ?? defaultOpenAlexTransport
    });
  } catch (error) {
    if (error instanceof ExternalKnowledgeError) {
      throw new ExternalKnowledgeError(
        error.code.replace("openalex", "crossref"),
        error.message.replace(/OpenAlex/g, "Crossref"),
        error.statusCode
      );
    }
    throw error;
  }
  const items = Array.isArray(payload?.message?.items) ? payload.message.items : [];
  return items
    .map((item, rank) => normalizeCrossrefWork(item, query, rank))
    .filter(Boolean)
    .filter((source) => lexicalOverlap(query, `${source.title} ${source.abstract}`) > 0);
}

function relationRank(relation) {
  if (relation === "cited_by_target" || relation === "cites_target") return 3;
  if (relation === "related") return 2;
  return 1;
}

function mergeExternalSources(sources, limit) {
  const deduplicated = new Map();
  for (const source of sources) {
    const key = sourceDoiKey(source) || `${source.provider}:${source.sourceId}`;
    const existing = deduplicated.get(key);
    if (!existing || relationRank(source.relation) > relationRank(existing.relation) ||
      (relationRank(source.relation) === relationRank(existing.relation) && source.relevance > existing.relevance)) {
      deduplicated.set(key, source);
    }
  }
  return [...deduplicated.values()]
    .sort((left, right) => relationRank(right.relation) - relationRank(left.relation) || right.relevance - left.relevance || left.title.localeCompare(right.title))
    .slice(0, limit);
}

export async function searchExternalKnowledge(body, options = {}) {
  const limit = Number.isInteger(body?.limit) ? Math.min(maximumResults, Math.max(1, body.limit)) : 5;
  const crossrefEnabled = options.crossrefEnabled !== false;
  const [openAlex, crossref] = await Promise.allSettled([
    searchOpenAlexExternalKnowledge(body, { timeoutMs: options.openAlexTimeoutMs, transport: options.openAlexTransport }),
    !crossrefEnabled
      ? Promise.resolve([])
      : searchCrossrefExternalKnowledge(body, { timeoutMs: options.crossrefTimeoutMs, transport: options.crossrefTransport })
  ]);
  const openAlexSources = openAlex.status === "fulfilled" ? openAlex.value.sources : [];
  const crossrefSources = crossref.status === "fulfilled" ? crossref.value : [];
  if (openAlex.status === "rejected" && (!crossrefEnabled || crossref.status === "rejected")) {
    throw openAlex.reason instanceof Error ? openAlex.reason : crossref.reason;
  }
  const sources = mergeExternalSources([...openAlexSources, ...crossrefSources], limit);
  return {
    provider: crossrefSources.length > 0 && openAlexSources.length > 0 ? "openalex+crossref" : crossrefSources.length > 0 ? "crossref" : "openalex",
    query: normalizeText(body?.query),
    sources,
    status: sources.length > 0 ? "available" : "empty"
  };
}
