import { createOpenAIResponsesProvider } from "../providers/openaiResponses.mjs";
import { generateMockAnswer } from "../providers/mockProvider.mjs";

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
    config.openaiApiKey && config.openaiApiKey.length > 0
      ? createOpenAIResponsesProvider({
          apiBaseUrl: config.openaiApiBaseUrl,
          apiKey: config.openaiApiKey
        })
      : null;

  return {
    mock: generateMockAnswer,
    openai: openaiProvider
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
