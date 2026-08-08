import {
  anchorCoupling,
  matchReferenceEntriesToWorks
} from "./anchorReferenceResolution.mjs";
import {
  normalizeText,
  normalizeTitle,
  sourceIdFromValue,
  sourceIdFromWork
} from "./scholarlyText.mjs";
import { fetchWithConfiguredProxy } from "../providers/proxyFetch.mjs";

const openAlexEndpoint = "https://api.openalex.org/works";
const crossrefEndpoint = "https://api.crossref.org/works";
const arxivEndpoint = "https://export.arxiv.org/api/query";
const doajEndpoint = "https://doaj.org/api/search/articles";
const openAireEndpoint = "https://api.openaire.eu/graph/v3/research-products";
const oapenEndpoint = "https://library.oapen.org/rest/search";
const semanticScholarEndpoint = "https://api.semanticscholar.org/graph/v1";
const maximumQueryLength = 500;
const maximumResults = 32;
const maximumGraphNeighborsPerRelation = 6;
const maximumSemanticGraphSeeds = 4;
const maximumArxivFeedBytes = 1024 * 1024;
const minimumArxivRequestIntervalMs = 3000;
const reciprocalRankConstant = 60;
const diversityWeight = 0.22;
/**
 * How many of an anchor's own cited works to seed. Higher than the whole-paper neighbour cap
 * because these are the highest-value candidates there are — the author put them exactly where
 * the reader is looking — and one batch request covers all of them either way.
 */
const maximumAnchorReferenceSeeds = 12;
/** OpenAlex accepts up to 50 ids in one `openalex_id:` filter. */
const maximumOpenAlexIdsPerBatch = 50;
/** One paper's resolved bibliography is reused by every anchor in it; a handful is plenty. */
const maximumResolvedBibliographies = 4;
const maximumResolvedReferenceEntries = 500;
const retrievalRanks = Symbol("externalKnowledgeRetrievalRanks");
/** A candidate's own reference list. Symbol-keyed so it never reaches the wire. */
const referencedWorkIds = Symbol("externalKnowledgeReferencedWorkIds");
/** Marks a candidate that came from the anchor's own local reference subset. */
const anchorSeeded = Symbol("externalKnowledgeAnchorSeeded");
const resolvedBibliographies = new Map();
const resolvedReferenceEntries = new Map();
let arxivTransportQueue = Promise.resolve();
let nextArxivRequestAt = 0;

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

/**
 * Every work a record cites, uncapped. Coupling needs the whole list — truncating it would
 * make the overlap denominator depend on where the truncation fell.
 */
function referencedWorkIdsOf(work) {
  return [...new Set(
    (Array.isArray(work?.referenced_works) ? work.referenced_works : [])
      .map(sourceIdFromValue)
      .filter(Boolean)
  )];
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
    year: Number.isInteger(work?.publication_year) ? work.publication_year : undefined,
    // Carried for anchor-level coupling. OpenAlex returns this on every work, so measuring
    // overlap against an anchor's local subset costs no extra request.
    [referencedWorkIds]: referencedWorkIdsOf(work)
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
  return fetchWithConfiguredProxy(url, options);
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
    return fetchWithConfiguredProxy(url, options);
  });
  arxivTransportQueue = request.catch(() => undefined);
  return request;
}

function usableOpenAlexIdentifier(value) {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= 512 && !/\s/.test(value);
}

