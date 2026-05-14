import http from "node:http";
import { fileURLToPath } from "node:url";
import { generateMockAnswer } from "./providers/mockProvider.mjs";
import { createOpenAIResponsesProvider } from "./providers/openaiResponses.mjs";

const defaultConfig = {
  defaultProvider: "openai",
  localDirectEnabled: false,
  localDirectEndpoint: "http://127.0.0.1:8788",
  modelAccessMode: "cloud_proxy",
  openaiApiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiApiKey: process.env.OPENAI_API_KEY,
  policyVersion: "dev-policy-v1",
  syncedAt: "2026-05-14T09:30:00Z"
};

function buildOrigin(request) {
  const host = request.headers.host ?? "127.0.0.1:8787";
  return `http://${host}`;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  if (rawBody.length === 0) {
    return {};
  }

  return JSON.parse(rawBody);
}

function buildPolicyPayload(request, config) {
  const origin = buildOrigin(request);

  return {
    cloudProxyEndpoint: origin,
    defaultProvider: config.defaultProvider,
    localDirectEnabled: config.localDirectEnabled,
    localDirectEndpoint: config.localDirectEndpoint,
    modelAccessMode: config.modelAccessMode,
    policyVersion: config.policyVersion,
    syncedAt: config.syncedAt
  };
}

function buildProviderRegistry(config) {
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

function buildRecommendationPayload(body) {
  const selectedDocuments = Array.isArray(body.selectedDocuments) ? body.selectedDocuments : [];
  const selectedTitles = selectedDocuments
    .filter((document) => typeof document?.title === "string")
    .map((document) => document.title);

  if (selectedTitles.some((title) => title.includes("BERT"))) {
    return {
      recommendations: [
        {
          id: "rec-bert-1",
          relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
          relevanceBand: "high",
          relevanceScore: 0.92,
          reason: "同样关注大规模预训练语言模型的迁移能力。",
          source: "Semantic Scholar",
          title: "RoBERTa: A Robustly Optimized BERT Pretraining Approach"
        },
        {
          id: "rec-bert-2",
          relatedDocumentTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
          relevanceBand: "medium",
          relevanceScore: 0.78,
          reason: "延续 BERT 路线，强调参数共享与效率优化。",
          source: "arXiv Watch",
          title: "ALBERT: A Lite BERT for Self-supervised Learning of Language Representations"
        }
      ]
    };
  }

  return {
    recommendations: [
      {
        id: "rec-transformer-1",
        relatedDocumentTitle: "Attention Is All You Need",
        relevanceBand: "high",
        relevanceScore: 0.91,
        reason: "延伸 Transformer 在视觉任务中的应用脉络。",
        source: "Semantic Scholar",
        title: "An Image is Worth 16x16 Words: Transformers for Image Recognition at Scale"
      },
      {
        id: "rec-transformer-2",
        relatedDocumentTitle: "Attention Is All You Need",
        relevanceBand: "medium",
        relevanceScore: 0.75,
        reason: "补充长序列建模方向，便于横向比较注意力结构。",
        source: "Connected Papers",
        title: "Longformer: The Long-Document Transformer"
      }
    ]
  };
}

function buildDocumentMetadataSyncPayload(body) {
  const documents = Array.isArray(body.documents) ? body.documents : [];
  const validDocuments = documents.filter(
    (document) =>
      typeof document?.id === "string" &&
      typeof document?.title === "string" &&
      (typeof document?.sourcePath === "string" || typeof document?.sourcePath === "undefined")
  );
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "anonymous";
  const workspaceRevision = Number.isFinite(body.workspaceRevision) ? body.workspaceRevision : 0;

  return {
    result: {
      acceptedCount: validDocuments.length,
      rejectedCount: documents.length - validDocuments.length,
      syncId: `metadata-${sessionId}-r${workspaceRevision}`,
      syncedAt: "2026-05-14T10:20:00Z"
    }
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

function buildModelAuditPayload(body) {
  const citations = Array.isArray(body.citations) ? body.citations : [];
  const hasTraceableCitation = citations.some((citation) => typeof citation?.snippet === "string" && citation.snippet.length > 0);
  const answer = typeof body.answer === "string" ? body.answer : "";
  const retrievalConfidence = typeof body.retrievalConfidence === "number" ? body.retrievalConfidence : 0.5;
  const score = clampScore(retrievalConfidence + (hasTraceableCitation ? 0 : -0.2) + (answer.length >= 12 ? 0 : -0.15));

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

async function generateAnswer(body, providers) {
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

export function createDevCloudRequestHandler(customConfig = {}) {
  const config = {
    ...defaultConfig,
    ...customConfig
  };
  const providers = {
    ...buildProviderRegistry(config),
    ...(customConfig.providers ?? {})
  };

  return async (request, response) => {
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (method === "GET" && url.pathname === "/healthz") {
      writeJson(response, 200, { ok: true });
      return;
    }

    if (method === "GET" && url.pathname === "/v1/admin/model-policy") {
      writeJson(response, 200, buildPolicyPayload(request, config));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/model/generate") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(response, 400, {
          error: "invalid_json"
        });
        return;
      }

      try {
        writeJson(response, 200, await generateAnswer(body, providers));
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown_error";
        const statusCode =
          typeof message === "string" && message.includes("未注册 provider") ? 400 : 502;

        writeJson(response, statusCode, {
          error: message
        });
      }
      return;
    }

    if (method === "POST" && url.pathname === "/v1/model/audit") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(response, 400, {
          error: "invalid_json"
        });
        return;
      }

      writeJson(response, 200, buildModelAuditPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/account/demo-login") {
      writeJson(response, 200, {
        session: {
          email: "researcher@liteasy.dev",
          expiresAt: "2026-05-15T09:30:00Z",
          name: "Liteasy Researcher",
          sessionId: "demo-session-1"
        }
      });
      return;
    }

    if (method === "POST" && url.pathname === "/v1/recommendations") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(response, 400, {
          error: "invalid_json"
        });
        return;
      }

      writeJson(response, 200, buildRecommendationPayload(body));
      return;
    }

    if (method === "POST" && url.pathname === "/v1/documents/metadata-sync") {
      let body;

      try {
        body = await readJsonBody(request);
      } catch {
        writeJson(response, 400, {
          error: "invalid_json"
        });
        return;
      }

      writeJson(response, 200, buildDocumentMetadataSyncPayload(body));
      return;
    }

    writeJson(response, 404, {
      error: "not_found"
    });
  };
}

export function createDevCloudServer(customConfig = {}) {
  return http.createServer(createDevCloudRequestHandler(customConfig));
}

function resolvePort() {
  const value = Number(process.env.LITEASY_DEV_CLOUD_PORT ?? "8787");
  return Number.isFinite(value) && value > 0 ? value : 8787;
}

async function startFromCli() {
  const port = resolvePort();
  const server = createDevCloudServer();

  server.listen(port, "127.0.0.1", () => {
    console.log(`Liteasy dev cloud listening on http://127.0.0.1:${port}`);
  });
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFilePath) {
  void startFromCli();
}
