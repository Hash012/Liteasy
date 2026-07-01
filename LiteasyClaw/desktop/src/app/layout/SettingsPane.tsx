import { DocumentMetadataSyncPanel } from "../features/metadata/DocumentMetadataSyncPanel";
import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "../features/metadata/metadata.types";

type SettingsPaneProps = {
  documentMetadataSyncMessage?: string;
  documentMetadataSyncResult: DocumentMetadataSyncResult | null;
  documentMetadataSyncStatus: DocumentMetadataSyncStatus;
  onRetryDocumentMetadataSync?: () => void;
};

export function SettingsPane({
  documentMetadataSyncMessage,
  documentMetadataSyncResult,
  documentMetadataSyncStatus,
  onRetryDocumentMetadataSync,
}: SettingsPaneProps) {
  return (
    <section aria-label="左边栏设置" className="settings-panel">
      <div className="settings-panel-title">设置</div>
      <div className="settings-model-indicator">云端模型能力</div>
      <div className="settings-model-copy">
        Liteasy 面向普通用户统一通过云端模型能力提供问答、解释和产物生成服务。
      </div>
      <DocumentMetadataSyncPanel
        lastResult={documentMetadataSyncResult}
        message={documentMetadataSyncMessage ?? ""}
        onRetrySync={onRetryDocumentMetadataSync}
        status={documentMetadataSyncStatus}
      />
    </section>
  );
}
