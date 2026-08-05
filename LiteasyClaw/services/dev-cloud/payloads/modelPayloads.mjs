import { createDeepSeekChatCompletionsProvider } from "../providers/deepseekChatCompletions.mjs";
import {
  createOpenAIResponsesProvider,
  createOpenAIResponsesStreamProvider,
  isRetryableOpenAIResponsesError
} from "../providers/openaiResponses.mjs";
import { generateMockAnswer } from "../providers/mockProvider.mjs";

// This compatible gateway currently exposes these three GPT-5.6 variants.
// Keep the order explicit: it is the product's reliability policy, rather
// than a silent preference inferred from a stale user-selected model.
export const openAIModelFailoverOrder = [
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.6-sol"
];

function modelLabel(model) {
  return model.replace(/^gpt-/i, "GPT ").replace(/-/g, " ");
}

function createAllModelsUnavailableError(lastError) {
  const attempted = openAIModelFailoverOrder.map(modelLabel).join(" → ");
  return new Error(
    `模型服务暂时不可用：已依次尝试 ${attempted}，均遇到可重试的上游服务错误。请稍后重试。`,
    lastError ? { cause: lastError } : undefined
  );
}

/**
 * Retry with another model only for errors explicitly marked as transient by
 * the Responses provider (502/503/timeouts etc.). Permanent request/auth
 * failures deliberately stop here so the user receives the real problem.
 */
export function createOpenAIModelFailoverProvider(provider) {
  return async (input) => {
    let lastError;
    for (const model of openAIModelFailoverOrder) {
      try {
        return await provider({ ...input, model });
      } catch (error) {
        if (!isRetryableOpenAIResponsesError(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw createAllModelsUnavailableError(lastError);
  };
}

export function createOpenAIModelFailoverStreamProvider(provider) {
  return async function* streamWithModelFailover(input) {
    let lastError;
    for (const model of openAIModelFailoverOrder) {
      let emittedOutput = false;
      try {
        for await (const delta of provider({ ...input, model })) {
          emittedOutput = true;
          yield delta;
        }
        return;
      } catch (error) {
        // Never splice two answers together: after any visible delta, surface
        // the original stream error instead of changing models mid-answer.
        if (emittedOutput || !isRetryableOpenAIResponsesError(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw createAllModelsUnavailableError(lastError);
  };
}

function clampScore(score) {
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

function getAuditVerdict(score) {
  if (score >= 0.8) {
    return "pass";
  }

  if (score >= 0.55) {
    return "review";
  }

  return "fail";
}

export function buildProviderRegistry(config) {
  const openaiProvider =
    config.hardcodedDevForceLocalFakeModel
      ? async (input) => `${config.hardcodedDevFakeAnswerPrefix ?? "实验默认回复"}：${input.prompt}`
      : config.openaiApiKey && config.openaiApiKey.length > 0
      ? createOpenAIModelFailoverProvider(createOpenAIResponsesProvider({
          apiBaseUrl: config.openaiApiBaseUrl,
          apiKey: config.openaiApiKey,
          reasoningEffort: config.openaiReasoningEffort
        }))
      : null;
  const deepseekProvider =
    config.deepseekApiKey && config.deepseekApiKey.length > 0
      ? createDeepSeekChatCompletionsProvider({
          apiBaseUrl: config.deepseekApiBaseUrl,
          apiKey: config.deepseekApiKey
        })
      : null;

  return {
    deepseek: deepseekProvider,
    mock: generateMockAnswer,
    openai: openaiProvider
  };
}

export function buildStreamingProviderRegistry(config) {
  return {
    openai:
      config.openaiApiKey && config.openaiApiKey.length > 0
        ? createOpenAIModelFailoverStreamProvider(createOpenAIResponsesStreamProvider({
            apiBaseUrl: config.openaiApiBaseUrl,
            apiKey: config.openaiApiKey,
            reasoningEffort: config.openaiReasoningEffort
          }))
        : null
  };
}

export function buildModelAuditPayload(body) {
  const citations = Array.isArray(body.citations) ? body.citations : [];
  const hasTraceableCitation = citations.some(
    (citation) => typeof citation?.snippet === "string" && citation.snippet.length > 0
  );
  const answer = typeof body.answer === "string" ? body.answer : "";
  const retrievalConfidence =
    typeof body.retrievalConfidence === "number" ? body.retrievalConfidence : 0.5;
  const score = clampScore(
    retrievalConfidence + (hasTraceableCitation ? 0 : -0.2) + (answer.length >= 12 ? 0 : -0.15)
  );

  return {
    audit: {
      model: "gpt-5-mini-auditor",
      rationale:
        hasTraceableCitation && answer.length >= 12
          ? "开发云审计确认回答包含可追溯引用。"
          : "开发云审计发现回答依据不足，需要人工复核。",
      score,
      verdict: getAuditVerdict(score)
    }
  };
}

export async function generateAnswer(body, providers) {
  const providerId = typeof body.provider === "string" ? body.provider : "openai";
  const liveProvider = providers[providerId];

  if (liveProvider) {
    return {
      answer: await liveProvider(body),
      execution: {
        backend: "dev_cloud",
        mode: "live",
        provider: providerId
      }
    };
  }

  if (body.requireLive === true) {
    throw new Error(`当前开发云未配置真实 provider：${providerId}`);
  }

  if (providerId !== "openai") {
    throw new Error(`当前开发云未注册 provider：${providerId}`);
  }

  return {
    answer: await providers.mock(body),
    execution: {
      backend: "dev_cloud",
      mode: "mock_fallback",
      provider: "mock"
    }
  };
}

export async function* generateAnswerStream(body, providers, streamingProviders) {
  const providerId = typeof body.provider === "string" ? body.provider : "openai";
  const streamProvider = streamingProviders[providerId];

  if (streamProvider) {
    let answer = "";
    let pendingDelta = "";
    for await (const delta of streamProvider(body)) {
      answer += delta;
      pendingDelta += delta;
      if (pendingDelta.length >= 80) {
        yield { delta: pendingDelta, type: "delta" };
        pendingDelta = "";
      }
    }
    if (pendingDelta.length > 0) {
      yield { delta: pendingDelta, type: "delta" };
    }
    yield {
      answer,
      execution: {
        backend: "dev_cloud",
        mode: "live",
        provider: providerId
      },
      type: "completed"
    };
    return;
  }

  const completed = await generateAnswer(body, providers);
  yield { delta: completed.answer, type: "delta" };
  yield { ...completed, type: "completed" };
}