async function fetchOpenAlexPayload(url, options = {}) {
  const requestUrl = new URL(url);
  if (typeof options.openAlexApiKey === "string" && options.openAlexApiKey) {
    requestUrl.searchParams.set("api_key", options.openAlexApiKey);
  }
  // Optional contact metadata; authentication is always the deployment-owned api_key.
  if (typeof options.openAlexMailto === "string" && options.openAlexMailto) {
    requestUrl.searchParams.set("mailto", options.openAlexMailto);
  }
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  try {
    const headers = { Accept: "application/json" };
    // Browsers own the User-Agent header and reject attempts to spoof it. Node deployments can
    // still identify the service, while the direct desktop request is identified by its API key.
    if (typeof navigator === "undefined") {
      headers["User-Agent"] = "LiteasyClaw/0.1";
    }
    const response = await (options.transport ?? defaultOpenAlexTransport)(requestUrl.toString(), {
      headers,
      signal: controller.signal
    });
    if (options.allowNotFound && response?.status === 404) {
      return null;
    }
    if (response?.status === 401 || response?.status === 403) {
      throw new ExternalKnowledgeError(
        "openalex_authorization_failed",
        "学术图谱连接当前不可用。",
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
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw error;
      throw new ExternalKnowledgeError("openalex_invalid_response", "OpenAlex 返回格式无效。", 502);
    }
  } catch (error) {
    if (error instanceof ExternalKnowledgeError) {
      throw error;
    }
    const timedOut = controller.signal.aborted || error?.name === "AbortError";
    throw new ExternalKnowledgeError(
      timedOut ? "openalex_timeout" : "openalex_unavailable",
      timedOut ? "OpenAlex 检索超时。" : "OpenAlex 当前不可用。",
      timedOut ? 504 : 502
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
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

/**
 * Works by id in batches, which is how a whole bibliography becomes affordable: 40 references
 * is one request here, against 40 with `fetchOpenAlexWorksById`.
 */
async function fetchOpenAlexWorksByFilterIds(workIds, options) {
  const ids = [...new Set(workIds.map(sourceIdFromValue).filter(Boolean))];
  if (ids.length === 0) {
    return [];
  }
  const batches = [];
  for (let index = 0; index < ids.length; index += maximumOpenAlexIdsPerBatch) {
    batches.push(ids.slice(index, index + maximumOpenAlexIdsPerBatch));
  }
  const settled = await Promise.allSettled(batches.map((batch) => {
    const url = new URL(openAlexEndpoint);
    url.searchParams.set("filter", `openalex_id:${batch.join("|")}`);
    url.searchParams.set("per-page", String(batch.length));
    return fetchOpenAlexPayload(url, options);
  }));
  const found = new Map(settled
    .flatMap((result) => (
      result.status === "fulfilled" && Array.isArray(result.value?.results)
        ? result.value.results
        : []
    ))
    .map((work) => [sourceIdFromWork(work), work]));
  // Returned in the order asked for, because callers use the position as the candidate's rank.
  // A provider-side ordering would silently reshuffle relevance.
  return ids.map((id) => found.get(id)).filter(Boolean);
}

/**
 * The anchor's local reference subset, resolved to OpenAlex ids.
 *
 * Matching happens inside the target paper's own `referenced_works` — a closed set that `[7]`
 * necessarily belongs to — rather than by searching the open web for each printed entry. The fetched
 * metadata is memoised per target work because every anchor in one paper shares it, and that
 * fetch is the only expensive step.
 */
async function resolveAnchorReferenceWorkIds(targetWork, anchorReferences, options) {
  const entries = Array.isArray(anchorReferences) ? anchorReferences : [];
  const targetId = sourceIdFromWork(targetWork);
  if (entries.length === 0 || !targetId) {
    return { unmatched: entries.map((entry) => entry?.number).filter(Number.isInteger), workIds: [] };
  }
  let works = resolvedBibliographies.get(targetId);
  if (!works) {
    works = await fetchOpenAlexWorksByFilterIds(
      referencedWorkIdsOf(targetWork).slice(0, maximumOpenAlexIdsPerBatch * 2),
      options
    );
    if (resolvedBibliographies.size >= maximumResolvedBibliographies) {
      resolvedBibliographies.delete(resolvedBibliographies.keys().next().value);
    }
    resolvedBibliographies.set(targetId, works);
  }
  const resolved = matchReferenceEntriesToWorks(entries, works);
  const unmatchedEntries = entries.filter((entry) => resolved.unmatched.includes(entry?.number));
  const fallbackResults = await Promise.allSettled(unmatchedEntries.map(async (entry) => {
    const cacheKey = normalizeTitle(entry?.text);
    if (!cacheKey) return null;
    if (resolvedReferenceEntries.has(cacheKey)) return resolvedReferenceEntries.get(cacheKey);

    const url = new URL(openAlexEndpoint);
    url.searchParams.set("search", normalizeText(entry.text).slice(0, maximumQueryLength));
    url.searchParams.set("per-page", "5");
    const payload = await fetchOpenAlexPayload(url, options);
    // Open search only proposes a small candidate set. The same strict title/year/author matcher
    // used for the closed bibliography must verify it before it can become a citation fact.
    const verified = matchReferenceEntriesToWorks([entry], payload?.results).matched[0] ?? null;
    if (resolvedReferenceEntries.size >= maximumResolvedReferenceEntries) {
      resolvedReferenceEntries.delete(resolvedReferenceEntries.keys().next().value);
    }
    resolvedReferenceEntries.set(cacheKey, verified);
    return verified;
  }));
  const fallbackMatches = fallbackResults.flatMap((result) => (
    result.status === "fulfilled" && result.value ? [result.value] : []
  ));
  const matched = [...resolved.matched, ...fallbackMatches]
    .sort((left, right) => left.number - right.number);
  const matchedNumbers = new Set(matched.map((entry) => entry.number));
  return {
    unmatched: entries
      .map((entry) => entry?.number)
      .filter((number) => Number.isInteger(number) && !matchedNumbers.has(number)),
    workIds: [...new Set(matched.map((entry) => entry.workId))]
  };
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

/**
 * The citation neighbourhood, optionally narrowed to one anchor.
 *
 * Measured on the retrieval gate: whole-paper neighbourhood items scored 40% relevant against
 * an anchor while plain topic search scored 68%, and the three anchors with no graph items at
 * all were the three best. `referenced_works` is the paper's entire bibliography, `related_works`
 * is OpenAlex's whole-paper similarity, and works citing the paper cite it for any reason at
 * all — for the anchor "self-attention" that is how a protein-folding paper turns up.
 *
 * `exclusive` keeps only what the author cited next to this anchor. An anchor without a local
 * citation deliberately contributes no graph results. `additive` adds anchor citations on top
 * of the existing behaviour. `off` preserves the original paper-level comparison arm.
 */
async function expandTargetCitationNeighborhood(input, options) {
  if (!input.targetWork || options.expandCitationGraph === false) {
    return [];
  }
  const anchorIds = (input.anchorReferenceWorkIds ?? []).slice(0, maximumAnchorReferenceSeeds);
  const requestedMode = input.anchorReferenceMode ?? "off";
  // An anchor with no local citation has no anchor-level graph. Falling back to the target
  // paper's entire neighbourhood here would reintroduce the noise exclusive mode removes.
  if (requestedMode === "exclusive" && anchorIds.length === 0) {
    return [];
  }
  const mode = anchorIds.length > 0 ? requestedMode : "off";
  const exclusive = mode === "exclusive";
  const anchorIdSet = new Set(anchorIds);
  // The whole-paper seeds keep the per-id path they have always used, so the `off` arm stays
  // byte-identical to what produced the first measurement. Only the anchor seeds are batched —
  // that is where a whole bibliography would otherwise cost one request per entry.
  const wholePaperIds = exclusive
    ? []
    : graphWorkIds(input.targetWork, "referenced_works").filter((id) => !anchorIdSet.has(id));

  const [anchorWorks, referencedWorks, relatedWorks, citingWorks] = await Promise.all([
    fetchOpenAlexWorksByFilterIds(anchorIds, options),
    fetchOpenAlexWorksById(wholePaperIds, options),
    exclusive ? [] : fetchOpenAlexWorksById(graphWorkIds(input.targetWork, "related_works"), options),
    exclusive ? [] : fetchOpenAlexCitingWorks(input.targetWork, input.limit, options)
  ]);

  return [
    ...anchorWorks.map((work, index) => {
      const source = normalizeGraphWork(work, input, index, "cited_by_target");
      return source ? { ...source, anchorReference: true, [anchorSeeded]: true } : null;
    }),
    ...referencedWorks.map((work, index) => normalizeGraphWork(work, input, index, "cited_by_target")),
    ...citingWorks.map((work, index) => normalizeGraphWork(work, input, index, "cites_target")),
    ...relatedWorks.map((work, index) => normalizeGraphWork(work, input, index, "related"))
  ].filter(Boolean);
}

/**
 * Measures how much each candidate's own bibliography overlaps the anchor's local subset.
 *
 * The overlap goes into `relationshipStrength`, which `fusedRelevance` already weighs as a
 * measured coupling magnitude — so no weight changes, and a candidate with no measurable
 * overlap contributes 0 rather than a guess. A topic hit that turns out to share the anchor's
 * references is relabelled `bibliographic_coupling`, which is what it is: built on the same
 * works, with no direct citation either way. Confidence follows from the relation on its own.
 */
function withAnchorCoupling(sources, anchorReferenceWorkIds) {
  if (anchorReferenceWorkIds.length === 0) {
    return sources;
  }
  return sources.map((source) => {
    const coupling = anchorCoupling(anchorReferenceWorkIds, source[referencedWorkIds] ?? []);
    if (coupling <= 0) {
      return source;
    }
    return {
      ...source,
      relationshipStrength: coupling,
      ...(source.relation === "topic_search" ? { relation: "bibliographic_coupling" } : {})
    };
  });
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
  if (!usableOpenAlexIdentifier(options.openAlexApiKey)) {
    throw new ExternalKnowledgeError(
      "academic_graph_unavailable",
      "学术图谱连接当前不可用。",
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
  const anchorReferenceMode = options.anchorReferenceMode ?? "off";
  const anchorReferences = anchorReferenceMode === "off" ? [] : (
    Array.isArray(body?.anchorReferences) ? body.anchorReferences : []
  );
  const anchorResolution = await resolveAnchorReferenceWorkIds(
    targetWork,
    anchorReferences,
    options
  );

  const searchedSources = works
    .map((work, rank) => normalizeWork(work, { query, targetPaperTitle, targetWork }, rank))
    .filter(Boolean)
    .filter((source) => (
      source.relation !== "topic_search" ||
      lexicalOverlap(query, `${source.title} ${source.abstract}`) > 0
    ))
    .slice(0, limit);
  const graphSources = await expandTargetCitationNeighborhood({
    anchorReferenceMode,
    anchorReferenceWorkIds: anchorResolution.workIds,
    limit,
    query,
    targetPaperTitle,
    targetWork
  }, options);
  const sources = mergeExternalSources(
    withAnchorCoupling([...graphSources, ...searchedSources], anchorResolution.workIds),
    limit,
    { rerank: false }
  );
  return {
    provider: "openalex",
    query,
    ...(anchorResolution.workIds.length > 0 || anchorResolution.unmatched.length > 0
      ? {
          anchorReferenceResolution: {
            resolved: anchorResolution.workIds.length,
            unmatched: anchorResolution.unmatched
          }
        }
      : {}),
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
  try {
    const response = await (options.transport ?? defaultArxivTransport)(url.toString(), {
      headers: { Accept: "application/atom+xml", "User-Agent": "LiteasyClaw/0.1" },
      signal: controller.signal
    });
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
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") throw error;
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
  } catch (error) {
    if (error instanceof ExternalKnowledgeError) {
      throw error;
    }
    const timedOut = controller.signal.aborted || error?.name === "AbortError";
    throw new ExternalKnowledgeError(
      timedOut ? "arxiv_timeout" : "arxiv_unavailable",
      timedOut ? "arXiv 检索超时。" : "arXiv 当前不可用。",
      timedOut ? 504 : 502
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonProvider(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 9000);
  try {
    const response = await (options.transport ?? defaultOpenAlexTransport)(url, {
      headers: options.headers,
      signal: controller.signal
    });
    if (!response?.ok) {
      throw new ExternalKnowledgeError(
        `${options.provider ?? "external"}_upstream_error`,
        `${options.providerLabel ?? "外部文献源"}返回 HTTP ${response?.status ?? "unknown"}。`,
        502
      );
    }
    const payload = await response.json();
    if (!payload || typeof payload !== "object") {
      throw new ExternalKnowledgeError(
        `${options.provider ?? "external"}_invalid_response`,
        `${options.providerLabel ?? "外部文献源"}返回格式无效。`,
        502
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof ExternalKnowledgeError) {
      throw error;
    }
    const timedOut = controller.signal.aborted;
    throw new ExternalKnowledgeError(
      timedOut ? `${options.provider ?? "external"}_timeout` : `${options.provider ?? "external"}_unavailable`,
      timedOut ? `${options.providerLabel ?? "外部文献源"}检索超时。` : `${options.providerLabel ?? "外部文献源"}当前不可用。`,
      502
    );
  } finally {
    clearTimeout(timeout);
  }
}

function semanticScholarExternalIds(work) {
  return Object.values(work?.externalIds ?? {})
    .map(normalizeText)
    .filter(Boolean);
}

function normalizeSemanticScholarPaper(work, input, rank, relation = "topic_search", relationshipStrength) {
  const paperId = normalizeText(work?.paperId ?? work?.id);
  const title = normalizeText(work?.title);
  if (!paperId || !title || normalizeTitle(title) === normalizeTitle(input?.targetPaperTitle)) {
    return null;
  }
  const externalIds = semanticScholarExternalIds(work);
  const doi = normalizeDoi(work?.externalIds?.DOI ?? externalIds.find((value) => /^10\.\d{4,9}\//.test(value)));
  const arxivId = normalizeArxivKey(work?.externalIds?.ArXiv ?? externalIds.find((value) => /arxiv/i.test(value)));
  const fullTextUrl = normalizeText(work?.openAccessPdf?.url) || undefined;
  const citationCount = Number.isFinite(work?.citationCount) ? Math.max(0, Math.trunc(work.citationCount)) : undefined;
  const referencesCount = Number.isFinite(work?.referenceCount) ? Math.max(0, Math.trunc(work.referenceCount)) : undefined;
  const strength = Number.isFinite(relationshipStrength)
    ? Math.max(0, Math.min(1, relationshipStrength))
    : undefined;
  return {
    abstract: normalizeText(work?.abstract),
    accessStatus: fullTextUrl ? "open_access" : "metadata_only",
    authors: Array.isArray(work?.authors)
      ? work.authors.map((author) => normalizeText(author?.name)).filter(Boolean).slice(0, 12)
      : [],
    ...(arxivId ? { arxivId } : {}),
    ...(doi ? { canonicalPaperId: `doi:${normalizeDoiKey(doi)}`, doi } : {}),
    ...(citationCount !== undefined ? { citationCount } : {}),
    ...(fullTextUrl ? { fullTextUrl } : {}),
    id: `semantic_scholar:${paperId}`,
    provider: "semantic_scholar",
    relation,
    relevance: Number((strength ?? Math.max(0.35, 1 - rank / 20)).toFixed(3)),
    ...(strength !== undefined ? { relationshipStrength: strength } : {}),
    ...(referencesCount !== undefined ? { referencesCount } : {}),
    retrievalQuery: normalizeText(input?.query),
    sourceId: paperId,
    sourceRecordUrl: `https://www.semanticscholar.org/paper/${paperId}`,
    title,
    url: normalizeText(work?.url) || doi || `https://www.semanticscholar.org/paper/${paperId}`,
    workType: "article",
    ...(Number.isInteger(work?.year) ? { year: work.year } : {})
  };
}

function semanticScholarIdentity(input) {
  const kind = normalizeText(input?.targetPaperIdentity?.kind);
  const value = normalizeText(input?.targetPaperIdentity?.value);
  if (kind === "doi") {
    const doi = normalizeDoiKey(value);
    return doi ? `DOI:${doi}` : "";
  }
  if (kind === "arxiv_id") {
    const arxivId = normalizeArxivKey(value);
    return arxivId ? `ARXIV:${arxivId}` : "";
  }
  return "";
}

function semanticScholarHeaders(options) {
  return typeof options.semanticScholarApiKey === "string" && options.semanticScholarApiKey.trim()
    ? { "x-api-key": options.semanticScholarApiKey.trim() }
    : undefined;
}

async function fetchSemanticScholarPaper(paperId, options) {
  const url = new URL(`${semanticScholarEndpoint}/paper/${encodeURIComponent(paperId)}`);
  url.searchParams.set(
    "fields",
    "paperId,title,abstract,authors,year,url,externalIds,openAccessPdf,citationCount,referenceCount"
  );
  return fetchJsonProvider(url.toString(), {
    headers: semanticScholarHeaders(options),
    provider: "semantic_scholar",
    providerLabel: "Semantic Scholar",
    timeoutMs: options.timeoutMs,
    transport: options.transport
  });
}

async function fetchSemanticScholarRelations(paperId, relation, options) {
  const url = new URL(`${semanticScholarEndpoint}/paper/${encodeURIComponent(paperId)}/${relation}`);
  url.searchParams.set("limit", String(maximumGraphNeighborsPerRelation));
  url.searchParams.set(
    "fields",
    "paperId,title,abstract,authors,year,url,externalIds,openAccessPdf,citationCount,referenceCount"
  );
  const payload = await fetchJsonProvider(url.toString(), {
    headers: semanticScholarHeaders(options),
    provider: "semantic_scholar",
    providerLabel: "Semantic Scholar",
    timeoutMs: options.timeoutMs,
    transport: options.transport
  });
  const relationField = relation === "references" ? "citedPaper" : "citingPaper";
  return Array.isArray(payload?.data)
    ? payload.data.map((entry) => entry?.[relationField]).filter(Boolean)
    : [];
}

async function searchSemanticScholarExternalKnowledge(body, options = {}) {
  const query = normalizeText(body?.query);
  if (!query) return [];
  const searchUrl = new URL(`${semanticScholarEndpoint}/paper/search`);
  searchUrl.searchParams.set("query", query);
  searchUrl.searchParams.set("limit", String(Math.min(maximumResults, Math.max(8, body?.limit ?? 8))));
  searchUrl.searchParams.set(
    "fields",
    "paperId,title,abstract,authors,year,url,externalIds,openAccessPdf,citationCount,referenceCount"
  );
  const searchPayload = await fetchJsonProvider(searchUrl.toString(), {
    headers: semanticScholarHeaders(options),
    provider: "semantic_scholar",
    providerLabel: "Semantic Scholar",
    timeoutMs: options.timeoutMs,
    transport: options.transport
  });
  const searchWorks = Array.isArray(searchPayload?.data) ? searchPayload.data : [];
  const searchSources = searchWorks
    .map((work, rank) => normalizeSemanticScholarPaper(work, body, rank, "topic_search"))
    .filter(Boolean);
  if (options.expandCitationGraph === false) {
    return searchSources;
  }
  const identity = semanticScholarIdentity(body);
  let target = null;
  try {
    target = identity
      ? await fetchSemanticScholarPaper(identity, options)
      : searchWorks.find((work) => normalizeTitle(work?.title) === normalizeTitle(body?.targetPaperTitle)) ?? null;
  } catch {
    target = searchWorks.find((work) => normalizeTitle(work?.title) === normalizeTitle(body?.targetPaperTitle)) ?? null;
  }
  const targetPaperId = normalizeText(target?.paperId);
  if (!targetPaperId) {
    return searchSources;
  }

  const [referencesResult, citationsResult] = await Promise.allSettled([
    fetchSemanticScholarRelations(targetPaperId, "references", options),
    fetchSemanticScholarRelations(targetPaperId, "citations", options)
  ]);
  const references = referencesResult.status === "fulfilled" ? referencesResult.value : [];
  const citations = citationsResult.status === "fulfilled" ? citationsResult.value : [];
  const targetReferenceIds = new Set(references.map((work) => normalizeText(work?.paperId)).filter(Boolean));
  const directSources = [
    ...references.map((work, rank) => normalizeSemanticScholarPaper(work, body, rank, "cited_by_target", 0.96)),
    ...citations.map((work, rank) => normalizeSemanticScholarPaper(work, body, rank, "cites_target", 0.94))
  ].filter(Boolean);

  const coCitationCounts = new Map();
  await Promise.allSettled(
    citations.slice(0, maximumSemanticGraphSeeds).map(async (citingWork) => {
      const citingId = normalizeText(citingWork?.paperId);
      if (!citingId) return;
      const citedWorks = await fetchSemanticScholarRelations(citingId, "references", options);
      for (const candidate of citedWorks) {
        const candidateId = normalizeText(candidate?.paperId);
        if (!candidateId || candidateId === targetPaperId) continue;
        const current = coCitationCounts.get(candidateId) ?? { count: 0, work: candidate };
        coCitationCounts.set(candidateId, { count: current.count + 1, work: candidate });
      }
    })
  );
  const coCitedSources = [...coCitationCounts.values()]
    .sort((left, right) => right.count - left.count || normalizeText(left.work?.title).localeCompare(normalizeText(right.work?.title)))
    .slice(0, maximumGraphNeighborsPerRelation)
    .map((entry, rank) => normalizeSemanticScholarPaper(
      entry.work,
      body,
      rank,
      "co_cited",
      Math.min(0.92, 0.56 + entry.count / Math.max(1, maximumSemanticGraphSeeds) * 0.36)
    ))
    .filter(Boolean);

  const couplingSources = [];
  const candidateWorks = [...searchWorks, ...citations]
    .filter((work) => normalizeText(work?.paperId) && normalizeText(work?.paperId) !== targetPaperId)
    .slice(0, maximumSemanticGraphSeeds);
  const candidateReferenceLists = await Promise.allSettled(
    candidateWorks.map((work) => fetchSemanticScholarRelations(normalizeText(work.paperId), "references", options))
  );
  candidateReferenceLists.forEach((result, index) => {
    if (result.status !== "fulfilled" || targetReferenceIds.size === 0) return;
    const shared = result.value.filter((reference) => targetReferenceIds.has(normalizeText(reference?.paperId))).length;
    if (shared === 0) return;
    const strength = Math.min(0.9, 0.48 + shared / Math.max(1, targetReferenceIds.size) * 2.6);
    const source = normalizeSemanticScholarPaper(candidateWorks[index], body, index, "bibliographic_coupling", strength);
    if (source) couplingSources.push(source);
  });

  return [...directSources, ...coCitedSources, ...couplingSources, ...searchSources];
}

function openAireString(value) {
  if (typeof value === "string") return normalizeText(value);
  if (value && typeof value === "object") {
    return normalizeText(value.value ?? value.name ?? value.title ?? value.url);
  }
  return "";
}

function normalizeOpenAirePaper(work, input, rank) {
  const title = openAireString(work?.title) || openAireString(work?.result?.title);
  const sourceId = normalizeText(work?.id ?? work?.result?.id ?? work?.pid ?? work?.originalId);
  if (!title || !sourceId || normalizeTitle(title) === normalizeTitle(input?.targetPaperTitle)) {
    return null;
  }
  const pids = Array.isArray(work?.pids) ? work.pids : Array.isArray(work?.pid) ? work.pid : [];
  const pidValues = [work?.doi, ...pids, work?.pid, work?.originalId]
    .map(openAireString)
    .filter(Boolean);
  const doi = normalizeDoi(pidValues.find((value) => /^10\.\d{4,9}\//.test(normalizeDoiKey(value))));
  const fullTextUrl = [
    work?.bestOALocation?.url,
    work?.bestOALocation?.pdfUrl,
    work?.openAccessPdf?.url,
    work?.fullTextUrl,
    work?.url
  ].map(openAireString).find((value) => /^https:\/\//i.test(value));
  const authors = Array.isArray(work?.authors)
    ? work.authors.map(openAireString).filter(Boolean)
    : Array.isArray(work?.creator)
      ? work.creator.map(openAireString).filter(Boolean)
      : [];
  const yearCandidate = Number(work?.publicationYear ?? work?.year ?? work?.dateofacceptance?.slice?.(0, 4));
  const workType = normalizeText(work?.type ?? work?.instancetype).toLowerCase();
  return {
    abstract: openAireString(work?.abstract ?? work?.description),
    accessStatus: fullTextUrl ? "open_access" : "metadata_only",
    authors: authors.slice(0, 12),
    ...(doi ? { canonicalPaperId: `doi:${normalizeDoiKey(doi)}`, doi } : {}),
    ...(fullTextUrl ? { fullTextUrl } : {}),
    id: `openaire:${sourceId}`,
    provider: "openaire",
    relation: "topic_search",
    relevance: Number(Math.max(0.3, 1 - rank / 20).toFixed(3)),
    retrievalQuery: normalizeText(input?.query),
    sourceId,
    sourceRecordUrl: `https://explore.openaire.eu/search/publication?articleId=${encodeURIComponent(sourceId)}`,
    title,
    url: fullTextUrl || doi || `https://explore.openaire.eu/search/publication?articleId=${encodeURIComponent(sourceId)}`,
    workType: workType.includes("book") ? "book" : workType.includes("dataset") ? "dataset" : "article",
    ...(Number.isInteger(yearCandidate) && yearCandidate > 1000 ? { year: yearCandidate } : {})
  };
}

async function searchOpenAireExternalKnowledge(body, options = {}) {
  const query = normalizeText(body?.query);
  if (!query) return [];
  const url = new URL(openAireEndpoint);
  url.searchParams.set("search", query);
  url.searchParams.set("type", "publication");
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", String(Math.min(maximumResults, Math.max(8, body?.limit ?? 8))));
  url.searchParams.set("sortBy", "relevance DESC");
  const payload = await fetchJsonProvider(url.toString(), {
    headers: { accept: "application/json" },
    provider: "openaire",
    providerLabel: "OpenAIRE",
    timeoutMs: options.timeoutMs,
    transport: options.transport
  });
  const works = Array.isArray(payload?.results)
    ? payload.results
    : Array.isArray(payload?.response?.results?.result)
      ? payload.response.results.result
      : [];
  return works
    .map((work, rank) => normalizeOpenAirePaper(work, body, rank))
    .filter(Boolean);
}

function oapenValue(value) {
  if (typeof value === "string") return normalizeText(value);
  if (value && typeof value === "object") {
    return normalizeText(value.value ?? value.text ?? value.name ?? value.url);
  }
  return "";
}

function oapenMetadataValues(item, field) {
  const metadata = item?.metadata;
  if (Array.isArray(metadata)) {
    return metadata
      .filter((entry) => normalizeText(entry?.key ?? entry?.schema) === field)
      .flatMap((entry) => Array.isArray(entry?.value) ? entry.value : [entry?.value])
      .map(oapenValue)
      .filter(Boolean);
  }
  const value = metadata?.[field] ?? item?.[field];
  return (Array.isArray(value) ? value : [value]).map(oapenValue).filter(Boolean);
}

function oapenBitstreams(item) {
  const direct = [
    item?.bitstreams,
    item?.bundles?.flatMap?.((bundle) => bundle?.bitstreams ?? []),
    item?._embedded?.bitstreams,
    item?._embedded?.bundles?.flatMap?.((bundle) => bundle?._embedded?.bitstreams ?? [])
  ];
  return direct.flatMap((value) => Array.isArray(value) ? value : []);
}

function oapenPdfUrl(item) {
  return oapenBitstreams(item)
    .map((bitstream) => ({
      contentType: normalizeText(bitstream?.mimeType ?? bitstream?.format ?? bitstream?.type).toLowerCase(),
      url: oapenValue(bitstream?.content ?? bitstream?.retrieveLink ?? bitstream?.url ?? bitstream?._links?.content?.href)
    }))
    .find((bitstream) => /^https:\/\//i.test(bitstream.url) &&
      (bitstream.contentType.includes("pdf") || /\.pdf(?:$|[?#])/i.test(bitstream.url)))?.url;
}

function oapenHandle(value) {
  const normalized = normalizeText(value);
  return normalized.match(/\/handle\/(\d+(?:\.\d+)+\/[^/?#\s]+)/i)?.[1] ??
    normalized.match(/^(\d+(?:\.\d+)+\/[^/?#\s]+)$/i)?.[1] ?? "";
}

function normalizeOapenBook(item, input, rank) {
  const handle = oapenMetadataValues(item, "dc.identifier.uri")
    .map(oapenHandle)
    .find(Boolean) ?? "";
  const title = oapenMetadataValues(item, "dc.title")[0] || normalizeText(item?.name);
  if (!handle || !title || normalizeTitle(title) === normalizeTitle(input?.targetPaperTitle)) {
    return null;
  }
  const doi = normalizeDoi(oapenMetadataValues(item, "dc.identifier.doi")[0]);
  const date = oapenMetadataValues(item, "dc.date.issued")[0] ?? "";
  const yearMatch = date.match(/(?:^|\D)(1[5-9]\d{2}|20\d{2})(?:\D|$)/);
  const sourceRecordUrl = `https://library.oapen.org/handle/${handle}`;
  const fullTextUrl = oapenPdfUrl(item);
  return {
    abstract: oapenMetadataValues(item, "dc.description.abstract")[0] ?? "",
    accessStatus: fullTextUrl ? "open_access" : "metadata_only",
    authors: oapenMetadataValues(item, "dc.contributor.author").slice(0, 12),
    ...(doi ? { canonicalPaperId: `doi:${normalizeDoiKey(doi)}`, doi } : {}),
    ...(fullTextUrl ? { fullTextUrl } : {}),
    id: `oapen:${handle}`,
    openAccessAvailable: Boolean(fullTextUrl),
    provider: "oapen",
    relation: "topic_search",
    relevance: Number(Math.max(0.3, 1 - rank / 20).toFixed(3)),
    retrievalQuery: normalizeText(input?.query),
    sourceId: handle,
    sourceRecordUrl,
    title,
    url: fullTextUrl || sourceRecordUrl,
    workType: "book",
    ...(yearMatch ? { year: Number(yearMatch[1]) } : {})
  };
}

async function searchOapenExternalKnowledge(body, options = {}) {
  const query = normalizeText(body?.query);
  if (!query) return [];
  const url = new URL(oapenEndpoint);
  url.searchParams.set("query", query);
  url.searchParams.set("expand", "metadata,bitstreams");
  const payload = await fetchJsonProvider(url.toString(), {
    headers: { accept: "application/json" },
    provider: "oapen",
    providerLabel: "OAPEN",
    timeoutMs: options.timeoutMs,
    transport: options.transport
  });
  const works = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.docs)
      ? payload.docs
      : Array.isArray(payload?._embedded?.items)
        ? payload._embedded.items
        : [];
  return works
    .map((work, rank) => normalizeOapenBook(work, body, rank))
    .filter(Boolean)
    .filter((source) => lexicalOverlap(query, `${source.title} ${source.abstract}`) > 0);
}

function doajText(value) {
  return typeof value === "string" ? normalizeText(value) : "";
}

function doajDoi(item) {
  const identifiers = Array.isArray(item?.bibjson?.identifier) ? item.bibjson.identifier : [];
  return normalizeDoi(identifiers.find((identifier) =>
    normalizeText(identifier?.type).toLowerCase() === "doi"
  )?.id);
}

function doajPdfUrl(item) {
  const links = Array.isArray(item?.bibjson?.link) ? item.bibjson.link : [];
  return links
    .map((link) => ({
      contentType: normalizeText(link?.content_type ?? link?.type).toLowerCase(),
      url: doajText(link?.url)
    }))
    .find((link) => /^https:\/\//i.test(link.url) &&
      (link.contentType.includes("pdf") || /\.pdf(?:$|[?#])/i.test(link.url)))?.url;
}

function normalizeDoajArticle(item, input, rank) {
  const sourceId = normalizeText(item?.id);
  const title = doajText(item?.bibjson?.title);
  if (!sourceId || !title || normalizeTitle(title) === normalizeTitle(input?.targetPaperTitle)) {
    return null;
  }
  const doi = doajDoi(item);
  const fullTextUrl = doajPdfUrl(item);
  const year = Number(item?.bibjson?.year);
  const sourceRecordUrl = `https://doaj.org/article/${encodeURIComponent(sourceId)}`;
  return {
    abstract: doajText(item?.bibjson?.abstract),
    accessStatus: fullTextUrl ? "open_access" : "metadata_only",
    authors: Array.isArray(item?.bibjson?.author)
      ? item.bibjson.author.map((author) => doajText(author?.name)).filter(Boolean).slice(0, 12)
      : [],
    ...(doi ? { canonicalPaperId: `doi:${normalizeDoiKey(doi)}`, doi } : {}),
    ...(fullTextUrl ? { fullTextUrl, openAccessAvailable: true } : {}),
    id: `doaj:${sourceId}`,
    provider: "doaj",
    relation: "topic_search",
    relevance: Number(Math.max(0.3, 1 - rank / 20).toFixed(3)),
    retrievalQuery: normalizeText(input?.query),
    sourceId,
    sourceRecordUrl,
    title,
    url: fullTextUrl || sourceRecordUrl,
    workType: "article",
    ...(Number.isInteger(year) && year > 1000 ? { year } : {})
  };
}

async function searchDoajExternalKnowledge(body, options = {}) {
  const query = normalizeText(body?.query);
  if (!query) return [];
  const url = `${doajEndpoint}/${encodeURIComponent(query)}`;
  const payload = await fetchJsonProvider(url, {
    headers: { accept: "application/json" },
    provider: "doaj",
    providerLabel: "DOAJ",
    timeoutMs: options.timeoutMs,
    transport: options.transport
  });
  const works = Array.isArray(payload?.results)
    ? payload.results
    : Array.isArray(payload?.data)
      ? payload.data
      : [];
  return works
    .map((work, rank) => normalizeDoajArticle(work, body, rank))
    .filter(Boolean)
    .filter((source) => lexicalOverlap(query, `${source.title} ${source.abstract}`) > 0);
}

function relationRank(relation) {
  if (relation === "cited_by_target" || relation === "cites_target") return 5;
  if (relation === "co_cited" || relation === "bibliographic_coupling") return 4;
  if (relation === "related") return 3;
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

/**
 * Relevance is an estimate of how closely a source speaks to the query, and nothing else.
 *
 * It used to fold the citation relation in twice — `0.14 * relation`, plus a
 * `relationshipStrength` that defaulted to the relation rank — which made a discrete fact
 * ("the author cited this") contribute a third of a continuous estimate. Mixing the two
 * blurs both and leaves the UI with no independent channel for confidence, so provenance now
 * lives in `relationConfidence` instead. A measured coupling magnitude is still an estimate
 * input; when it was never measured it is 0, not a guess derived from the relation kind.
 */
function fusedRelevance(source) {
  const query = source?.retrievalQuery ?? "";
  const lexical = lexicalOverlap(query, `${source?.title ?? ""} ${source?.abstract ?? ""}`);
  const relationshipStrength = Number.isFinite(source?.relationshipStrength)
    ? Math.max(0, Math.min(1, source.relationshipStrength))
    : 0;
  const records = Array.isArray(source?.sourceRecords) ? source.sourceRecords.length : 1;
  const providerAgreement = Math.min(1, Math.max(0, records - 1) / 2);
  const abstractQuality = Math.min(1, normalizeText(source?.abstract).length / 320);
  const score =
    0.256 * Math.max(0, Math.min(1, source?.relevance ?? 0)) +
    0.233 * lexical +
    0.233 * relationshipStrength +
    0.116 * retrievalRankScore(source) +
    0.081 * providerAgreement +
    0.047 * abstractQuality +
    0.034 * (source?.openAccessAvailable === true ? 1 : 0);
  return Number(Math.min(1, score).toFixed(3));
}

/**
 * Confidence is the discrete fact of where the link came from, kept apart from the relevance
 * estimate so the reader can tell "the author cited this" from "an algorithm thinks these are
 * similar". The plan's rule: a semantic match with no citation relation must never be
 * presented as though it were the author's own reference.
 */
function relationConfidence(source) {
  const relation = source?.relation;
  if (relation === "cited_by_target" || relation === "cites_target") {
    return { confidence: 1, confidenceBasis: "author_citation" };
  }
  if (relation === "co_cited" || relation === "bibliographic_coupling") {
    return { confidence: 0.6, confidenceBasis: "citation_graph" };
  }
  return { confidence: 0.3, confidenceBasis: "algorithmic_retrieval" };
}

function diversifySources(sources, limit) {
  // An explicitly cited work next to the active anchor is verified evidence, not merely a
  // ranking candidate. Reserve its place before semantic diversification so high-scoring topic
  // matches from numerous providers cannot erase the only anchor-level citation from top-k.
  const selected = sources
    .filter((source) => source.anchorReference === true || source[anchorSeeded] === true)
    .sort((left, right) => right.relevance - left.relevance || left.title.localeCompare(right.title))
    .slice(0, limit);
  const selectedSet = new Set(selected);
  const remaining = sources.filter((source) => !selectedSet.has(source));
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

/**
 * Drops the symbol-keyed working state. Symbols are invisible to JSON but not to
 * `assert.deepStrictEqual`, and they are bookkeeping rather than anything a caller should see.
 */
function withoutInternalFields(source) {
  const {
    [anchorSeeded]: _seeded,
    [referencedWorkIds]: _referenced,
    [retrievalRanks]: _ranks,
    ...publicSource
  } = source;
  return publicSource;
}

export function mergeExternalSources(sources, limit, options = {}) {
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
      candidate.id === source.id ||
      (candidate.provider === source.provider && candidate.sourceId === source.sourceId) ||
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
        // The author's own citation at the anchor outranks anything else of the same relation
        // kind. Without this the provider-level slice can drop it for a work that merely cites
        // the paper somewhere, and the seeds would never reach the caller at all.
        (right[anchorSeeded] === true ? 1 : 0) - (left[anchorSeeded] === true ? 1 : 0) ||
        right.relevance - left.relevance || left.title.localeCompare(right.title))
      .slice(0, limit)
      .map(withoutInternalFields);
  }
  const reranked = deduplicatedSources.map((source) => ({
    ...source,
    ...relationConfidence(source),
    relevance: fusedRelevance(source)
  }));
  return diversifySources(reranked, limit).map(withoutInternalFields);
}

const externalKnowledgeProviderDefinitions = Object.freeze([
  {
    enabled: (options) => options.openAlexEnabled !== false,
    id: "openalex",
    search: (body, options) => searchOpenAlexExternalKnowledge(body, {
      anchorReferenceMode: options.anchorReferenceMode,
      expandCitationGraph: options.expandCitationGraph,
      openAlexApiKey: options.openAlexApiKey,
      openAlexMailto: options.openAlexMailto,
      timeoutMs: options.openAlexTimeoutMs,
      transport: options.openAlexTransport
    }),
    sources: (value) => Array.isArray(value?.sources) ? value.sources : []
  },
  {
    enabled: (options) => options.crossrefEnabled !== false,
    id: "crossref",
    search: (body, options) => searchCrossrefExternalKnowledge(body, {
      timeoutMs: options.crossrefTimeoutMs,
      transport: options.crossrefTransport
    }),
    sources: (value) => Array.isArray(value) ? value : []
  },
  {
    enabled: (options) => options.arxivEnabled === true,
    id: "arxiv",
    search: (body, options) => searchArxivExternalKnowledge(body, {
      timeoutMs: options.arxivTimeoutMs,
      transport: options.arxivTransport
    }),
    sources: (value) => Array.isArray(value) ? value : []
  },
  {
    enabled: (options) => options.semanticScholarEnabled === true,
    id: "semantic_scholar",
    search: (body, options) => searchSemanticScholarExternalKnowledge(body, {
      // Semantic Scholar can expand only a whole-paper graph. In anchor-exclusive mode that
      // would reintroduce the exact paper-level noise the local-reference boundary removes.
      expandCitationGraph: options.expandCitationGraph !== false && options.anchorReferenceMode !== "exclusive",
      semanticScholarApiKey: options.semanticScholarApiKey,
      timeoutMs: options.semanticScholarTimeoutMs,
      transport: options.semanticScholarTransport
    }),
    sources: (value) => Array.isArray(value) ? value : []
  },
  {
    enabled: (options) => options.openAireEnabled === true,
    id: "openaire",
    search: (body, options) => searchOpenAireExternalKnowledge(body, {
      timeoutMs: options.openAireTimeoutMs,
      transport: options.openAireTransport
    }),
    sources: (value) => Array.isArray(value) ? value : []
  },
  {
    enabled: (options) => options.oapenEnabled === true,
    id: "oapen",
    search: (body, options) => searchOapenExternalKnowledge(body, {
      timeoutMs: options.oapenTimeoutMs,
      transport: options.oapenTransport
    }),
    sources: (value) => Array.isArray(value) ? value : []
  },
  {
    enabled: (options) => options.doajEnabled === true,
    id: "doaj",
    search: (body, options) => searchDoajExternalKnowledge(body, {
      timeoutMs: options.doajTimeoutMs,
      transport: options.doajTransport
    }),
    sources: (value) => Array.isArray(value) ? value : []
  }
]);

export function listExternalKnowledgeProviderIds() {
  return externalKnowledgeProviderDefinitions.map((provider) => provider.id);
}

async function searchExternalKnowledgeOnce(body, options = {}) {
  const limit = Number.isInteger(body?.limit) ? Math.min(maximumResults, Math.max(1, body.limit)) : 5;
  const enabledProviders = externalKnowledgeProviderDefinitions.filter((provider) => provider.enabled(options));
  const settled = await Promise.allSettled(
    enabledProviders.map((provider) => provider.search(body, options))
  );
  const providerResults = enabledProviders.map((provider, index) => ({
    provider,
    result: settled[index],
    sources: settled[index].status === "fulfilled"
      ? provider.sources(settled[index].value)
      : []
  }));
  const openAlex = providerResults.find((entry) => entry.provider.id === "openalex");
  const canUseFallbackWithoutOpenAlex = options.allowCrossrefOnlyFallback === true &&
    providerResults.some((entry) => entry.provider.id !== "openalex" && entry.result.status === "fulfilled");
  if (openAlex?.result.status === "rejected" && openAlex.result.reason instanceof ExternalKnowledgeError &&
    openAlex.result.reason.code === "academic_graph_unavailable" && !canUseFallbackWithoutOpenAlex) {
    throw openAlex.result.reason;
  }
  if (providerResults.length > 0 && providerResults.every(({ result }) => result.status === "rejected")) {
    const firstFailure = providerResults[0].result.reason;
    if (providerResults.length === 1 && firstFailure instanceof Error) {
      throw firstFailure;
    }
    throw new ExternalKnowledgeError(
      "external_knowledge_unavailable",
      "统一联网服务当前无法连接外部学术来源，请检查服务端网络连接后重试。",
      502
    );
  }
  const sources = mergeExternalSources(
    providerResults.flatMap((entry) => entry.sources),
    limit,
    { rerank: options.rerank !== false }
  );
  const providers = providerResults.filter((entry) => entry.sources.length > 0)
    .map((entry) => entry.provider.id);
  const openAlexDiagnostics = openAlex?.result.status === "fulfilled"
    ? openAlex.result.value?.anchorReferenceResolution
    : undefined;
  return {
    provider: providers.join("+") || enabledProviders[0]?.id || "none",
    query: normalizeText(body?.query),
    ...(openAlexDiagnostics ? { anchorReferenceResolution: openAlexDiagnostics } : {}),
    sources,
    status: sources.length > 0 ? "available" : "empty"
  };
}

function normalizedQueryVariants(body) {
  const requested = Array.isArray(body?.queryVariants) ? body.queryVariants : [];
  return [...new Set([...requested, body?.query]
    .map(normalizeText)
    .filter((query) => query && query.length <= maximumQueryLength))].slice(0, 2);
}

export async function searchExternalKnowledge(body, options = {}) {
  const queries = normalizedQueryVariants(body);
  if (queries.length <= 1) {
    return searchExternalKnowledgeOnce({ ...body, query: queries[0] ?? body?.query }, options);
  }
  const limit = Number.isInteger(body?.limit) ? Math.min(maximumResults, Math.max(1, body.limit)) : 5;
  const settled = await Promise.allSettled(queries.map((query, index) => searchExternalKnowledgeOnce(
    { ...body, query },
    { ...options, expandCitationGraph: options.expandCitationGraph !== false && index === 0 }
  )));
  const completed = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (completed.length === 0) {
    throw settled[0].reason;
  }
  const sources = mergeExternalSources(completed.flatMap((result) => result.sources), limit, {
    rerank: options.rerank !== false
  });
  const providers = [...new Set(completed
    .flatMap((result) => result.provider.split("+"))
    .filter((provider) => provider && provider !== "none"))];
  const anchorReferenceResolution = completed
    .map((result) => result.anchorReferenceResolution)
    .find(Boolean);
  return {
    provider: providers.join("+") || "none",
    query: queries[0],
    queryVariants: queries,
    ...(anchorReferenceResolution ? { anchorReferenceResolution } : {}),
    sources,
    status: sources.length > 0 ? "available" : "empty"
  };
}
