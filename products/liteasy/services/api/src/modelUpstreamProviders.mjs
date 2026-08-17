const maximumUpstreamBodyBytes = 4 * 1024 * 1024;
const structuredOutputFallbackStatuses = new Set([400, 422, 500, 502]);

export class ModelUpstreamError extends Error {
  constructor(code, status, internalDetail, retryable = false) {
    super(code);
    this.name = "ModelUpstreamError";
    this.code = code;
    this.status = status;
    this.internalDetail = internalDetail;
    this.retryable = retryable;
  }
}

function upstreamUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readChunk(reader, signal) {
  try {
    return await reader.read();
  } catch (error) {
    if (signal?.aborted) {
      throw new ModelUpstreamError("model_request_aborted", 499, "client request aborted");
    }
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new ModelUpstreamError("model_provider_timeout", 504, String(error), true);
    }
    throw new ModelUpstreamError("model_provider_unavailable", 503, String(error), true);
  }
}

async function readBody(response, maximumBytes = maximumUpstreamBodyBytes, signal) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const { done, value } = await readChunk(reader, signal);
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maximumBytes) {
      await reader.cancel().catch(() => {});
      throw new ModelUpstreamError(
        "model_provider_response_invalid",
        502,
        `upstream response exceeded ${maximumBytes} bytes`
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function statusError(response, detail) {
  const status = response.status;
  const diagnostic = `upstream status=${status} errorBodyBytes=${Buffer.byteLength(detail, "utf8")}`;
  let error;
  if (status === 429) {
    error = new ModelUpstreamError("model_provider_rate_limited", 503, diagnostic, true);
  } else if (status === 408 || status === 504) {
    error = new ModelUpstreamError("model_provider_timeout", 504, diagnostic, true);
  } else if (status === 400 || status === 404 || status === 409 || status === 422) {
    error = new ModelUpstreamError("model_provider_rejected", 502, diagnostic);
  } else {
    error = new ModelUpstreamError(
      "model_provider_unavailable",
      503,
      diagnostic,
      new Set([500, 502, 503]).has(status)
    );
  }
  const retryAfter = response.headers?.get?.("retry-after")?.trim();
  if (error.retryable && retryAfter && /^\d+$/.test(retryAfter)) {
    error.retryAfterMs = Math.min(2_000, Number(retryAfter) * 1_000);
  }
  return error;
}

async function fetchUpstream(fetchImpl, url, init, signal, timeoutMs, allowedFailureStatuses) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: requestSignal(signal, timeoutMs)
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new ModelUpstreamError("model_request_aborted", 499, "client request aborted");
    }
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new ModelUpstreamError("model_provider_timeout", 504, String(error), true);
    }
    throw new ModelUpstreamError("model_provider_unavailable", 503, String(error), true);
  }
  if (!response.ok && !allowedFailureStatuses?.has(response.status)) {
    const detail = (await readBody(response, 16 * 1024, signal)).replace(/\s+/g, " ").slice(0, 16 * 1024);
    throw statusError(response, detail);
  }
  return response;
}

function waitForRetry(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(new ModelUpstreamError("model_request_aborted", 499, "client request aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ModelUpstreamError("model_request_aborted", 499, "client request aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function retryTransientFailure(request, { signal, waitImpl = waitForRetry } = {}) {
  const delays = [250, 750];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      if (!(error instanceof ModelUpstreamError) || !error.retryable || attempt >= delays.length) {
        throw error;
      }
      await waitImpl(error.retryAfterMs ?? delays[attempt], signal);
    }
  }
}

async function fetchOpenAiResponse(fetchImpl, url, input, model, stream, timeoutMs) {
  const request = (includeOutputFormat, allowedFailureStatuses) => fetchUpstream(fetchImpl, url, {
    body: JSON.stringify(openAiBody(
      includeOutputFormat ? input : {
        ...input,
        outputFormat: undefined,
        prompt: input.outputFormat ? [
          input.prompt,
          "Return exactly one JSON object and no Markdown or code fences.",
          `The JSON object must conform to schema ${input.outputFormat.name}:`,
          JSON.stringify(input.outputFormat.schema)
        ].join("\n") : input.prompt
      },
      model,
      stream
    )),
    headers: providerHeaders(input.apiKey),
    method: "POST"
  }, input.signal, timeoutMs, allowedFailureStatuses);

  let response = await request(Boolean(input.outputFormat), input.outputFormat
    ? structuredOutputFallbackStatuses
    : undefined);
  if (input.outputFormat && structuredOutputFallbackStatuses.has(response.status)) {
    await response.body?.cancel?.().catch(() => {});
    response = await request(false);
  }
  return response;
}

async function jsonPayload(response, signal) {
  const text = await readBody(response, maximumUpstreamBodyBytes, signal);
  try {
    return JSON.parse(text);
  } catch {
    throw new ModelUpstreamError(
      "model_provider_response_invalid",
      502,
      "upstream returned invalid JSON"
    );
  }
}

function outputTextFromOpenAi(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.length > 0) {
    return payload.output_text;
  }
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && typeof content.text === "string" && content.text.length > 0) {
        return content.text;
      }
    }
  }
  return null;
}

