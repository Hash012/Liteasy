import fs from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const configDir = dirname(fileURLToPath(import.meta.url));
function stripMatchingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvLine(line) {
  const normalized = line.trim();
  if (normalized.length === 0 || normalized.startsWith("#")) {
    return null;
  }

  const assignment = normalized.startsWith("export ")
    ? normalized.slice("export ".length).trim()
    : normalized;
  const separatorIndex = assignment.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = assignment.slice(0, separatorIndex).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    return null;
  }

  const value = stripMatchingQuotes(assignment.slice(separatorIndex + 1).trim());
  return {
    key,
    value
  };
}

export function loadSecretEnvFile(
  envFilePath = process.env.LITEASY_DEV_CLOUD_ENV_FILE ?? path.join(configDir, ".env.local"),
  env = process.env
) {
  if (!fs.existsSync(envFilePath)) {
    return false;
  }

  const content = fs.readFileSync(envFilePath, "utf8");
  const definedKeys = new Set();
  content.split(/\r?\n/).forEach((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed || definedKeys.has(parsed.key)) {
      return;
    }
    definedKeys.add(parsed.key);

    if (Object.prototype.hasOwnProperty.call(env, parsed.key) && env[parsed.key] !== "") {
      return;
    }

    env[parsed.key] = parsed.value;
  });

  return true;
}

loadSecretEnvFile();

export const defaultConfig = {
  accountSessionDurationMs: 7 * 24 * 60 * 60 * 1000,
  authRateLimit: {
    limit: 8,
    windowMs: 15 * 60 * 1000
  },
  deepseekApiBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  defaultProvider: process.env.LITEASY_MODEL_PROVIDER ?? "openai",
  localDirectEnabled: false,
  localDirectEndpoint: "http://127.0.0.1:8788",
  modelAccessMode: "cloud_proxy",
  mineruToken: process.env.MINERU_TOKEN,
  grobidEndpoint: process.env.GROBID_ENDPOINT ?? "http://127.0.0.1:8070",
  intuechoApiEndpoint: process.env.INTUECHO_API_ENDPOINT,
  intuechoLiteratureProjection: {
    apiUrl: process.env.LITEASY_INTUECHO_LITERATURE_API_URL ?? process.env.INTUECHO_API_ENDPOINT,
    audience: process.env.LITEASY_IDP_LITERATURE_SERVICE_AUDIENCE ?? "intuecho-internal",
    clientId: process.env.LITEASY_IDP_LITERATURE_SERVICE_CLIENT_ID,
    clientSecret: process.env.LITEASY_IDP_LITERATURE_SERVICE_CLIENT_SECRET,
    scope: process.env.LITEASY_IDP_LITERATURE_SERVICE_SCOPE ?? "literature:verify",
    tokenUrl: process.env.LITEASY_IDP_TOKEN_URL
  },
  // Deployment-owned secret. It is never returned to or accepted from a desktop client.
  // OpenAlex requires a key for every API request as of 2026-02-13.
  openAlexApiKey: process.env.OPENALEX_API_KEY,
  // Retained as contact metadata for compatible connectors; it is not authentication and does
  // not enable OpenAlex by itself now that the upstream requires an API key.
  openAlexMailto: process.env.OPENALEX_MAILTO,
  // How to use an anchor's own local reference subset, once the reader's client sends one.
  //   off       — the paper-level neighbourhood, retained as a comparison arm.
  //   additive  — the anchor's cited works on top of it, adding signal without removing noise.
  //   exclusive — only the anchor's neighbourhood; related_works and whole-paper citing works are
  //               dropped. The 40%-vs-68% gate measurement makes this the production default.
  anchorReferenceMode: (() => {
    const mode = (process.env.LITEASY_ANCHOR_REFERENCE_MODE ?? "").trim().toLowerCase();
    return mode === "off" || mode === "additive" ? mode : "exclusive";
  })(),
  openaiApiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL ?? process.env.VITE_LITEASY_OPENAI_MODEL ?? "gpt-5.4-mini",
  openaiReasoningEffort: process.env.OPENAI_REASONING_EFFORT,
  policyVersion: "dev-policy-v1",
  recommendationEmbeddingApiKey: process.env.LITEASY_RECOMMENDATION_EMBEDDING_API_KEY,
  recommendationEmbeddingBaseUrl: process.env.LITEASY_RECOMMENDATION_EMBEDDING_BASE_URL,
  recommendationEmbeddingModel: process.env.LITEASY_RECOMMENDATION_EMBEDDING_MODEL,
  recommendationRerankerApiKey: process.env.LITEASY_RECOMMENDATION_RERANKER_API_KEY,
  recommendationRerankerBaseUrl: process.env.LITEASY_RECOMMENDATION_RERANKER_BASE_URL,
  recommendationRerankerModel: process.env.LITEASY_RECOMMENDATION_RERANKER_MODEL,
  semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY,
  syncedAt: "2026-05-14T09:30:00Z"
};

