import { useEffect, useRef, useState } from "react";
import type { SettingsState } from "../settings/settings.types";
import type { ControlPlaneTransport, ModelPolicySnapshot } from "./controlPlaneClient";
import { fetchModelPolicySnapshot } from "./controlPlaneRuntime";
import type { PolicySyncStatus } from "./policySync.types";

type UsePolicySyncInput = {
  applyModelPolicySnapshot: (snapshot: ModelPolicySnapshot) => void;
  controlPlaneTransport?: ControlPlaneTransport;
  getSettings: () => SettingsState;
};

export function usePolicySync({
  applyModelPolicySnapshot,
  controlPlaneTransport,
  getSettings
}: UsePolicySyncInput) {
  const hasAutoSyncedRef = useRef(false);
  const [policySyncPending, setPolicySyncPending] = useState(false);
  const [policySyncStatus, setPolicySyncStatus] = useState<PolicySyncStatus>("idle");
  const [policySyncMessage, setPolicySyncMessage] = useState<string | undefined>();
  const [policyVersion, setPolicyVersion] = useState<string | undefined>();
  const [lastSyncedAt, setLastSyncedAt] = useState<string | undefined>();

  async function syncCloudPolicy() {
    setPolicySyncPending(true);
    setPolicySyncStatus("syncing");
    setPolicySyncMessage("正在从云端同步模型策略...");

    try {
      const result = await fetchModelPolicySnapshot(getSettings(), {
        transport: controlPlaneTransport
      });
      applyModelPolicySnapshot(result.snapshot);
      setPolicyVersion(result.policyVersion);
      setLastSyncedAt(result.syncedAt);
      const message = "已从云端同步模型策略，当前以云端管理员下发配置为准。";
      setPolicySyncStatus("success");
      setPolicySyncMessage(message);
      return message;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      const message = `云端策略同步失败，请检查控制平面配置。详细信息：${detail}`;
      setPolicySyncStatus("error");
      setPolicySyncMessage(message);
      return message;
    } finally {
      setPolicySyncPending(false);
    }
  }

  useEffect(() => {
    if (hasAutoSyncedRef.current) {
      return;
    }

    hasAutoSyncedRef.current = true;
    void syncCloudPolicy();
  }, []);

  return {
    lastSyncedAt,
    policySyncMessage,
    policySyncPending,
    policySyncStatus,
    policyVersion,
    syncCloudPolicy
  };
}
