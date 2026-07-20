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

export function createOpenAIResponsesStreamProvider({
  apiBaseUrl = defaultBaseUrl,
  apiKey,
  fetchImpl = fetchWithConfiguredProxy
}) {
  return async function* streamOpenAIResponse(input) {
    const response = await fetchImpl(`${apiBaseUrl.replace(/\/+$/, "")}/responses`, {
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

    if (!response.ok) {
      const detail = await readErrorMessage(response);
      throw new Error(
        detail
          ? `OpenAI Responses API 流式请求失败（${response.status}）：${detail}`
          : `OpenAI Responses API 流式请求失败（${response.status}）`
      );
    }
    if (!response.body) {
      throw new Error("OpenAI Responses API 流式响应缺少 body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
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
          if (
            payload?.type === "response.output_text.delta" &&
            typeof payload.delta === "string" &&
            payload.delta.length > 0
          ) {
            yield payload.delta;
          }
        }
      }
    }
  };
}
