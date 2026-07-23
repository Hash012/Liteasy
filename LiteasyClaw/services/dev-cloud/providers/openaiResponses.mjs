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
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
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
  fetchImpl = fetchWithConfiguredProxy
}) {
  return async (input) => {
    let response;
    try {
      response = await fetchWithTransientRetry(fetchImpl, buildResponsesUrl(apiBaseUrl), {
        body: JSON.stringify({
          input: input.prompt,
          model: input.model
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      });
    } catch (error) {
      throw new Error(
        `OpenAI Responses API 连接失败（endpoint=${describeEndpoint(apiBaseUrl)}）：${describeNetworkError(error)}`
      );
    }

    if (!response.ok) {
      const detail = await readErrorMessage(response);
      throw new Error(
        detail
          ? `OpenAI Responses API 请求失败（${response.status}，endpoint=${describeEndpoint(apiBaseUrl)}）：${detail}`
          : `OpenAI Responses API 请求失败（${response.status}，endpoint=${describeEndpoint(apiBaseUrl)}）`
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
  fetchImpl = fetchWithConfiguredProxy
}) {
  return async function* streamOpenAIResponse(input) {
    const maximumStreamAttempts = 2;
    for (let streamAttempt = 1; streamAttempt <= maximumStreamAttempts; streamAttempt += 1) {
      let response;
      try {
        response = await fetchWithTransientRetry(fetchImpl, buildResponsesUrl(apiBaseUrl), {
          body: JSON.stringify({
            input: input.prompt,
            model: input.model,
            stream: true
          }),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          method: "POST"
        });
      } catch (error) {
        throw new Error(
          `OpenAI Responses API 流式连接失败（endpoint=${describeEndpoint(apiBaseUrl)}）：${describeNetworkError(error)}`
        );
      }

      if (!response.ok) {
        const detail = await readErrorMessage(response);
        throw new Error(
          detail
            ? `OpenAI Responses API 流式请求失败（${response.status}，endpoint=${describeEndpoint(apiBaseUrl)}）：${detail}`
            : `OpenAI Responses API 流式请求失败（${response.status}，endpoint=${describeEndpoint(apiBaseUrl)}）`
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
