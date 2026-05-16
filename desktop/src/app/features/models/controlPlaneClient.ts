import type { SettingsState } from "../settings/settings.types";
import type { ModelTransportResponse } from "./modelHttpClient";

export type ModelPolicySnapshot = Pick<
  SettingsState,
  | "models.cloud_proxy_endpoint"
  | "models.default_provider"
>;

export type ControlPlaneTransportRequest = {
  headers: Record<string, string>;
  method: "GET";
  url: string;
};

export type ControlPlaneTransport = (
  request: ControlPlaneTransportRequest
) => Promise<ModelTransportResponse>;

export type ControlPlanePolicySnapshotResult = {
  policyVersion?: string;
  snapshot: ModelPolicySnapshot;
  syncedAt?: string;
};

type CreateControlPlaneClientInput = {
  endpoint: string;
  transport?: ControlPlaneTransport;
};

type ControlPlanePayload = {
  cloudProxyEndpoint: string;
  defaultProvider: string;
  policyVersion?: string;
  syncedAt?: string;
};

function buildControlPlaneUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/admin/model-policy`;
}

function isControlPlanePayload(payload: unknown): payload is ControlPlanePayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "cloudProxyEndpoint" in payload &&
    typeof payload.cloudProxyEndpoint === "string" &&
    "defaultProvider" in payload &&
    typeof payload.defaultProvider === "string"
  );
}

async function defaultTransport(
  request: ControlPlaneTransportRequest
): Promise<ModelTransportResponse> {
  return fetch(request.url, {
    headers: request.headers,
    method: request.method
  });
}

export function createControlPlaneClient({
  endpoint,
  transport = defaultTransport
}: CreateControlPlaneClientInput) {
  return async (): Promise<ControlPlanePolicySnapshotResult> => {
    const response = await transport({
      headers: {
        Accept: "application/json"
      },
      method: "GET",
      url: buildControlPlaneUrl(endpoint)
    });

    if (!response.ok) {
      throw new Error(`云端策略同步失败（${response.status}）`);
    }

    const payload = await response.json();
    if (!isControlPlanePayload(payload)) {
      throw new Error("云端策略返回格式无效");
    }

    return {
      policyVersion: payload.policyVersion,
      snapshot: {
        "models.cloud_proxy_endpoint": payload.cloudProxyEndpoint,
        "models.default_provider": payload.defaultProvider
      },
      syncedAt: payload.syncedAt
    };
  };
}
