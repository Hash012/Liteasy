import { getPublicOrigin } from "../config.mjs";

export function buildPolicyPayload(request, config) {
  const origin = getPublicOrigin(request, config);

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

function isModelAccessMode(value) {
  return value === "cloud_proxy" || value === "local_direct";
}

export function buildPolicyUpdatePayload(request, config, body = {}) {
  const defaultProvider =
    typeof body.defaultProvider === "string" && body.defaultProvider.length > 0
      ? body.defaultProvider
      : config.defaultProvider;
  const localDirectEnabled =
    typeof body.localDirectEnabled === "boolean"
      ? body.localDirectEnabled
      : config.localDirectEnabled;
  const modelAccessMode = isModelAccessMode(body.modelAccessMode)
    ? body.modelAccessMode
    : config.modelAccessMode;

  config.defaultProvider = defaultProvider;
  config.localDirectEnabled = localDirectEnabled;
  config.modelAccessMode = modelAccessMode;
  config.policyVersion = `ops-policy-v${
    Number(String(config.policyVersion).match(/(\d+)$/)?.[1] ?? 1) + 1
  }`;
  config.syncedAt = "2026-05-15T00:15:00Z";

  return {
    policy: buildPolicyPayload(request, config),
    updatedAt: config.syncedAt,
    updatedBy: "internal-ops-demo"
  };
}
