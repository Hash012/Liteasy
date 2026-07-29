import { fetchWithConfiguredProxy } from "./proxyFetch.mjs";

const defaultBaseUrl = "https://api.deepseek.com";

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(5_000, retryAfter * 1_000);
  }
  return response?.status === 429 ? attempt * 1_000 : attempt * 250;
}

function waitBeforeRetry(response, attempt) {
  return new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
}

function extractAssistantContent(payload) {
  const firstChoice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = firstChoice?.message?.content;
  return typeof content === "string" && content.length > 0 ? content : null;
}

function buildChatCompletionRequest(input) {
  return {
    messages: [
      {
        content: input.prompt,
        role: "user"
      }
    ],
    model: input.model,
    ...(input.outputFormat ? { response_format: { type: "json_object" } } : {}),
    stream: false
  };
}

async function readErrorMessage(response) {
  try {
    const payload = await response.json();
    if (typeof payload?.error?.message === "string") {
      return payload.error.message;
    }
  } catch {
    return null;
  }

  return null;
}

export function createDeepSeekChatCompletionsProvider({
  apiBaseUrl = defaultBaseUrl,
  apiKey,
  fetchImpl = fetchWithConfiguredProxy
}) {
  return async (input) => {
    const url = `${apiBaseUrl.replace(/\/+$/, "")}/chat/completions`;
    const request = async (includeOutputFormat) => {
      const init = {
        body: JSON.stringify(buildChatCompletionRequest(
          includeOutputFormat ? input : { ...input, outputFormat: undefined }
        )),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      };
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await fetchImpl(url, init);
          if (!isRetryableStatus(response.status) || attempt === 3) {
            return response;
          }
          await response.body?.cancel?.().catch?.(() => undefined);
          await waitBeforeRetry(response, attempt);
        } catch (error) {
          lastError = error;
          if (attempt === 3) {
            throw error;
          }
          await waitBeforeRetry(undefined, attempt);
        }
      }
      throw lastError ?? new Error("DeepSeek request exhausted retries");
    };
    let response;
    try {
      response = await request(true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`DeepSeek Chat Completions API 连接失败：${detail}`);
    }
    if (input.outputFormat && (response.status === 400 || response.status === 422)) {
      await response.body?.cancel?.().catch?.(() => undefined);
      response = await request(false);
    }

    if (!response.ok) {
      const detail = await readErrorMessage(response);
      throw new Error(
        detail
          ? `DeepSeek Chat Completions API 请求失败（${response.status}）：${detail}`
          : `DeepSeek Chat Completions API 请求失败（${response.status}）`
      );
    }

    const payload = await response.json();
    const outputText = extractAssistantContent(payload);
    if (!outputText) {
      throw new Error("DeepSeek Chat Completions API 返回格式无效：缺少 assistant content");
    }

    return outputText;
  };
}
