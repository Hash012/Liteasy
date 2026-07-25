import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "./metadata.types";
import { ArrowSyncRegular, DatabaseRegular } from "@fluentui/react-icons";

type DocumentMetadataSyncPanelProps = {
  lastResult: DocumentMetadataSyncResult | null;
  message: string;
  onRetrySync?: () => void;
  status: DocumentMetadataSyncStatus;
};

function getStatusLabel(status: DocumentMetadataSyncStatus, lastResult: DocumentMetadataSyncResult | null) {
  if (status === "syncing") {
    return "同步中";
  }

  if (status === "success") {
    return `已同步 ${lastResult?.acceptedCount ?? 0} 篇`;
  }

  if (status === "error") {
    return "失败";
  }

  if (status === "idle") {
    return "无文献";
  }

  return "当前已退化为本地阅读器";
}

export function DocumentMetadataSyncPanel({
  lastResult,
  message,
  onRetrySync,
  status
}: DocumentMetadataSyncPanelProps) {
  const statusLabel = getStatusLabel(status, lastResult);

  return (
    <div className="metadata-sync-card">
      <div aria-label="文献元数据同步" className="metadata-sync-icon"><DatabaseRegular /></div>
      <div className={`model-policy-status ${status}`} title={message}>
        {statusLabel}
      </div>
      <button
        aria-label="重新同步文献元数据"
        className="policy-button sync icon-only"
        disabled={status === "syncing" || status === "unauthenticated"}
        onClick={onRetrySync}
        title={message}
        type="button"
      >
        <ArrowSyncRegular />
      </button>
    </div>
  );
}
