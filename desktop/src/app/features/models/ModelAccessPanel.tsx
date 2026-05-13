import type { SettingsState } from "../settings/settings.types";
import type { PolicySyncStatus } from "./policySync.types";

type ModelAccessPanelProps = {
  latestExecutionLabel?: string;
  onSyncCloudPolicy: () => void;
  onSetAccessMode: (mode: SettingsState["models.access_mode"]) => void;
  onToggleLocalDirectEnabled: (enabled: boolean) => void;
  policyVersion?: string;
  settings: SettingsState;
  syncedAt?: string;
  syncMessage?: string;
  syncPending?: boolean;
  syncStatus?: PolicySyncStatus;
};

function getAccessModeLabel(mode: SettingsState["models.access_mode"]) {
  return mode === "cloud_proxy" ? "云代理" : "本地直连";
}

function getSyncStatusLabel(status: PolicySyncStatus) {
  if (status === "syncing") {
    return "同步中";
  }

  if (status === "success") {
    return "已同步";
  }

  if (status === "error") {
    return "失败";
  }

  return "未同步";
}

export function ModelAccessPanel({
  latestExecutionLabel,
  onSyncCloudPolicy,
  onSetAccessMode,
  onToggleLocalDirectEnabled,
  policyVersion,
  settings,
  syncedAt,
  syncMessage,
  syncPending = false,
  syncStatus = "idle"
}: ModelAccessPanelProps) {
  const localDirectAvailable = settings["models.local_direct_enabled"];

  return (
    <div className="model-policy-card">
      <div className="model-policy-title">模型接入策略</div>
      <div className="model-policy-summary">
        当前通道：{getAccessModeLabel(settings["models.access_mode"])} · Provider：
        {settings["models.default_provider"]}
      </div>
      <div className={`model-policy-status ${syncStatus}`}>同步状态：{getSyncStatusLabel(syncStatus)}</div>
      {policyVersion ? <div className="model-policy-meta">策略版本：{policyVersion}</div> : null}
      {syncedAt ? <div className="model-policy-meta">最近同步：{syncedAt}</div> : null}
      {latestExecutionLabel ? (
        <div className="model-policy-meta">最近执行：{latestExecutionLabel}</div>
      ) : null}
      <label className="model-policy-toggle">
        <input
          checked={localDirectAvailable}
          onChange={(event) => onToggleLocalDirectEnabled(event.target.checked)}
          type="checkbox"
        />
        <span>允许本地直连（模拟云端策略）</span>
      </label>
      <div className="model-policy-actions">
        <button
          className={settings["models.access_mode"] === "cloud_proxy" ? "policy-button active" : "policy-button"}
          onClick={() => onSetAccessMode("cloud_proxy")}
          type="button"
        >
          使用云代理
        </button>
        <button
          className={settings["models.access_mode"] === "local_direct" ? "policy-button active" : "policy-button"}
          disabled={!localDirectAvailable}
          onClick={() => onSetAccessMode("local_direct")}
          type="button"
        >
          使用本地直连
        </button>
      </div>
      <button
        className="policy-button sync"
        disabled={syncPending}
        onClick={onSyncCloudPolicy}
        type="button"
      >
        {syncPending ? "同步中..." : "同步云端策略"}
      </button>
      <div className="model-policy-footnote">
        {syncMessage ?? "管理员未开放时，桌面端只能通过云端代理通道调用模型。"}
      </div>
    </div>
  );
}
