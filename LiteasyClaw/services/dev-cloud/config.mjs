export const defaultConfig = {
  deepseekApiBaseUrl: process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY,
  defaultProvider: process.env.LITEASY_MODEL_PROVIDER ?? "openai",
  localDirectEnabled: false,
  localDirectEndpoint: "http://127.0.0.1:8788",
  modelAccessMode: "cloud_proxy",
  openaiApiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  openaiApiKey: process.env.OPENAI_API_KEY,
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
  return {
    desktopOrigin: process.env.LITEASY_DESKTOP_PUBLIC_ORIGIN,
    publicOrigin: process.env.LITEASY_DEV_CLOUD_PUBLIC_ORIGIN
  };
}
