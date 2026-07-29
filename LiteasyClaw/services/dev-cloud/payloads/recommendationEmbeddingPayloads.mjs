const maximumEmbeddingInputs = 32;
const maximumEmbeddingTextLength = 1800;
const maximumEmbeddingDimension = 4096;
const maximumEmbeddingResponseBytes = 4 * 1024 * 1024;

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function buildEmbeddingUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("recommendation_embedding_endpoint_invalid");
  }
  if (url.username || url.password) {
    throw new Error("recommendation_embedding_endpoint_invalid");
  }
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath.endsWith("/embeddings")
    ? normalizedPath
    : `${normalizedPath}/embeddings`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function embeddingText(source) {
  return normalizeText([
    source?.title,
    source?.abstract,
    Array.isArray(source?.authors) ? source.authors.slice(0, 6).join(", ") : ""
  ].filter(Boolean).join("\n")).slice(0, maximumEmbeddingTextLength);
}

function sourceKey(source) {
  return `${source?.provider ?? "unknown"}:${source?.id ?? source?.sourceId ?? source?.title ?? ""}`;
}

function validateVector(value) {
  return Array.isArray(value) &&
    value.length >= 8 &&
    value.length <= maximumEmbeddingDimension &&
    value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return Number(Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm))).toFixed(3));
}

async function defaultEmbeddingTransport(url, options) {
  return fetch(url, options);
}

async function requestEmbeddings(texts, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  let response;
  try {
    response = await (options.transport ?? defaultEmbeddingTransport)(
      buildEmbeddingUrl(options.baseUrl),
      {
        body: JSON.stringify({
          encoding_format: "float",
          input: texts,
          model: options.model
        }),
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json"
        },
        method: "POST",
        signal: controller.signal
      }
    );
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      throw new Error("recommendation_embedding_timeout");
    }
    throw new Error("recommendation_embedding_unavailable");
  } finally {
    clearTimeout(timeout);
  }
  if (!response?.ok) {
    throw new Error(`recommendation_embedding_http_${response?.status ?? "unknown"}`);
  }
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumEmbeddingResponseBytes) {
    throw new Error("recommendation_embedding_response_too_large");
  }
  let payload;
  try {
    if (typeof response.text === "function") {
      const text = await response.text();
      if (text.length > maximumEmbeddingResponseBytes) {
        throw new Error("recommendation_embedding_response_too_large");
      }
      payload = JSON.parse(text);
    } else {
      payload = await response.json();
    }
  } catch (error) {
    if (error?.message === "recommendation_embedding_response_too_large") {
      throw error;
    }
    throw new Error("recommendation_embedding_response_invalid");
  }
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const indexes = data.map((item) => item?.index);
  if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= texts.length) ||
    new Set(indexes).size !== data.length) {
    throw new Error("recommendation_embedding_vectors_invalid");
  }
  const ordered = [...data].sort((left, right) => left.index - right.index);
  const vectors = ordered.map((item) => item?.embedding);
  const dimension = vectors[0]?.length;
  if (vectors.length !== texts.length || !vectors.every((vector) => (
    validateVector(vector) && vector.length === dimension
  ))) {
    throw new Error("recommendation_embedding_vectors_invalid");
  }
  return { dimension, vectors };
}

function disabledAudit() {
  return {
    status: "disabled",
    version: "recommendation-semantic-retrieval/v1"
  };
}

export async function applyRecommendationEmbeddingScores(sourceGroups, options = {}) {
  const groups = Array.isArray(sourceGroups) ? sourceGroups : [];
  const baseUrl = normalizeText(options.baseUrl);
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  const model = normalizeText(options.model);
  if (!baseUrl || !apiKey || !model) {
    return { audit: disabledAudit(), sourceGroups: groups };
  }
  if (baseUrl.length > 2048 || apiKey.length > 4096 || /\s/.test(apiKey) || model.length > 200) {
    return {
      audit: {
        error: "recommendation_embedding_config_invalid",
        status: "failed",
        version: "recommendation-semantic-retrieval/v1"
      },
      sourceGroups: groups
    };
  }

  const queryEntries = groups.map((group, index) => ({
    key: `query:${index}`,
    text: normalizeText(group?.semanticQuery ?? group?.relatedDocumentTitle)
      .slice(0, maximumEmbeddingTextLength)
  })).filter((entry) => entry.text);
  const sourceEntries = [...new Map(groups.flatMap((group) => (
    Array.isArray(group?.sources) ? group.sources : []
  )).map((source) => [sourceKey(source), {
    key: sourceKey(source),
    text: embeddingText(source)
  }])).values()].filter((entry) => entry.text);
  const entries = [...queryEntries, ...sourceEntries].slice(0, maximumEmbeddingInputs);
  const embeddedCandidateCount = entries.filter((entry) => !entry.key.startsWith("query:")).length;
  if (queryEntries.length === 0 || embeddedCandidateCount === 0 || entries.length < 2) {
    return { audit: disabledAudit(), sourceGroups: groups };
  }

  try {
    const { dimension, vectors } = await requestEmbeddings(
      entries.map((entry) => entry.text),
      { ...options, baseUrl, apiKey, model }
    );
    const vectorByKey = new Map(entries.map((entry, index) => [entry.key, vectors[index]]));
    const scoredGroups = groups.map((group, groupIndex) => {
      const queryVector = vectorByKey.get(`query:${groupIndex}`);
      return {
        ...group,
        sources: (Array.isArray(group?.sources) ? group.sources : []).map((source) => {
          const sourceVector = vectorByKey.get(sourceKey(source));
          return queryVector && sourceVector
            ? {
                ...source,
                semanticRelevance: cosineSimilarity(queryVector, sourceVector),
                semanticRetrievalVersion: "recommendation-semantic-retrieval/v1"
              }
            : source;
        })
      };
    });
    return {
      audit: {
        candidateCount: embeddedCandidateCount,
        dimension,
        inputCount: entries.length,
        model,
        provider: "openai_compatible",
        status: "completed",
        version: "recommendation-semantic-retrieval/v1"
      },
      sourceGroups: scoredGroups
    };
  } catch (error) {
    return {
      audit: {
        error: error instanceof Error ? error.message : "recommendation_embedding_failed",
        model,
        provider: "openai_compatible",
        status: "failed",
        version: "recommendation-semantic-retrieval/v1"
      },
      sourceGroups: groups
    };
  }
}
