import type { SettingsState } from "../settings/settings.types";
import {
  createControlPlaneClient,
  type ControlPlaneTransport,
} from "./controlPlaneClient";
import { trustModelProxyEndpointFromPolicy } from "./modelProxyTrust";

type ControlPlaneRuntimeDeps = {
  sessionId: string;
  transport?: ControlPlaneTransport;
};

export async function fetchModelPolicySnapshot(
  settings: SettingsState,
  deps: ControlPlaneRuntimeDeps
) {
  const endpoint = settings["models.control_plane_endpoint"];
  const client = createControlPlaneClient({
    endpoint,
    sessionId: deps.sessionId,
    transport: deps.transport
  });

  const result = await client();
  trustModelProxyEndpointFromPolicy(result.snapshot["models.cloud_proxy_endpoint"]);
  return result;
}
