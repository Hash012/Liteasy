import type { SettingsState } from "../settings/settings.types";
import {
  createControlPlaneClient,
  type ControlPlaneTransport,
  type ControlPlanePolicySnapshotResult,
  type ModelPolicySnapshot
} from "./controlPlaneClient";

type ControlPlaneRuntimeDeps = {
  transport?: ControlPlaneTransport;
};

const mockModelPolicySnapshot: ModelPolicySnapshot = {
  "models.access_mode": "cloud_proxy",
  "models.cloud_proxy_endpoint": "mock://cloud-proxy",
  "models.default_provider": "openai",
  "models.local_direct_enabled": false,
  "models.local_direct_endpoint": "mock://local-direct"
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

  return client();
}
