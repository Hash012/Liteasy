const maximumRerankerCandidates = 8;
const maximumRerankerDocumentLength = 2600;
const maximumRerankerQueryLength = 1000;
const maximumRerankerResponseBytes = 1024 * 1024;
const externalRerankerWeight = 0.65;

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function buildRerankerUrl(baseUrl) {
  const url = new URL(baseUrl);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("recommendation_reranker_endpoint_invalid");
  }
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  url.pathname = normalizedPath.endsWith("/rerank")
    ? normalizedPath
    : `${normalizedPath}/rerank`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function candidateDocument(candidate) {
  return normalizeText([
    candidate?.title,
    candidate?.abstract,
    Array.isArray(candidate?.authors) ? candidate.authors.slice(0, 6).join(", ") : ""
  ].filter(Boolean).join("\n")).slice(0, maximumRerankerDocumentLength);
}

async function defaultRerankerTransport(url, options) {
  return fetch(url, options);
}

function disabledAudit() {
  return {
    status: "disabled",
    version: "recommendation-external-reranker/v1"
  };
}

async function requestReranking(query, documents, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  let response;
  try {
    response = await (options.transport ?? defaultRerankerTransport)(
      buildRerankerUrl(options.baseUrl),
      {
        body: JSON.stringify({
          documents,
          model: options.model,
          query,
          return_documents: false,
          top_n: documents.length
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
      throw new Error("recommendation_reranker_timeout");
    }
    throw new Error("recommendation_reranker_unavailable");
  } finally {
    clearTimeout(timeout);
  }
  if (!response?.ok) {
    throw new Error(`recommendation_reranker_http_${response?.status ?? "unknown"}`);
  }
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumRerankerResponseBytes) {
    throw new Error("recommendation_reranker_response_too_large");
  }
  let payload;
  try {
    if (typeof response.text === "function") {
      const text = await response.text();
      if (text.length > maximumRerankerResponseBytes) {
        throw new Error("recommendation_reranker_response_too_large");
      }
      payload = JSON.parse(text);
    } else {
      payload = await response.json();
    }
  } catch (error) {
    if (error?.message === "recommendation_reranker_response_too_large") throw error;
    throw new Error("recommendation_reranker_response_invalid");
  }
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const indexes = results.map((result) => result?.index);
  if (results.length !== documents.length ||
    indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= documents.length) ||
    new Set(indexes).size !== results.length ||
    results.some((result) => (
      typeof result?.relevance_score !== "number" ||
      !Number.isFinite(result.relevance_score) ||
      result.relevance_score < 0 ||
      result.relevance_score > 1
    ))) {
    throw new Error("recommendation_reranker_results_invalid");
  }
  return results;
}

export async function applyRecommendationExternalReranker(candidates, options = {}) {
  const items = Array.isArray(candidates) ? candidates : [];
  const baseUrl = normalizeText(options.baseUrl);
  const apiKey = typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  const model = normalizeText(options.model);
  if (!baseUrl || !apiKey || !model || items.length < 2) {
    return { audit: disabledAudit(), recommendations: items };
  }
  if (baseUrl.length > 2048 || apiKey.length > 4096 || /\s/.test(apiKey) || model.length > 200) {
    return {
      audit: {
        error: "recommendation_reranker_config_invalid",
        status: "failed",
        version: "recommendation-external-reranker/v1"
      },
      recommendations: items
    };
  }
  const selected = items.slice(0, maximumRerankerCandidates);
  const query = normalizeText(options.query).slice(0, maximumRerankerQueryLength);
  const documents = selected.map(candidateDocument);
  if (!query || documents.some((document) => !document)) {
    return { audit: disabledAudit(), recommendations: items };
  }

  try {
    const results = await requestReranking(query, documents, {
      ...options,
      apiKey,
      baseUrl,
      model
    });
    const resultByIndex = new Map(results.map((result) => [result.index, result]));
    const reranked = selected.map((candidate, index) => {
      const relevanceScore = Number(resultByIndex.get(index).relevance_score.toFixed(3));
      const originalScore = Math.max(0, Math.min(1, Number(candidate.relevanceScore) || 0));
      const finalScore = Number((
        originalScore * (1 - externalRerankerWeight) + relevanceScore * externalRerankerWeight
      ).toFixed(3));
      return {
        ...candidate,
        externalReranker: {
          finalScore,
          originalScore,
          rank: 0,
          relevanceScore,
          version: "recommendation-external-reranker/v1",
          weight: externalRerankerWeight
        },
        reason: `${candidate.reason} 外部 reranker ${model} 给出相关度 ${relevanceScore.toFixed(3)}，以 ${externalRerankerWeight.toFixed(2)} 权重完成二阶段精排。`,
        relevanceBand: finalScore >= 0.75 ? "high" : finalScore >= 0.45 ? "medium" : "low",
        relevanceScore: finalScore,
        scoreComponents: {
          ...candidate.scoreComponents,
          externalRerankerRelevance: relevanceScore,
          finalScore,
          preRerankerScore: originalScore
        }
      };
    }).sort((left, right) => (
      right.relevanceScore - left.relevanceScore ||
      right.externalReranker.relevanceScore - left.externalReranker.relevanceScore ||
      left.title.localeCompare(right.title)
    )).map((candidate, index) => ({
      ...candidate,
      externalReranker: { ...candidate.externalReranker, rank: index + 1 }
    }));
    return {
      audit: {
        candidateCount: selected.length,
        model,
        provider: "rerank_api",
        queryLength: query.length,
        status: "completed",
        version: "recommendation-external-reranker/v1",
        weight: externalRerankerWeight
      },
      recommendations: [...reranked, ...items.slice(maximumRerankerCandidates)]
    };
  } catch (error) {
    return {
      audit: {
        error: error instanceof Error ? error.message : "recommendation_reranker_failed",
        model,
        provider: "rerank_api",
        status: "failed",
        version: "recommendation-external-reranker/v1"
      },
      recommendations: items
    };
  }
}
