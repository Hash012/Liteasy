import type { ModelTransportResponse } from "../models/modelHttpClient";
import {
  parseMultimodalVisualizationCapability,
  type MultimodalVisualizationCapability
} from "../account/accountCapabilitiesClient";

export type VisualizationControlPlaneTransportRequest = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  url: string;
};

export type VisualizationControlPlaneTransport = (
  request: VisualizationControlPlaneTransportRequest
) => Promise<ModelTransportResponse>;

function createIdempotencyKey() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function defaultTransport(
  request: VisualizationControlPlaneTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method
  });
}

export async function setMultimodalVisualizationPreference(input: {
  enabled: boolean;
  endpoint: string;
  sessionId: string;
  transport?: VisualizationControlPlaneTransport;
}): Promise<MultimodalVisualizationCapability> {
  const transport = input.transport ?? defaultTransport;
  const response = await transport({
    body: JSON.stringify({
      enabled: input.enabled,
      idempotencyKey: createIdempotencyKey()
    }),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.sessionId}`,
      "Content-Type": "application/json"
    },
    method: "POST",
    url: `${input.endpoint.replace(/\/+$/, "")}/v1/account/preferences/multimodal-visualization/set`
  });
  if (!response.ok) {
    throw new Error(`multimodal_visualization_preference_unavailable:${response.status}`);
  }
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("multimodal_visualization_capability_invalid");
  }
  return parseMultimodalVisualizationCapability(payload);
}
