import { formatCloudConnectionError } from "../network/cloudErrorMessage";
import { useEffect, useRef, useState } from "react";
import type { SettingsState } from "../settings/settings.types";
import type { ControlPlaneTransport, ModelPolicySnapshot } from "./controlPlaneClient";
import { fetchModelPolicySnapshot } from "./controlPlaneRuntime";
import type { PolicySyncStatus } from "./policySync.types";

type UsePolicySyncInput = {
  applyModelPolicySnapshot: (snapshot: ModelPolicySnapshot) => void;
  controlPlaneTransport?: ControlPlaneTransport;
  getSettings: () => SettingsState;
  sessionId?: string;
};

export function usePolicySync({
  applyModelPolicySnapshot,
  controlPlaneTransport,
  getSettings,
  sessionId
}: UsePolicySyncInput) {
  const hasAutoSyncedRef = useRef(false);
  const mountedRef = useRef(true);
  const [policySyncPending, setPolicySyncPending] = useState(false);
  const [policySyncStatus, setPolicySyncStatus] = useState<PolicySyncStatus>("idle");
  const [policySyncMessage, setPolicySyncMessage] = useState<string | undefined>();
  const [policyVersion, setPolicyVersion] = useState<string | undefined>();
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>();

  function updatePolicySyncState(update: () => void) {
    if (mountedRef.current) {
      update();
    }
  }

  async function syncCloudPolicy() {
    if (!sessionId) {
      return "登录后才能同步云端模型策略。";
    }
    updatePolicySyncState(() => {
      setPolicySyncPending(true);
      setPolicySyncStatus("syncing");
      setPolicySyncMessage("正在从云端同步模型策略...");
    });

    try {
      const result = await fetchModelPolicySnapshot(getSettings(), {
        sessionId,
        transport: controlPlaneTransport
      });
      updatePolicySyncState(() => {
        applyModelPolicySnapshot(result.snapshot);
        setPolicyVersion(result.policyVersion);
        setLastSyncedAt(result.syncedAt);
      });
      const message = "已从云端同步模型策略，当前以云端管理员下发配置为准。";
      updatePolicySyncState(() => {
        setPolicySyncStatus("success");
        setPolicySyncMessage(message);
      });
      return message;
    } catch (error) {
      const detail = formatCloudConnectionError(error, {
        controlPlaneEndpoint: getSettings()["models.control_plane_endpoint"]
      });
      const message = `云端策略同步失败，请检查控制平面配置。详细信息：${detail}`;
      updatePolicySyncState(() => {
        setPolicySyncStatus("error");
        setPolicySyncMessage(message);
      });
      return message;
    } finally {
      updatePolicySyncState(() => setPolicySyncPending(false));
    }
  }

  useEffect(() => {
    mountedRef.current = true;

    if (!sessionId) {
      hasAutoSyncedRef.current = false;
    } else if (!hasAutoSyncedRef.current) {
      hasAutoSyncedRef.current = true;
      void syncCloudPolicy();
    }

    return () => {
      mountedRef.current = false;
    };
  }, [sessionId]);

  return {
    lastSyncedAt,
    policySyncMessage,
    policySyncPending,
    policySyncStatus,
    policyVersion,
    syncCloudPolicy
  };
}
