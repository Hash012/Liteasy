import { fetchWithConfiguredProxy } from "./proxyFetch.mjs";

const defaultBaseUrl = "https://api.deepseek.com";

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
    const request = (includeOutputFormat) => fetchImpl(url, {
      body: JSON.stringify(buildChatCompletionRequest(
        includeOutputFormat ? input : { ...input, outputFormat: undefined }
      )),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    let response = await request(true);
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
