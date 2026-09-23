import { displayPath } from "../features/resource-filesystem/displayPath";
import { Tooltip } from "@fluentui/react-components";
import type { FileStatus } from "../features/workspace/workspaceShell.types";
import "../styles/workspaceShell.css";

function fileSize(size?: number) {
  if (size === undefined || !Number.isFinite(size) || size < 0) return undefined;
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length);
  return `${Number((size / 1024 ** exponent).toFixed(1))} ${units[exponent - 1]}`;
}

export function FileStatusBar({ status }: { status?: FileStatus }) {
  const modified = status?.modifiedAt && Number.isFinite(status.modifiedAt.getTime()) ? status.modifiedAt.toLocaleString() : undefined;
  const details = [
    status?.type,
    status?.pageCount && Number.isFinite(status.pageCount) && status.pageCount > 0 ? `${status.pageCount} 页` : undefined,
    status?.itemCount !== undefined && Number.isFinite(status.itemCount) && status.itemCount >= 0 ? `${status.itemCount} 项` : undefined,
    fileSize(status?.size),
    status?.source ? { local: "本地", cloud: "云端", remote: "远程" }[status.source] : undefined,
    modified ? `修改于 ${modified}` : undefined
  ].filter(Boolean).join(" · ");
  const progress = [
    status?.indexState ? { indexed: "已索引", indexing: "正在索引…", "not-indexed": "未索引", error: "解析失败" }[status.indexState] : undefined,
    status?.syncState ? { synced: "已同步", syncing: "正在同步…", error: "同步失败" }[status.syncState] : undefined
  ].filter(Boolean).join(" · ");
  const error = status?.indexState === "error" || status?.syncState === "error";
  return (
    <footer aria-label="文件状态栏" className={`file-status-bar${status ? "" : " is-idle"}`}>
      <div className="shell-file-details" title={details}>
        {status?.name ? <Tooltip content={status.path ? `${status.name}\n${displayPath(status.path)}` : status.name} relationship="description">
          <span className="shell-file-name" tabIndex={0}>{status.name}</span>
        </Tooltip> : null}
        {status?.name && details ? <span aria-hidden="true">·</span> : null}
        <span className="shell-file-metadata">{details || (!status?.name ? "Liteasy · 就绪" : "")}</span>
      </div>
      <span role="status" aria-live="polite" className={`shell-file-progress${error ? " has-error" : ""}`} title={progress}>{progress}</span>
    </footer>
  );
}
