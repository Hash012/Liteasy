import {
  generatedVisualizationModalities,
  type GeneratedVisualizationModality
} from "../visualization/visualizationArtifact.types";

export type MultimodalVisualizationCapability = {
  allowed: boolean;
  enabled: boolean;
  serviceAvailable: boolean;
  quota: { available: boolean };
  availableModalities: GeneratedVisualizationModality[];
};

export type AccountCapabilities = {
  developerDiagnostics: boolean;
  multimodalVisualization: MultimodalVisualizationCapability;
};

export const unavailableMultimodalVisualizationCapability: MultimodalVisualizationCapability = {
  allowed: false,
  enabled: false,
  serviceAvailable: false,
  quota: { available: false },
  availableModalities: []
};

export type AccountCapabilitiesTransportRequest = {
  headers: Record<string, string>;
  method: "GET";
  url: string;
};

export type AccountCapabilitiesTransport = (
  request: AccountCapabilitiesTransportRequest
) => Promise<{
  json: () => Promise<unknown>;
  ok: boolean;
  status: number;
}>;

async function defaultTransport(request: AccountCapabilitiesTransportRequest) {
  return fetch(request.url, {
    cache: "no-store",
    headers: request.headers,
    method: request.method
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function parseMultimodalVisualizationCapability(value: unknown): MultimodalVisualizationCapability {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "allowed",
    "enabled",
    "serviceAvailable",
    "quota",
    "availableModalities"
  ])) {
    return unavailableMultimodalVisualizationCapability;
  }
  if (
    typeof value.allowed !== "boolean" ||
    typeof value.enabled !== "boolean" ||
    typeof value.serviceAvailable !== "boolean" ||
    !isRecord(value.quota) ||
    !hasOnlyKeys(value.quota, ["available", "remainingBand"]) ||
    typeof value.quota.available !== "boolean" ||
    !Array.isArray(value.availableModalities) ||
    !value.availableModalities.every((modality): modality is GeneratedVisualizationModality =>
      typeof modality === "string" &&
      (generatedVisualizationModalities as readonly string[]).includes(modality)
    )
  ) {
    return unavailableMultimodalVisualizationCapability;
  }
  if (
    "remainingBand" in value.quota &&
    value.quota.remainingBand !== undefined &&
    !new Set(["none", "low", "available"]).has(value.quota.remainingBand as string)
  ) {
    return unavailableMultimodalVisualizationCapability;
  }
  return {
    allowed: value.allowed,
    enabled: value.enabled,
    serviceAvailable: value.serviceAvailable,
    quota: { available: value.quota.available },
    availableModalities: [...value.availableModalities]
  };
}

export async function loadAccountCapabilities({
  endpoint,
  sessionId,
  transport = defaultTransport
}: {
  endpoint: string;
  sessionId: string;
  transport?: AccountCapabilitiesTransport;
}): Promise<AccountCapabilities> {
  const response = await transport({
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${sessionId}`
    },
    method: "GET",
    url: `${endpoint.replace(/\/+$/, "")}/v1/account/capabilities`
  });
  if (!response.ok) {
    throw new Error(`account_capabilities_unavailable:${response.status}`);
  }
  const payload = await response.json();
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !("developerDiagnostics" in payload) ||
    typeof payload.developerDiagnostics !== "boolean"
  ) {
    throw new Error("account_capabilities_invalid");
  }
  const capabilityPayload = payload as Record<string, unknown>;
  return {
    developerDiagnostics: payload.developerDiagnostics,
    multimodalVisualization: parseMultimodalVisualizationCapability(capabilityPayload.multimodalVisualization)
  };
}
