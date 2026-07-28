const openAlexEndpoint = "https://api.openalex.org/works";
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

function sourceIdFromWork(work) {
  const rawId = normalizeText(work?.id);
  const match = rawId.match(/(?:openalex\.org\/)?(W\d+)$/i);
  return match ? match[1].toUpperCase() : "";
}

function lexicalOverlap(query, title) {
  const queryTokens = new Set(normalizeTitle(query).split(" ").filter((token) => token.length > 2));
  if (queryTokens.size === 0) {
    return 0;
  }
  const titleTokens = new Set(normalizeTitle(title).split(" ").filter(Boolean));
  const overlap = [...queryTokens].filter((token) => titleTokens.has(token)).length;
  return overlap / queryTokens.size;
}

function normalizeWork(work, input, rank) {
  const sourceId = sourceIdFromWork(work);
  const title = normalizeText(work?.display_name ?? work?.title);
  if (!sourceId || !title || normalizeTitle(title) === normalizeTitle(input.targetPaperTitle)) {
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
    relevance,
    retrievalQuery: input.query,
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
  if (!response?.ok) {
    throw new ExternalKnowledgeError(
      "openalex_upstream_error",
      `OpenAlex 返回 HTTP ${response?.status ?? "unknown"}。`,
      502
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ExternalKnowledgeError("openalex_invalid_response", "OpenAlex 返回格式无效。", 502);
  }
  const works = Array.isArray(payload?.results) ? payload.results : [];
  const sources = works
    .map((work, rank) => normalizeWork(work, { query, targetPaperTitle }, rank))
    .filter(Boolean)
    .slice(0, limit);
  return {
    provider: "openalex",
    query,
    sources,
    status: sources.length > 0 ? "available" : "empty"
  };
}
