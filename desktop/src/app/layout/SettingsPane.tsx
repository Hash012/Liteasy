import { DocumentMetadataSyncPanel } from "../features/metadata/DocumentMetadataSyncPanel";
import { DevCloudEndpointPanel } from "../features/models/DevCloudEndpointPanel";
import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "../features/metadata/metadata.types";
import { ModelAccessPanel } from "../features/models/ModelAccessPanel";
import type { PolicySyncStatus } from "../features/models/policySync.types";
import type { SettingsState } from "../features/settings/settings.types";

type SettingsPaneProps = {
  documentMetadataSyncMessage?: string;
  documentMetadataSyncResult: DocumentMetadataSyncResult | null;
  documentMetadataSyncStatus: DocumentMetadataSyncStatus;
  latestExecutionLabel?: string;
  onRetryDocumentMetadataSync?: () => void;
  onSetAccessMode: (mode: SettingsState["models.access_mode"]) => void;
  onSyncCloudPolicy: () => void;
  onToggleLocalDirectEnabled: (enabled: boolean) => void;
  onUseLocalDevCloudDefaults: () => void;
  policySyncMessage?: string;
  policySyncPending: boolean;
  policySyncStatus: PolicySyncStatus;
  policyVersion?: string;
  settings: SettingsState;
  syncedAt?: string;
};

export function SettingsPane({
  documentMetadataSyncMessage,
  documentMetadataSyncResult,
  documentMetadataSyncStatus,
  latestExecutionLabel,
  onRetryDocumentMetadataSync,
  onSetAccessMode,
  onSyncCloudPolicy,
  onToggleLocalDirectEnabled,
  onUseLocalDevCloudDefaults,
  policySyncMessage,
  policySyncPending,
  policySyncStatus,
  policyVersion,
  settings,
  syncedAt
}: SettingsPaneProps) {
  return (
    <section aria-label="左边栏设置" className="settings-panel">
      <div className="settings-panel-title">设置</div>
      <div className="settings-model-indicator">
        模型：{settings["models.access_mode"] === "cloud_proxy" ? "云代理" : "本地直连"}
      </div>
      <ModelAccessPanel
        latestExecutionLabel={latestExecutionLabel}
        onSetAccessMode={onSetAccessMode}
        onSyncCloudPolicy={onSyncCloudPolicy}
        onToggleLocalDirectEnabled={onToggleLocalDirectEnabled}
        policyVersion={policyVersion}
        settings={settings}
        syncedAt={syncedAt}
        syncMessage={policySyncMessage}
        syncPending={policySyncPending}
        syncStatus={policySyncStatus}
      />
      <DevCloudEndpointPanel
        onUseLocalDevCloudDefaults={onUseLocalDevCloudDefaults}
        settings={settings}
      />
      <DocumentMetadataSyncPanel
        lastResult={documentMetadataSyncResult}
        message={documentMetadataSyncMessage ?? ""}
        onRetrySync={onRetryDocumentMetadataSync}
        status={documentMetadataSyncStatus}
      />
    </section>
  );
}
