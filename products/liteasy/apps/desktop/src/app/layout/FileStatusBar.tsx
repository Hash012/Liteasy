import { ActionButton as Button, IconAction } from "../shared/ui/productPrimitives";
import { ReadingCatalogDetails, type ReadingCatalogActions } from "../features/library/ReadingCatalogDetails";
import "../features/library/readingCatalog.css";
import { displayPath } from "../features/resource-filesystem/displayPath";
import { Popover, PopoverSurface, PopoverTrigger, Tooltip } from "@fluentui/react-components";
import { EditRegular, InfoRegular } from "@fluentui/react-icons";
import type { FileStatus } from "../features/workspace/workspaceShell.types";
import "../styles/workspaceShell.css";
import { RecommendationDetails } from "../features/recommendations/RecommendationDetails";
import { recommendationDateLabel } from "../features/recommendations/RecommendationList";
import type { DownloadRecommendation, RecommendationLocations } from "../features/recommendations/RecommendationDownload";

function fileSize(size?: number) {
  if (size === undefined || !Number.isFinite(size) || size < 0) return undefined;
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length);
  return `${Number((size / 1024 ** exponent).toFixed(1))} ${units[exponent - 1]}`;
}

export function FileStatusBar({ status, actions, onDownloadRecommendation, recommendationLocations, onOpenAsset }: { onOpenAsset?: (path: string) => Promise<unknown>; status?: FileStatus; actions?: ReadingCatalogActions; onDownloadRecommendation?: DownloadRecommendation; recommendationLocations?: RecommendationLocations | null }) {
  const modified = status?.modifiedAt && Number.isFinite(status.modifiedAt.getTime()) ? status.modifiedAt.toLocaleString() : undefined;
  const inspectionDetails = [
    status?.type,
    status?.recommendation?.authors?.join(" · "),
    status?.recommendation ? recommendationDateLabel(status.recommendation) : undefined,
    status?.recommendation?.venue,
    status?.entry?.authors?.join(" · "),
    status?.entry?.year,
    status?.entry?.publication,
    status?.entry?.publisher,
    status?.entry?.doi ? `DOI ${status.entry.doi}` : status?.entry?.identifier,
    status?.pageCount && Number.isFinite(status.pageCount) && status.pageCount > 0 ? `${status.pageCount} 页` : undefined,
    status?.itemCount !== undefined && Number.isFinite(status.itemCount) && status.itemCount >= 0 ? `${status.itemCount} 项` : undefined,
    fileSize(status?.size),
    status?.source ? { local: "本地", cloud: "云端", remote: "远程" }[status.source] : undefined,
    modified ? `修改于 ${modified}` : undefined
  ].filter(Boolean).join(" · ");
  const details = [status?.type, status?.pageCount && Number.isFinite(status.pageCount) && status.pageCount > 0 ? `${status.pageCount} 页` : undefined, status?.itemCount !== undefined && Number.isFinite(status.itemCount) && status.itemCount >= 0 ? `${status.itemCount} 项` : undefined].filter(Boolean).join(" · ");
  const progress = [
    status?.indexState ? { indexed: "已索引", indexing: "正在索引…", "not-indexed": "未索引", error: "解析失败" }[status.indexState] : undefined,
    status?.syncState ? { synced: "当前文件已同步", syncing: "当前文件正在同步…", error: "当前文件同步失败" }[status.syncState] : undefined
  ].filter(Boolean).join(" · ");
  const error = status?.indexState === "error" || status?.syncState === "error";
  return (
    <footer aria-label="文件状态栏" className={`file-status-bar${status ? "" : " is-idle"}`}>
      <div className="shell-file-details" title={details}>
        {status?.name ? <Tooltip content={status.path ? `${status.name}\n${displayPath(status.path)}` : status.name} relationship="description">
          <span className="shell-file-name" tabIndex={0}>{status.name}</span>
        </Tooltip> : null}
        <span className="shell-file-metadata">{details || (!status?.name ? "Liteasy · 就绪" : "")}</span>
      </div>
      {status?.recommendation ? <Popover key={status.recommendation.id} positioning="above-end">
        <PopoverTrigger disableButtonEnhancement><IconAction appearance="subtle" density="compact" label="展开推荐元信息" icon={<InfoRegular />} /></PopoverTrigger>
        <PopoverSurface><RecommendationDetails onOpenAsset={onOpenAsset} item={status.recommendation} onDownload={onDownloadRecommendation} locations={recommendationLocations} /></PopoverSurface>
      </Popover> : null}
      {status?.entry && actions ? <Popover key={status.entry.id} positioning="above-end">
        <PopoverTrigger disableButtonEnhancement><IconAction appearance="subtle" density="compact" label="展开文件元信息" icon={<InfoRegular />} /></PopoverTrigger>
        <PopoverSurface className="shell-file-inspector"><p>{inspectionDetails}</p>{actions.onEditBibliography ? <Button icon={<EditRegular />} onClick={() => actions.onEditBibliography!(status.entry!)}>编辑元信息</Button> : null}<ReadingCatalogDetails key={status.entry.id} entry={status.entry} {...actions} /></PopoverSurface>
      </Popover> : null}
      {status && !(status.entry && actions) && !status.recommendation ? <Popover positioning="above-end"><PopoverTrigger disableButtonEnhancement><IconAction label="展开文件元信息" density="compact" icon={<InfoRegular />} appearance="subtle" /></PopoverTrigger><PopoverSurface><p>{inspectionDetails}</p><p>{status.path ? displayPath(status.path) : ""}</p></PopoverSurface></Popover> : null}
      <span role="status" aria-live="polite" className={`shell-file-progress${error ? " has-error" : ""}`} title={progress}>{progress}</span>
    </footer>
  );
}
