import { ModelAccessPanel } from "../features/models/ModelAccessPanel";
import type { PolicySyncStatus } from "../features/models/policySync.types";
import { DocumentMetadataSyncPanel } from "../features/metadata/DocumentMetadataSyncPanel";
import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "../features/metadata/metadata.types";
import type { SettingsState } from "../features/settings/settings.types";

type SettingsPaneProps = {
  documentMetadataSyncMessage?: string;
  documentMetadataSyncResult: DocumentMetadataSyncResult | null;
  documentMetadataSyncStatus: DocumentMetadataSyncStatus;
  latestExecutionLabel?: string;
  onSetAccessMode: (mode: SettingsState["models.access_mode"]) => void;
  onRetryDocumentMetadataSync?: () => void;
  onSyncCloudPolicy: () => void;
  onToggleLocalDirectEnabled: (enabled: boolean) => void;
  policySyncMessage?: string;
  policySyncPending?: boolean;
  policySyncStatus?: PolicySyncStatus;
  policyVersion?: string;
  settings: SettingsState;
  syncedAt?: string;
};

export function SettingsPane({
  documentMetadataSyncMessage,
  documentMetadataSyncResult,
  documentMetadataSyncStatus,
  latestExecutionLabel,
  onSetAccessMode,
  onRetryDocumentMetadataSync,
  onSyncCloudPolicy,
  onToggleLocalDirectEnabled,
  policySyncMessage,
  policySyncPending = false,
  policySyncStatus = "idle",
  policyVersion,
  settings,
  syncedAt
}: SettingsPaneProps) {
  return (
    <section aria-label="左边栏设置" className="settings-panel">
      <div className="settings-panel-title">设置</div>
      <div className="settings-model-indicator">云端模型能力</div>
      <div className="settings-model-copy">
        Liteasy 面向普通用户统一通过云端模型能力提供问答、解释和产物生成服务。
      </div>
      <ModelAccessPanel
        hideTitle
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
      <DocumentMetadataSyncPanel
        lastResult={documentMetadataSyncResult}
        message={documentMetadataSyncMessage ?? ""}
        onRetrySync={onRetryDocumentMetadataSync}
        status={documentMetadataSyncStatus}
      />
    </section>
  );
}