function sanitizeUpstreamBaseUrl(value, apiKey) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = new URL(value);
    let sanitized = `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
    const secrets = typeof apiKey === "string"
      ? new Set([apiKey, apiKey.trim()].filter(Boolean))
      : new Set();
    for (const secret of secrets) {
      sanitized = sanitized
        .replaceAll(secret, "[redacted]")
        .replaceAll(encodeURIComponent(secret), "[redacted]");
    }
    return sanitized;
  } catch {
    return "invalid upstream base URL";
  }
}

export function buildPublicRuntimeSummary(
  config = defaultConfig,
  {
    pid = process.pid,
    startedAt = new Date().toISOString()
  } = {}
) {
  const provider = typeof config.defaultProvider === "string"
    ? config.defaultProvider
    : "openai";
  const isDeepSeek = provider === "deepseek";
  const isOpenAI = provider === "openai";
  const apiKey = isDeepSeek
    ? config.deepseekApiKey
    : isOpenAI
      ? config.openaiApiKey
      : undefined;
  const upstreamBaseUrl = isDeepSeek
    ? config.deepseekApiBaseUrl
    : isOpenAI
      ? config.openaiApiBaseUrl
      : undefined;
  const selectedModel = isDeepSeek
    ? config.deepseekModel ?? null
    : isOpenAI
      ? config.openaiModel ?? null
      : null;

  return {
    provider,
    upstreamBaseUrl: sanitizeUpstreamBaseUrl(upstreamBaseUrl, apiKey),
    hasApiKey: typeof apiKey === "string" && apiKey.trim().length > 0,
    selectedModel,
    pid,
    startedAt
  };
}

/**
 * For live evaluation scripts, which cannot run at all without the credential. Reads the
 * same `OPENALEX_API_KEY` the service uses, so there is one place to configure it.
 */
export function requireOpenAlexApiKey(env = process.env) {
  const apiKey = env.OPENALEX_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "缺少 OPENALEX_API_KEY。请在 development/dev-cloud/.env.local 中配置，或设置同名环境变量后重试。"
    );
  }
  return apiKey;
}

export function buildOrigin(request) {
  const host = request.headers.host ?? "127.0.0.1:8787";
  return `http://${host}`;
}

export function getPublicOrigin(request, config) {
  if (typeof config.publicOrigin === "string" && config.publicOrigin.length > 0) {
    return config.publicOrigin;
  }

  return buildOrigin(request);
}

export function resolvePort() {
  const value = Number(process.env.LITEASY_DEV_CLOUD_PORT ?? "8787");
  return Number.isFinite(value) && value > 0 ? value : 8787;
}

export function resolveHost() {
  const host = process.env.LITEASY_DEV_CLOUD_HOST;
  return typeof host === "string" && host.length > 0 ? host : "127.0.0.1";
}

export function resolveCliRuntimeConfig() {
  const allowedOrigins = (process.env.LITEASY_DEV_CLOUD_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    allowedOrigins,
    desktopOrigin: process.env.LITEASY_DESKTOP_PUBLIC_ORIGIN,
    publicOrigin: process.env.LITEASY_DEV_CLOUD_PUBLIC_ORIGIN
  };
}
