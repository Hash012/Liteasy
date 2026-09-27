import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "./metadata.types";
import { Button } from "@fluentui/react-components";
import { ArrowSyncRegular } from "@fluentui/react-icons";

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

  return "登录后可同步";
}

export function DocumentMetadataSyncPanel({
  lastResult,
  message,
  onRetrySync,
  status
}: DocumentMetadataSyncPanelProps) {
  const statusLabel = getStatusLabel(status, lastResult);

  return <div className="settings-metadata-sync">
    <p role="status">{statusLabel}{message ? ` · ${message}` : ""}</p>
    <Button aria-label="重新同步文献元数据" icon={<ArrowSyncRegular />}
      disabled={!onRetrySync || status === "syncing" || status === "unauthenticated"}
      onClick={onRetrySync}>重新同步</Button>
  </div>;
}
