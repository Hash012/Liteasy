const openAlexEndpoint = "https://api.openalex.org/works";
const crossrefEndpoint = "https://api.crossref.org/works";
const arxivEndpoint = "https://export.arxiv.org/api/query";
const maximumQueryLength = 500;
const maximumResults = 32;
const maximumGraphNeighborsPerRelation = 6;
const maximumArxivFeedBytes = 1024 * 1024;
const minimumArxivRequestIntervalMs = 3000;
const reciprocalRankConstant = 60;
const diversityWeight = 0.22;
const retrievalRanks = Symbol("externalKnowledgeRetrievalRanks");
let arxivTransportQueue = Promise.resolve();
let nextArxivRequestAt = 0;

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
  const doi = normalizeDoiKey(source?.doi ?? source?.sourceId);
  return /^10\.\d{4,9}\/\S+$/.test(doi) ? doi : "";
}

function sourceArxivKey(source) {
  return normalizeArxivKey(source?.arxivId ?? source?.sourceId);
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

function arxivIdFromWork(work) {
  return workExternalValues(work).map(normalizeArxivKey).find(Boolean) || undefined;
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

function graphWorkIds(targetWork, field) {
  return [...new Set(
    (Array.isArray(targetWork?.[field]) ? targetWork[field] : [])
      .map(sourceIdFromValue)
      .filter(Boolean)
  )].slice(0, maximumGraphNeighborsPerRelation);
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
  const arxivId = arxivIdFromWork(work);
  const landingPage = normalizeText(work?.primary_location?.landing_page_url);
  const fullTextUrl = [
    work?.primary_location?.pdf_url,
    work?.best_oa_location?.pdf_url
  ].map(normalizeText).find((candidate) => /^https:\/\//i.test(candidate));
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
  const openAccessAvailable = Boolean(
    work?.open_access?.is_oa ||
    work?.primary_location?.pdf_url ||
    work?.best_oa_location?.pdf_url
  );
  return {
    abstract: reconstructAbstract(work?.abstract_inverted_index),
    ...(arxivId ? { arxivId } : {}),
    authors,
    doi,
    ...(fullTextUrl ? { fullTextUrl } : {}),
    id: `openalex:${sourceId}`,
    ...(typeof work?.is_retracted === "boolean" ? { isRetracted: work.is_retracted } : {}),
    ...(openAccessAvailable ? { openAccessAvailable: true } : {}),
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

function normalizeGraphWork(work, input, rank, relation) {
  const source = normalizeWork(work, input, rank);
  return source ? { ...source, relation } : null;
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

function waitForArxivRequestSlot(delayMs, signal) {
  if (signal?.aborted) {
    return Promise.reject(Object.assign(new Error("arXiv request aborted"), { name: "AbortError" }));
  }
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      reject(Object.assign(new Error("arXiv request aborted"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function defaultArxivTransport(url, options) {
  const request = arxivTransportQueue.then(async () => {
    await waitForArxivRequestSlot(Math.max(0, nextArxivRequestAt - Date.now()), options?.signal);
    nextArxivRequestAt = Date.now() + minimumArxivRequestIntervalMs;
    return fetch(url, options);
  });
  arxivTransportQueue = request.catch(() => undefined);
  return request;
}

async function fetchOpenAlexPayload(url, options = {}) {
  const requestUrl = new URL(url);
  if (typeof options.openAlexApiKey === "string" && options.openAlexApiKey) {
    requestUrl.searchParams.set("api_key", options.openAlexApiKey);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  let response;
  try {
    response = await (options.transport ?? defaultOpenAlexTransport)(requestUrl.toString(), {
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
  if (response?.status === 401 || response?.status === 403) {
    throw new ExternalKnowledgeError(
      "openalex_api_key_required",
      "OpenAlex API 密钥无效或已失效。请在 Liteasy 设置中更新 OpenAlex API 密钥后重试。",
      503
    );
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

async function fetchOpenAlexWorkById(workId, options) {
  const normalizedWorkId = sourceIdFromValue(workId);
  if (!normalizedWorkId) {
    return null;
  }
  return fetchOpenAlexPayload(`${openAlexEndpoint}/${normalizedWorkId}`, {
    ...options,
    allowNotFound: true
  });
}

async function fetchOpenAlexWorksById(workIds, options) {
  const results = await Promise.allSettled(
    workIds.map((workId) => fetchOpenAlexWorkById(workId, options))
  );
  return results.flatMap((result) => (
    result.status === "fulfilled" && result.value ? [result.value] : []
  ));
}

async function fetchOpenAlexCitingWorks(targetWork, limit, options) {
  const targetId = sourceIdFromWork(targetWork);
  if (!targetId) {
    return [];
  }
  const url = new URL(openAlexEndpoint);
  // OpenAlex's `cites` filter returns works that explicitly reference the target work.
  url.searchParams.set("filter", `cites:${targetId}`);
  url.searchParams.set("per-page", String(Math.min(maximumGraphNeighborsPerRelation, limit)));
  try {
    const payload = await fetchOpenAlexPayload(url, options);
    return (Array.isArray(payload?.results) ? payload.results : [])
      // Do not trust a provider-side filter blindly. The relation label is a claim surfaced to
      // readers, so retain it only when the returned graph field independently proves it.
      .filter((work) => workOpenAlexIds(work).has(targetId));
  } catch {
    // The ordinary query remains useful when a graph endpoint is temporarily unavailable.
    return [];
  }
}

async function expandTargetCitationNeighborhood(input, options) {
  if (!input.targetWork || options.expandCitationGraph === false) {
    return [];
  }
  const [referencedWorks, relatedWorks, citingWorks] = await Promise.all([
    fetchOpenAlexWorksById(graphWorkIds(input.targetWork, "referenced_works"), options),
    fetchOpenAlexWorksById(graphWorkIds(input.targetWork, "related_works"), options),
    fetchOpenAlexCitingWorks(input.targetWork, input.limit, options)
  ]);
  return [
    ...referencedWorks.map((work, index) => normalizeGraphWork(work, input, index, "cited_by_target")),
    ...citingWorks.map((work, index) => normalizeGraphWork(work, input, index, "cites_target")),
    ...relatedWorks.map((work, index) => normalizeGraphWork(work, input, index, "related"))
  ].filter(Boolean);
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
  if (typeof options.openAlexApiKey !== "string" || !options.openAlexApiKey.trim() ||
    options.openAlexApiKey.length > 512 || /\s/.test(options.openAlexApiKey)) {
    throw new ExternalKnowledgeError(
      "openalex_api_key_required",
      "OpenAlex 外部文献检索需要有效 API 密钥。请在 Liteasy 设置中配置 OpenAlex API 密钥后重试。",
      503
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
  const searchedSources = works
    .map((work, rank) => normalizeWork(work, { query, targetPaperTitle, targetWork }, rank))
    .filter(Boolean)
    .filter((source) => (
      source.relation !== "topic_search" ||
      lexicalOverlap(query, `${source.title} ${source.abstract}`) > 0
    ))
    .slice(0, limit);
  const graphSources = await expandTargetCitationNeighborhood({
    limit,
    query,
    targetPaperTitle,
    targetWork
  }, options);
  const sources = mergeExternalSources(
    [...graphSources, ...searchedSources],
    limit,
    { rerank: false }
  );
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
  const arxivId = [
    item?.DOI,
    ...(Array.isArray(item?.["alternative-id"]) ? item["alternative-id"] : [])
  ].map(normalizeArxivKey).find(Boolean);
  const title = normalizeText(Array.isArray(item?.title) ? item.title[0] : "");
  if (!doiKey || !title) {
    return null;
  }
  const relevance = Math.min(
    1,
    Number((0.45 / (rank + 1) + 0.55 * lexicalOverlap(query, title)).toFixed(3))
  );
  const isRetracted = Array.isArray(item?.["update-to"]) && item["update-to"].some((update) => (
    normalizeText(update?.type).toLowerCase() === "retraction"
  ));
  const openAccessAvailable = Array.isArray(item?.link) && item.link.some((link) => (
    /pdf/i.test(normalizeText(link?.["content-type"])) && /^https?:\/\//i.test(normalizeText(link?.URL))
  ));
  const fullTextUrl = Array.isArray(item?.link)
    ? item.link
        .map((link) => ({
          contentType: normalizeText(link?.["content-type"]),
          url: normalizeText(link?.URL)
        }))
        .find((link) => /pdf/i.test(link.contentType) && /^https:\/\//i.test(link.url))?.url
    : undefined;
  return {
    abstract: normalizeText(item?.abstract).replace(/<[^>]*>/g, "").slice(0, 2400),
    ...(arxivId ? { arxivId } : {}),
    authors: crossrefAuthors(item),
    doi: `https://doi.org/${doiKey}`,
    ...(fullTextUrl ? { fullTextUrl } : {}),
    id: `crossref:${doiKey}`,
    ...(isRetracted ? { isRetracted: true } : {}),
    ...(openAccessAvailable ? { openAccessAvailable: true } : {}),
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

function decodeXmlCodePoint(value, radix) {
  const codePoint = Number.parseInt(value, radix);
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff)
    ? String.fromCodePoint(codePoint)
    : "";
}

function decodeXmlText(value) {
  return normalizeText(value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => decodeXmlCodePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeXmlCodePoint(code, 16))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"));
}

function xmlTagValue(xml, tagName) {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escapedTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTagName}>`, "i"));
  return match ? decodeXmlText(match[1]) : "";
}

function xmlTagValues(xml, tagName) {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...xml.matchAll(new RegExp(`<${escapedTagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTagName}>`, "gi"))]
    .map((match) => decodeXmlText(match[1]));
}

function normalizeArxivEntry(entry, query, targetPaperTitle, rank) {
  const rawId = xmlTagValue(entry, "id");
  const arxivId = normalizeArxivKey(rawId);
  const title = xmlTagValue(entry, "title");
  if (!arxivId || !title || normalizeTitle(title) === normalizeTitle(targetPaperTitle)) {
    return null;
  }
  const doiKey = normalizeDoiKey(xmlTagValue(entry, "arxiv:doi"));
  const doi = /^10\.\d{4,9}\/\S+$/.test(doiKey) ? `https://doi.org/${doiKey}` : undefined;
  const published = xmlTagValue(entry, "published");
  const year = /^\d{4}-/.test(published) ? Number.parseInt(published.slice(0, 4), 10) : undefined;
  const relevance = Math.min(
    1,
    Number((0.5 / (rank + 1) + 0.5 * lexicalOverlap(query, title)).toFixed(3))
  );
  const url = `https://arxiv.org/abs/${arxivId}`;
  return {
    abstract: xmlTagValue(entry, "summary").slice(0, 2400),
    arxivId,
    authors: xmlTagValues(entry, "name").slice(0, 12),
    ...(doi ? { doi } : {}),
    id: `arxiv:${arxivId}`,
    fullTextUrl: `https://arxiv.org/pdf/${arxivId}`,
    openAccessAvailable: true,
    provider: "arxiv",
    relation: "topic_search",
    relevance,
    retrievalQuery: query,
    sourceRecordUrl: url,
    sourceId: arxivId,
    title,
    url,
    ...(Number.isInteger(year) ? { year } : {})
  };
}

async function searchArxivExternalKnowledge(body, options = {}) {
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
  const url = new URL(arxivEndpoint);
  url.searchParams.set("search_query", `all:${query.replace(/[\"\\]/g, " ")}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(Math.min(maximumResults + 1, limit + 1)));
  url.searchParams.set("sortBy", "relevance");
  url.searchParams.set("sortOrder", "descending");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  let response;
  try {
    response = await (options.transport ?? defaultArxivTransport)(url.toString(), {
      headers: { Accept: "application/atom+xml", "User-Agent": "LiteasyClaw/0.1" },
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = controller.signal.aborted || error?.name === "AbortError";
    throw new ExternalKnowledgeError(
      timedOut ? "arxiv_timeout" : "arxiv_unavailable",
      timedOut ? "arXiv 检索超时。" : "arXiv 当前不可用。",
      timedOut ? 504 : 502
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response?.ok) {
    throw new ExternalKnowledgeError(
      "arxiv_upstream_error",
      `arXiv 返回 HTTP ${response?.status ?? "unknown"}。`,
      502
    );
  }
  let xml;
  try {
    xml = await response.text();
  } catch {
    throw new ExternalKnowledgeError("arxiv_invalid_response", "arXiv 返回格式无效。", 502);
  }
  if (typeof xml !== "string" || xml.length > maximumArxivFeedBytes || /<!DOCTYPE/i.test(xml)) {
    throw new ExternalKnowledgeError("arxiv_invalid_response", "arXiv 返回格式无效。", 502);
  }
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)]
    .map((match, rank) => normalizeArxivEntry(match[1], query, targetPaperTitle, rank))
    .filter(Boolean)
    .filter((source) => lexicalOverlap(query, `${source.title} ${source.abstract}`) > 0)
    .slice(0, limit);
}

function relationRank(relation) {
  if (relation === "cited_by_target" || relation === "cites_target") return 3;
  if (relation === "related") return 2;
  return 1;
}

function sourceTokens(source) {
  return new Set(
    normalizeTitle(`${source?.title ?? ""} ${source?.abstract ?? ""}`)
      .split(" ")
      .filter((token) => token.length > 2)
  );
}

function sourceSimilarity(left, right) {
  const leftTokens = sourceTokens(left);
  const rightTokens = sourceTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function retrievalRankScore(source) {
  const ranks = source?.[retrievalRanks] instanceof Map
    ? [...source[retrievalRanks].values()]
    : [];
  const maximumRrf = 3 / (reciprocalRankConstant + 1);
  const rrf = ranks.reduce((sum, rank) => sum + 1 / (reciprocalRankConstant + rank), 0);
  return maximumRrf > 0 ? Math.min(1, rrf / maximumRrf) : 0;
}

function fusedRelevance(source) {
  const query = source?.retrievalQuery ?? "";
  const lexical = lexicalOverlap(query, `${source?.title ?? ""} ${source?.abstract ?? ""}`);
  const relation = relationRank(source?.relation) / 3;
  const records = Array.isArray(source?.sourceRecords) ? source.sourceRecords.length : 1;
  const providerAgreement = Math.min(1, Math.max(0, records - 1) / 2);
  const abstractQuality = Math.min(1, normalizeText(source?.abstract).length / 320);
  const score =
    0.28 * Math.max(0, Math.min(1, source?.relevance ?? 0)) +
    0.24 * lexical +
    0.2 * relation +
    0.12 * retrievalRankScore(source) +
    0.08 * providerAgreement +
    0.05 * abstractQuality +
    0.03 * (source?.openAccessAvailable === true ? 1 : 0);
  return Number(Math.min(1, score).toFixed(3));
}

function diversifySources(sources, limit) {
  const remaining = [...sources];
  const selected = [];
  while (remaining.length > 0 && selected.length < limit) {
    remaining.sort((left, right) => {
      const leftSimilarity = selected.length === 0
        ? 0
        : Math.max(...selected.map((source) => sourceSimilarity(left, source)));
      const rightSimilarity = selected.length === 0
        ? 0
        : Math.max(...selected.map((source) => sourceSimilarity(right, source)));
      const leftScore = (1 - diversityWeight) * left.relevance - diversityWeight * leftSimilarity;
      const rightScore = (1 - diversityWeight) * right.relevance - diversityWeight * rightSimilarity;
      return rightScore - leftScore ||
        relationRank(right.relation) - relationRank(left.relation) ||
        left.title.localeCompare(right.title);
    });
    selected.push(remaining.shift());
  }
  return selected;
}

function sourceRecord(source) {
  return {
    ...(source.arxivId ? { arxivId: source.arxivId } : {}),
    ...(source.doi ? { doi: source.doi } : {}),
    id: source.id,
    provider: source.provider,
    ...(source.sourceRecordUrl ? { recordUrl: source.sourceRecordUrl } : {}),
    title: source.title,
    url: source.url,
    ...(Number.isInteger(source.year) ? { year: source.year } : {})
  };
}

function mergeSourceRecords(...sources) {
  const records = sources.flatMap((source) => (
    Array.isArray(source?.sourceRecords) ? source.sourceRecords : [sourceRecord(source)]
  ));
  return [...new Map(records.map((record) => [`${record.provider}:${record.id}`, record])).values()]
    .slice(0, 6);
}

function mergeExternalSources(sources, limit, options = {}) {
  const deduplicated = new Map();
  const providerRanks = new Map();
  for (const rawSource of sources) {
    const providerRank = (providerRanks.get(rawSource.provider) ?? 0) + 1;
    providerRanks.set(rawSource.provider, providerRank);
    const source = {
      ...rawSource,
      [retrievalRanks]: new Map([[rawSource.provider, providerRank]])
    };
    const doiIdentity = sourceDoiKey(source);
    const arxivIdentity = sourceArxivKey(source);
    const key = doiIdentity
      ? `doi:${doiIdentity}`
      : arxivIdentity
        ? `arxiv:${arxivIdentity}`
        : `${source.provider}:${source.sourceId}`;
    const existingEntry = [...deduplicated.entries()].find(([, candidate]) => (
      (doiIdentity && sourceDoiKey(candidate) === doiIdentity) ||
      (arxivIdentity && sourceArxivKey(candidate) === arxivIdentity)
    ));
    const existing = existingEntry?.[1];
    if (!existing) {
      deduplicated.set(key, source);
      continue;
    }
    const sourceWins = relationRank(source.relation) > relationRank(existing.relation) ||
      (source.provider === existing.provider &&
        relationRank(source.relation) === relationRank(existing.relation) &&
        source.relevance > existing.relevance);
    const primary = sourceWins ? source : existing;
    const doiKey = sourceDoiKey(primary) || sourceDoiKey(existing) || sourceDoiKey(source);
    const arxivKey = sourceArxivKey(primary) || sourceArxivKey(existing) || sourceArxivKey(source);
    const merged = {
      ...primary,
      ...(doiKey ? { doi: `https://doi.org/${doiKey}` } : {}),
      ...(doiKey ? { canonicalPaperId: `doi:${doiKey}` } : {}),
      ...(!doiKey && arxivKey ? { canonicalPaperId: `arxiv:${arxivKey}` } : {}),
      ...(arxivKey ? { arxivId: arxivKey } : {}),
      ...(existing.isRetracted === true || source.isRetracted === true ? { isRetracted: true } : {}),
      ...(existing.openAccessAvailable === true || source.openAccessAvailable === true
        ? { openAccessAvailable: true }
        : {}),
      ...(primary.fullTextUrl || existing.fullTextUrl || source.fullTextUrl
        ? { fullTextUrl: primary.fullTextUrl || existing.fullTextUrl || source.fullTextUrl }
        : {}),
      sourceRecords: mergeSourceRecords(existing, source),
      [retrievalRanks]: new Map([
        ...(existing[retrievalRanks] ?? new Map()),
        ...(source[retrievalRanks] ?? new Map())
      ])
    };
    if (existingEntry) {
      deduplicated.delete(existingEntry[0]);
    }
    const mergedDoi = sourceDoiKey(merged);
    const mergedArxiv = sourceArxivKey(merged);
    deduplicated.set(
      mergedDoi ? `doi:${mergedDoi}` : mergedArxiv ? `arxiv:${mergedArxiv}` : key,
      merged
    );
  }
  const deduplicatedSources = [...deduplicated.values()];
  if (options.rerank === false) {
    return deduplicatedSources
      .sort((left, right) => relationRank(right.relation) - relationRank(left.relation) ||
        right.relevance - left.relevance || left.title.localeCompare(right.title))
      .slice(0, limit)
      .map((source) => {
        const { [retrievalRanks]: _ranks, ...publicSource } = source;
        return publicSource;
      });
  }
  const reranked = deduplicatedSources.map((source) => ({
    ...source,
    relevance: fusedRelevance(source)
  }));
  return diversifySources(reranked, limit).map((source) => {
    const { [retrievalRanks]: _ranks, ...publicSource } = source;
    return publicSource;
  });
}

export async function searchExternalKnowledge(body, options = {}) {
  const limit = Number.isInteger(body?.limit) ? Math.min(maximumResults, Math.max(1, body.limit)) : 5;
  const crossrefEnabled = options.crossrefEnabled !== false;
  const arxivEnabled = options.arxivEnabled === true;
  const [openAlex, crossref, arxiv] = await Promise.allSettled([
    searchOpenAlexExternalKnowledge(body, {
      openAlexApiKey: options.openAlexApiKey,
      timeoutMs: options.openAlexTimeoutMs,
      transport: options.openAlexTransport
    }),
    !crossrefEnabled
      ? Promise.resolve([])
      : searchCrossrefExternalKnowledge(body, { timeoutMs: options.crossrefTimeoutMs, transport: options.crossrefTransport }),
    !arxivEnabled
      ? Promise.resolve([])
      : searchArxivExternalKnowledge(body, { timeoutMs: options.arxivTimeoutMs, transport: options.arxivTransport })
  ]);
  const openAlexSources = openAlex.status === "fulfilled" ? openAlex.value.sources : [];
  const crossrefSources = crossref.status === "fulfilled" ? crossref.value : [];
  const arxivSources = arxiv.status === "fulfilled" ? arxiv.value : [];
  const canUseFallbackWithoutOpenAlex = options.allowCrossrefOnlyFallback === true &&
    (crossref.status === "fulfilled" || arxiv.status === "fulfilled");
  if (openAlex.status === "rejected" && openAlex.reason instanceof ExternalKnowledgeError &&
    openAlex.reason.code === "openalex_api_key_required" && !canUseFallbackWithoutOpenAlex) {
    throw openAlex.reason;
  }
  if (openAlex.status === "rejected" &&
    (!crossrefEnabled || crossref.status === "rejected") &&
    (!arxivEnabled || arxiv.status === "rejected")) {
    throw openAlex.reason instanceof Error ? openAlex.reason : crossref.reason ?? arxiv.reason;
  }
  const sources = mergeExternalSources(
    [...openAlexSources, ...crossrefSources, ...arxivSources],
    limit,
    { rerank: options.rerank !== false }
  );
  const providers = [
    ...(openAlexSources.length > 0 ? ["openalex"] : []),
    ...(crossrefSources.length > 0 ? ["crossref"] : []),
    ...(arxivSources.length > 0 ? ["arxiv"] : [])
  ];
  return {
    provider: providers.join("+") || (arxivEnabled ? "arxiv" : crossrefEnabled ? "crossref" : "openalex"),
    query: normalizeText(body?.query),
    sources,
    status: sources.length > 0 ? "available" : "empty"
  };
}
