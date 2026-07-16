import fs from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hardcodedDevSecrets } from "./devHardcodedSecrets.mjs";

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
  content.split(/\r?\n/).forEach((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(env, parsed.key) && env[parsed.key] !== "") {
      return;
    }

    env[parsed.key] = parsed.value;
  });

  return true;
}

loadSecretEnvFile();

const useHardcodedDevSecrets = process.env.LITEASY_USE_HARDCODED_DEV_SECRETS === "1";

export const defaultConfig = {
  accountSessionDurationMs: 7 * 24 * 60 * 60 * 1000,
  authRateLimit: {
    limit: 8,
    windowMs: 15 * 60 * 1000
  },
  deepseekApiBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  defaultProvider:
    process.env.LITEASY_MODEL_PROVIDER ??
    (useHardcodedDevSecrets ? hardcodedDevSecrets.defaultProvider : "openai"),
  localDirectEnabled: false,
  localDirectEndpoint: "http://127.0.0.1:8788",
  modelAccessMode: "cloud_proxy",
  hardcodedDevFakeAnswerPrefix: useHardcodedDevSecrets
    ? hardcodedDevSecrets.fakeAnswerPrefix
    : undefined,
  hardcodedDevForceLocalFakeModel: useHardcodedDevSecrets
    ? hardcodedDevSecrets.forceLocalFakeModel
    : false,
  openaiApiBaseUrl:
    process.env.OPENAI_BASE_URL ??
    (useHardcodedDevSecrets ? hardcodedDevSecrets.openaiApiBaseUrl : "https://api.openai.com/v1"),
  openaiApiKey:
    process.env.OPENAI_API_KEY ??
    (useHardcodedDevSecrets ? hardcodedDevSecrets.openaiApiKey : undefined),
  policyVersion: "dev-policy-v1",
  syncedAt: "2026-05-14T09:30:00Z"
};

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
