import { fetchWithConfiguredProxy } from "./proxyFetch.mjs";

const defaultBaseUrl = "https://api.openai.com/v1";

function buildResponsesUrl(apiBaseUrl) {
  return `${apiBaseUrl.replace(/\/+$/, "")}/responses`;
}

function describeEndpoint(apiBaseUrl) {
  try {
    const url = new URL(apiBaseUrl);
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return "invalid OPENAI_BASE_URL";
  }
}

function describeNetworkError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const causeCode = error?.cause && typeof error.cause.code === "string"
    ? error.cause.code
    : "";
  return causeCode ? `${message} (${causeCode})` : message;
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 ||
    status === 503 || status === 504 || status === 520 || status === 522 || status === 524;
}

const retryableNetworkCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET_TIMEOUT"
]);

function getErrorCode(error) {
  if (!error || typeof error !== "object") {
    return "";
  }
  if (typeof error.code === "string") {
    return error.code;
  }
  return getErrorCode(error.cause);
}

/**
 * Kept public so the model policy can switch models only after a failure that
 * is safe to retry. Authentication, invalid model names and malformed requests
 * must remain visible to the caller instead of being hidden by failover.
 */
export function isRetryableOpenAIResponsesError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }
  if (error.retryable === true || isRetryableStatus(error.status)) {
    return true;
  }
  if (error.name === "AbortError" || retryableNetworkCodes.has(getErrorCode(error))) {
    return true;
  }
  return isRetryableOpenAIResponsesError(error.cause);
}

function createResponsesError(message, { cause, status } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  if (typeof status === "number") {
    error.status = status;
    error.retryable = isRetryableStatus(status);
  } else if (isRetryableOpenAIResponsesError(cause)) {
    error.retryable = true;
  }
  return error;
}

function getRetryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get?.("retry-after");
  const retryAfterSeconds = Number(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(5_000, retryAfterSeconds * 1_000);
  }
  return response?.status === 429 ? attempt * 1_000 : attempt * 250;
}

function waitBeforeRetry(attempt, response) {
  return new Promise((resolve) => setTimeout(resolve, getRetryDelayMs(response, attempt)));
}

async function fetchWithTransientRetry(fetchImpl, url, init) {
  const maximumAttempts = 3;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    let retryResponse;
    try {
      const response = await fetchImpl(url, init);
      if (!isRetryableStatus(response.status) || attempt === maximumAttempts) {
        return response;
      }
      retryResponse = response;
      await response.body?.cancel?.().catch?.(() => undefined);
    } catch (error) {
      if (attempt === maximumAttempts) {
        throw error;
      }
    }
    await waitBeforeRetry(attempt, retryResponse);
  }
  throw new Error("OpenAI request exhausted retries");
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.length > 0) {
    return payload.output_text;
  }

  if (!Array.isArray(payload?.output)) {
    return null;
  }

  for (const item of payload.output) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (contentItem?.type === "output_text" && typeof contentItem.text === "string") {
        return contentItem.text;
      }
    }
  }

  return null;
}

function buildResponseRequest(input, stream = false, options = {}) {
  const includeOutputFormat = options.includeOutputFormat ?? true;
  const includeReasoning = options.includeReasoning ?? true;
  return {
    input: input.input ?? input.prompt,
    model: input.model,
    ...(includeReasoning && input.reasoningEffort ? {
      reasoning: { effort: input.reasoningEffort }
    } : {}),
    ...(includeOutputFormat && input.outputFormat ? {
      text: {
        format: {
          name: input.outputFormat.name,
          schema: input.outputFormat.schema,
          strict: input.outputFormat.strict,
          type: "json_schema"
        }
      }
    } : {}),
    ...(stream ? { stream: true } : {})
  };
}

function shouldRetryWithoutResponsesExtensions(response) {
  // Some OpenAI-compatible gateways surface unsupported Responses fields as a
  // generic upstream 502 rather than a descriptive 4xx. Once the bounded
  // transient retry has been exhausted, retry without only the optional fields.
  return response.status === 400 || response.status === 422 ||
    response.status === 500 || response.status === 502;
}

async function requestResponseWithStructuredOutputFallback(input, fetchImpl, stream = false) {
  const request = (options) => fetchWithTransientRetry(
    fetchImpl,
    buildResponsesUrl(input.apiBaseUrl),
    {
      body: JSON.stringify(buildResponseRequest(input, stream, options)),
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    }
  );

  let response = await request();
  // Compatible endpoints sometimes expose a model but not the current Responses
  // extensions. Preserve the user-selected reasoning effort where supported, then
  // degrade one field at a time while keeping the caller's JSON validation mandatory.
  if (shouldRetryWithoutResponsesExtensions(response)) {
    const needsReasoningFallback = Boolean(input.reasoningEffort);
    const needsSchemaFallback = Boolean(input.outputFormat);
    if (needsReasoningFallback) {
      await response.body?.cancel?.().catch?.(() => undefined);
      response = await request({
        includeOutputFormat: needsSchemaFallback,
        includeReasoning: false
      });
    }
    // A compatible proxy may reject the Responses JSON-schema field entirely. The
    // caller's Zod parser and trace gate remain mandatory for prompted JSON fallback.
    if (needsSchemaFallback && shouldRetryWithoutResponsesExtensions(response)) {
      await response.body?.cancel?.().catch?.(() => undefined);
      response = await request({ includeOutputFormat: false, includeReasoning: false });
    }
  }
  return response;
}

