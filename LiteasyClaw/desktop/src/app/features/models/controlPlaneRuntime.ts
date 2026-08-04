import type { SettingsState } from "../settings/settings.types";
import {
  createControlPlaneClient,
  type ControlPlaneTransport,
  type ControlPlanePolicySnapshotResult,
  type ModelPolicySnapshot
} from "./controlPlaneClient";
import { trustModelProxyEndpointFromPolicy } from "./modelProxyTrust";

type ControlPlaneRuntimeDeps = {
  transport?: ControlPlaneTransport;
};

const mockModelPolicySnapshot: ModelPolicySnapshot = {
  "models.cloud_proxy_endpoint": "mock://cloud-proxy",
  "models.default_provider": "openai"
};

const mockPolicySyncResult: ControlPlanePolicySnapshotResult = {
  policyVersion: "mock-policy-v1",
  snapshot: mockModelPolicySnapshot,
  syncedAt: "2026-05-14T09:30:00Z"
};

function isMockEndpoint(endpoint: string) {
  return endpoint.startsWith("mock://");
}

export async function fetchModelPolicySnapshot(
  settings: SettingsState,
  deps: ControlPlaneRuntimeDeps = {}
) {
  const endpoint = settings["models.control_plane_endpoint"];
  if (isMockEndpoint(endpoint)) {
    return mockPolicySyncResult;
  }

  const client = createControlPlaneClient({
    endpoint,
    transport: deps.transport
  });

  const result = await client();
  trustModelProxyEndpointFromPolicy(result.snapshot["models.cloud_proxy_endpoint"]);
  return result;
}
