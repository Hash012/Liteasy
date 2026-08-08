import { fetchWithConfiguredProxy } from "./proxyFetch.mjs";

const defaultBaseUrl = "https://api.deepseek.com";
const maximumPrimaryPromptChars = 240_000;
const maximumRecoveryPromptChars = 80_000;

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

function sanitizePrompt(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
}

export function compactDeepSeekPrompt(value, maximumChars) {
  const prompt = sanitizePrompt(value);
  if (prompt.length <= maximumChars) return prompt;
  const marker = "\n\n[Liteasy: middle evidence omitted to fit the model request]\n\n";
  const available = Math.max(2, maximumChars - marker.length);
  const headLength = Math.ceil(available * 0.58);
  const tailLength = Math.max(1, available - headLength);
  return `${prompt.slice(0, headLength)}${marker}${prompt.slice(-tailLength)}`;
}

function extractAssistantContent(payload) {
  const firstChoice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = firstChoice?.message?.content;
  return typeof content === "string" && content.length > 0 ? content : null;
}

function describeMissingAssistantContent(payload) {
  const firstChoice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  if (!firstChoice) return "choices \u4e3a\u7a7a";
  const details = [];
  if (typeof firstChoice.finish_reason === "string") {
    details.push(`finish_reason=${firstChoice.finish_reason}`);
  }
  if (typeof firstChoice.message?.reasoning_content === "string") {
    details.push("reasoning_content=present");
  }
  if (Array.isArray(firstChoice.message?.tool_calls) && firstChoice.message.tool_calls.length > 0) {
    details.push("tool_calls=present");
  }
  return details.length > 0 ? details.join(", ") : "choice.message.content \u4e3a\u7a7a";
}

function buildChatCompletionRequest(input) {
  return {
    messages: [{ content: input.prompt, role: "user" }],
    model: input.model,
    ...(input.outputFormat ? { response_format: { type: "json_object" } } : {}),
    // V4 defaults to thinking mode. Thin reading needs the final JSON/text answer.
    ...(input.model.startsWith("deepseek-v4-") ? { thinking: { type: "disabled" } } : {}),
    stream: false
  };
}

function errorFromPayload(payload) {
  if (typeof payload?.error?.message === "string") return payload.error.message;
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.message === "string") return payload.message;
  if (typeof payload?.detail === "string") return payload.detail;
  return null;
}

async function readErrorMessage(response) {
  if (typeof response?.clone === "function") {
    try {
      const raw = (await response.clone().text()).replace(/\s+/g, " ").trim();
      if (raw) {
        try {
          return errorFromPayload(JSON.parse(raw)) ?? raw.slice(0, 500);
        } catch {
          // A local proxy can return an HTML or plain-text error response.
          return raw.slice(0, 500);
        }
      }
    } catch {
      // Fall through for fetch mocks without a complete clone/text implementation.
    }
  }
  try {
    return errorFromPayload(await response.json());
  } catch {
    return null;
  }
}

export function createDeepSeekChatCompletionsProvider({
  apiBaseUrl = defaultBaseUrl,
  apiKey,
  fetchImpl = fetchWithConfiguredProxy
}) {
  return async (input) => {
    const url = `${apiBaseUrl.replace(/\/+$/, "")}/chat/completions`;
    const originalPromptLength = typeof input.prompt === "string" ? input.prompt.length : 0;
    const primaryInput = {
      ...input,
      prompt: compactDeepSeekPrompt(input.prompt, maximumPrimaryPromptChars)
    };
    const request = async (requestInput, includeOutputFormat) => {
      const init = {
        body: JSON.stringify(buildChatCompletionRequest(
          includeOutputFormat ? requestInput : { ...requestInput, outputFormat: undefined }
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
          if (attempt === 3) throw error;
          await waitBeforeRetry(undefined, attempt);
        }
      }
      throw lastError ?? new Error("DeepSeek request exhausted retries");
    };

    const requestCompletion = async () => {
      let response;
      let requestInput = primaryInput;
      try {
        response = await request(requestInput, true);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`DeepSeek Chat Completions API \u8fde\u63a5\u5931\u8d25\uff1a${detail}`);
      }
      if (input.outputFormat && (response.status === 400 || response.status === 422)) {
        await response.body?.cancel?.().catch?.(() => undefined);
        response = await request(requestInput, false);
      }
      if (
        [400, 413, 422].includes(response.status) &&
        requestInput.prompt.length > maximumRecoveryPromptChars
      ) {
        await response.body?.cancel?.().catch?.(() => undefined);
        requestInput = {
          ...requestInput,
          outputFormat: undefined,
          prompt: compactDeepSeekPrompt(requestInput.prompt, maximumRecoveryPromptChars)
        };
        response = await request(requestInput, false);
      }
      if (!response.ok) {
        const detail = await readErrorMessage(response);
        const metadata = [
          `model=${input.model}`,
          `promptChars=${requestInput.prompt.length}`,
          `originalPromptChars=${originalPromptLength}`,
          `jsonMode=${Boolean(input.outputFormat)}`
        ].join(", ");
        throw new Error(
          detail
            ? `DeepSeek Chat Completions API \u8bf7\u6c42\u5931\u8d25\uff08${response.status}\uff09\uff1a${detail} [${metadata}]`
            : `DeepSeek Chat Completions API \u8bf7\u6c42\u5931\u8d25\uff08${response.status}\uff09[${metadata}]`
        );
      }
      return response.json();
    };

    let payload = await requestCompletion();
    let outputText = extractAssistantContent(payload);
    if (!outputText) {
      await waitBeforeRetry(undefined, 1);
      payload = await requestCompletion();
      outputText = extractAssistantContent(payload);
    }
    if (!outputText) {
      throw new Error(
        `DeepSeek Chat Completions API \u8fd4\u56de\u4e3a\u7a7a\uff1a${describeMissingAssistantContent(payload)}`
      );
    }
    return outputText;
  };
}