async function readErrorMessage(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.error?.message === "string") {
      return payload.error.message;
    }
    if (typeof payload?.error === "string") {
      return payload.error;
    }
    if (typeof payload?.message === "string") {
      return payload.message;
    }
    if (typeof payload?.detail === "string") {
      return payload.detail;
    }
  } catch {
    return null;
  }

  return null;
}

export function createOpenAIResponsesProvider({
  apiBaseUrl = defaultBaseUrl,
  apiKey,
  fetchImpl = fetchWithConfiguredProxy,
  reasoningEffort
}) {
  return async (input) => {
    let response;
    try {
      response = await requestResponseWithStructuredOutputFallback(
        { ...input, apiBaseUrl, apiKey, reasoningEffort: input.reasoningEffort ?? reasoningEffort },
        fetchImpl
      );
    } catch (error) {
      throw createResponsesError(
        `OpenAI Responses API 连接失败（endpoint=${describeEndpoint(apiBaseUrl)}）：${describeNetworkError(error)}`,
        { cause: error }
      );
    }

    if (!response.ok) {
      const detail = await readErrorMessage(response);
      throw createResponsesError(
        detail
          ? `OpenAI Responses API 请求失败（${response.status}，endpoint=${describeEndpoint(apiBaseUrl)}）：${detail}`
          : `OpenAI Responses API 请求失败（${response.status}，endpoint=${describeEndpoint(apiBaseUrl)}）`,
        { status: response.status }
      );
    }

    const payload = await response.json();
    const outputText = extractOutputText(payload);
    if (!outputText) {
      throw new Error("OpenAI Responses API 返回格式无效：缺少输出文本");
    }

    return outputText;
  };
}

export function createOpenAIResponsesStreamProvider({
  apiBaseUrl = defaultBaseUrl,
  apiKey,
  fetchImpl = fetchWithConfiguredProxy,
  reasoningEffort
}) {
  return async function* streamOpenAIResponse(input) {
    const maximumStreamAttempts = 2;
    for (let streamAttempt = 1; streamAttempt <= maximumStreamAttempts; streamAttempt += 1) {
      let response;
      try {
        response = await requestResponseWithStructuredOutputFallback(
          { ...input, apiBaseUrl, apiKey, reasoningEffort: input.reasoningEffort ?? reasoningEffort },
          fetchImpl,
          true
        );
      } catch (error) {
        throw createResponsesError(
          `OpenAI Responses API 流式连接失败（endpoint=${describeEndpoint(apiBaseUrl)}）：${describeNetworkError(error)}`,
          { cause: error }
        );
      }

      if (!response.ok) {
        const detail = await readErrorMessage(response);
        throw createResponsesError(
          detail
            ? `OpenAI Responses API 流式请求失败（${response.status}，endpoint=${describeEndpoint(apiBaseUrl)}）：${detail}`
            : `OpenAI Responses API 流式请求失败（${response.status}，endpoint=${describeEndpoint(apiBaseUrl)}）`,
          { status: response.status }
        );
      }
      if (!response.body) {
        throw new Error("OpenAI Responses API 流式响应缺少 body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let emittedText = "";
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) {
              continue;
            }
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") {
              continue;
            }
            let payload;
            try {
              payload = JSON.parse(data);
            } catch {
              continue;
            }
            let text = "";
            if (
              payload?.type === "response.output_text.delta" &&
              typeof payload.delta === "string"
            ) {
              text = payload.delta;
            } else if (
              payload?.type === "response.output_text.done" &&
              typeof payload.text === "string"
            ) {
              text = emittedText.length === 0
                ? payload.text
                : payload.text.startsWith(emittedText)
                  ? payload.text.slice(emittedText.length)
                  : "";
            } else if (payload?.type === "response.completed") {
              const completedText = extractOutputText(payload.response);
              text = completedText && emittedText.length === 0 ? completedText : "";
            }
            if (text.length > 0) {
              emittedText += text;
              yield text;
            }
          }
        }
      }
      if (emittedText.length > 0) {
        return;
      }
      if (streamAttempt < maximumStreamAttempts) {
        await waitBeforeRetry(streamAttempt);
      }
    }
    throw new Error(
      `OpenAI Responses API 流式返回空输出（endpoint=${describeEndpoint(apiBaseUrl)}，model=${input.model}，已重试 1 次）`
    );
  };
}
