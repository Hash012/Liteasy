import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "./metadata.types";

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

  return "未连接云账号";
}

export function DocumentMetadataSyncPanel({
  lastResult,
  message,
  onRetrySync,
  status
}: DocumentMetadataSyncPanelProps) {
  return (
    <div className="model-policy-card metadata-sync-card">
      <div className="model-policy-title">文献元数据同步</div>
      <div className={`model-policy-status ${status}`}>文献同步：{getStatusLabel(status, lastResult)}</div>
      {lastResult ? <div className="model-policy-meta">最近同步：{lastResult.syncedAt}</div> : null}
      {lastResult ? <div className="model-policy-meta">同步批次：{lastResult.syncId}</div> : null}
      <button
        className="policy-button sync"
        disabled={status === "syncing" || status === "unauthenticated"}
        onClick={onRetrySync}
        type="button"
      >
        重新同步文献元数据
      </button>
      <div className="model-policy-footnote">{message}</div>
    </div>
  );
}