function outputTextFromDeepSeek(payload) {
  const content = Array.isArray(payload?.choices) ? payload.choices[0]?.message?.content : undefined;
  return typeof content === "string" && content.length > 0 ? content : null;
}

function openAiBody(input, model, stream) {
  return {
    input: input.prompt,
    model,
    ...(input.outputFormat ? {
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

function deepSeekBody(input, model, stream) {
  const prompt = input.outputFormat ? [
    input.prompt,
    "Return exactly one JSON object and no Markdown or code fences.",
    `The JSON object must conform to schema ${input.outputFormat.name}:`,
    JSON.stringify(input.outputFormat.schema)
  ].join("\n") : input.prompt;
  return {
    messages: [{ content: prompt, role: "user" }],
    model,
    ...(input.outputFormat ? { response_format: { type: "json_object" } } : {}),
    stream
  };
}

async function* ssePayloads(response, signal) {
  if (!response.body) {
    throw new ModelUpstreamError("model_provider_response_invalid", 502, "upstream stream has no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let byteLength = 0;

  while (true) {
    const { done, value } = await readChunk(reader, signal);
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maximumUpstreamBodyBytes) {
      await reader.cancel().catch(() => {});
      throw new ModelUpstreamError(
        "model_provider_response_invalid",
        502,
        `upstream stream exceeded ${maximumUpstreamBodyBytes} bytes`
      );
    }
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const boundary = buffer.match(/\r?\n\r?\n/);
      if (!boundary || boundary.index === undefined) break;
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const data = frame.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        throw new ModelUpstreamError("model_provider_response_invalid", 502, "invalid SSE JSON");
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const data = buffer.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data && data !== "[DONE]") {
      try {
        yield JSON.parse(data);
      } catch {
        throw new ModelUpstreamError("model_provider_response_invalid", 502, "invalid final SSE JSON");
      }
    }
  }
}

function providerHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function createOpenAiProvider(config, options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const waitImpl = options.waitImpl;
  const timeoutMs = options.timeoutMs;
  return Object.freeze({
    model: config.model,
    async generate(input) {
      return retryTransientFailure(async () => {
        const response = await fetchOpenAiResponse(
          fetchImpl,
          upstreamUrl(config.baseUrl, "responses"),
          { ...input, apiKey: config.apiKey },
          config.model,
          false,
          timeoutMs
        );
        const answer = outputTextFromOpenAi(await jsonPayload(response, input.signal));
        if (!answer) {
          throw new ModelUpstreamError("model_provider_response_invalid", 502, "OpenAI response has no output text");
        }
        return answer;
      }, { signal: input.signal, waitImpl });
    },
    async *stream(input) {
      const response = await retryTransientFailure(() => fetchOpenAiResponse(
        fetchImpl,
        upstreamUrl(config.baseUrl, "responses"),
        { ...input, apiKey: config.apiKey },
        config.model,
        true,
        timeoutMs
      ), { signal: input.signal, waitImpl });
      for await (const payload of ssePayloads(response, input.signal)) {
        if (payload?.type === "response.output_text.delta" && typeof payload.delta === "string") {
          yield payload.delta;
        }
      }
    }
  });
}

function createDeepSeekProvider(config, options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const waitImpl = options.waitImpl;
  const timeoutMs = options.timeoutMs;
  return Object.freeze({
    model: config.model,
    async generate(input) {
      return retryTransientFailure(async () => {
        const response = await fetchUpstream(fetchImpl, upstreamUrl(config.baseUrl, "chat/completions"), {
          body: JSON.stringify(deepSeekBody(input, config.model, false)),
          headers: providerHeaders(config.apiKey),
          method: "POST"
        }, input.signal, timeoutMs);
        const answer = outputTextFromDeepSeek(await jsonPayload(response, input.signal));
        if (!answer) {
          throw new ModelUpstreamError("model_provider_response_invalid", 502, "DeepSeek response has no assistant content");
        }
        return answer;
      }, { signal: input.signal, waitImpl });
    },
    async *stream(input) {
      const response = await retryTransientFailure(() => fetchUpstream(fetchImpl, upstreamUrl(config.baseUrl, "chat/completions"), {
        body: JSON.stringify(deepSeekBody(input, config.model, true)),
        headers: providerHeaders(config.apiKey),
        method: "POST"
      }, input.signal, timeoutMs), { signal: input.signal, waitImpl });
      for await (const payload of ssePayloads(response, input.signal)) {
        const delta = Array.isArray(payload?.choices) ? payload.choices[0]?.delta?.content : undefined;
        if (typeof delta === "string" && delta.length > 0) yield delta;
      }
    }
  });
}

export function createModelUpstreamProviders(config = {}, options = {}) {
  const timeoutMs = config.timeoutMs ?? 300_000;
  const providers = {};
  if (config.providers?.openai) {
    providers.openai = createOpenAiProvider(config.providers.openai, { ...options, timeoutMs });
  }
  if (config.providers?.deepseek) {
    providers.deepseek = createDeepSeekProvider(config.providers.deepseek, { ...options, timeoutMs });
  }
  return Object.freeze(providers);
}
