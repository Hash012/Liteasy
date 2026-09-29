import { Button, Tooltip } from "@fluentui/react-components";
import { BookmarkRegular, DeleteRegular, DocumentRegular } from "@fluentui/react-icons";
import type { RecommendationItem } from "./recommendation.types";
import "./recommendationList.css";

export function recommendationDateLabel(item: RecommendationItem) {
  const match = item.publishedAt?.match(/^(\d{4})(?:-(\d{2}))?(?:-\d{2}(?:T.*)?)?$/);
  if (match && Number(match[1]) >= 1000) {
    if (match[2] && Number(match[2]) >= 1 && Number(match[2]) <= 12) return `${match[1]}-${match[2]}`;
    if (!match[2]) return match[1];
  }
  return Number.isInteger(item.publishedYear) && item.publishedYear! >= 1000 && item.publishedYear! <= 9999
    ? String(item.publishedYear) : "日期未知";
}

export function RecommendationList({ items, selectedId, pendingIds, canSave, onInspect, onDownload, onSave, onDismiss }: {
  items: RecommendationItem[];
  selectedId?: string;
  pendingIds: string[];
  canSave: boolean;
  onInspect?: (item: RecommendationItem) => void;
  onDownload?: (item: RecommendationItem) => void;
  onSave: (item: RecommendationItem) => void;
  onDismiss: (item: RecommendationItem) => void;
}) {
  return <ul className="recommendation-compact-list" aria-label="推荐论文">
    {items.map((item) => <li key={item.id} className={`recommendation-compact-item${selectedId === item.id ? " selected" : ""}`}>
      <button type="button" className="recommendation-compact-row" aria-label={`查看推荐 ${item.title}`}
        aria-pressed={selectedId === item.id} aria-busy={pendingIds.includes(item.id)}
        title={`${item.title}\n单击查看元信息，双击下载到文献库 Download`}
        draggable onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("application/x-liteasy-library-resource-v2", JSON.stringify({ area: "recommendation", recommendation: item }));
        }}
        onClick={() => onInspect?.(item)} onDoubleClick={() => { if (!pendingIds.includes(item.id)) onDownload?.(item); }}
        onKeyDown={(event) => { if (event.key === "Enter" && event.ctrlKey) { event.preventDefault(); onDownload?.(item); } }}>
        <DocumentRegular aria-hidden="true" />
        <span className="recommendation-compact-title">{item.title}</span>
        <time className="recommendation-compact-date">{recommendationDateLabel(item)}</time>
      </button>
      <div className="recommendation-compact-actions">
        <Tooltip content="收藏" relationship="label"><Button appearance="subtle" size="small" aria-label={`收藏 ${item.title}`} disabled={!canSave || pendingIds.includes(item.id)} icon={<BookmarkRegular />} onClick={() => onSave(item)} /></Tooltip>
        <Tooltip content="不感兴趣" relationship="label"><Button appearance="subtle" size="small" aria-label={`忽略 ${item.title}`} icon={<DeleteRegular />} onClick={() => onDismiss(item)} /></Tooltip>
      </div>
    </li>)}
  </ul>;
}
