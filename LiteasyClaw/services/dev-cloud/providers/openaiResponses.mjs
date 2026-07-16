import { fetchWithConfiguredProxy } from "./proxyFetch.mjs";

const defaultBaseUrl = "https://api.openai.com/v1";

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
    const response = await fetchImpl(`${apiBaseUrl.replace(/\/+$/, "")}/responses`, {
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

    if (!response.ok) {
      const detail = await readErrorMessage(response);
      throw new Error(
        detail
          ? `OpenAI Responses API 请求失败（${response.status}）：${detail}`
          : `OpenAI Responses API 请求失败（${response.status}）`
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
