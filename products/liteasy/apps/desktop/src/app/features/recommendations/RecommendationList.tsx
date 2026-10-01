import { useRecommendationFullText } from "./useRecommendationFullText";
import type { PaperServiceConfig } from "../paper-services/paperServiceTransport";
import { useMemo, useState } from "react";
import { Button, Checkbox, Input, Select, Tooltip } from "@fluentui/react-components";
import { BookmarkRegular, DeleteRegular, DocumentRegular, SearchRegular } from "@fluentui/react-icons";
import type { RecommendationItem } from "./recommendation.types";
import { filterRecommendations, recommendationDateLabel, type RecommendationSort } from "./recommendationPresentation";
import "./recommendationList.css";

export { recommendationDateLabel } from "./recommendationPresentation";

export function RecommendationList({ items, service, selectedId, pendingIds, canSave, onInspect, onOpen, onSave, onDismiss }: {
  items: RecommendationItem[];
  service?: PaperServiceConfig;
  selectedId?: string;
  pendingIds: string[];
  canSave: boolean;
  onInspect?: (item: RecommendationItem) => void;
  onOpen?: (item: RecommendationItem) => void;
  onSave: (item: RecommendationItem) => void;
  onDismiss: (item: RecommendationItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [access, setAccess] = useState(false);
  const [sort, setSort] = useState<RecommendationSort>("recommended");
  const years = useMemo(() => [...new Set(items.map(recommendationDateLabel).filter((date) => /^\d{4}/.test(date)).map((date) => date.slice(0, 4)))].sort().reverse(), [items]);
  const fullText = useRecommendationFullText(items, access, service);
  const visible = useMemo(() => filterRecommendations(fullText.items, query, access, year, sort), [fullText.items, query, access, year, sort]);
  return <div className="recommendation-browser">
    <div className="recommendation-filters">
      <Input aria-label="搜索推荐论文" placeholder="搜索标题、作者、主题" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => setQuery(data.value)} />
      <div className="recommendation-filter-row">
        <Select aria-label="推荐排序" value={sort} onChange={(event) => setSort(event.target.value as RecommendationSort)}>
          <option value="recommended">推荐顺序</option><option value="newest">最新发表</option><option value="citations">引用最多</option>
        </Select>
        <Select aria-label="推荐发表年份" value={year} onChange={(event) => setYear(event.target.value)}>
          <option value="">全部年份</option>{years.map((value) => <option key={value}>{value}</option>)}
          {year && !years.includes(year) ? <option value={year}>{year}</option> : null}
        </Select>
      </div>
      <div className="recommendation-filter-row">
        <Checkbox label="可获取全文" checked={access} onChange={(_, data) => setAccess(data.checked === true)} />
        <span className="recommendation-result-count" aria-live="polite">{visible.length} / {items.length} 篇</span>
      </div>
    </div>
    <p className="recommendation-interaction-hint">单击查看底栏信息 · 双击打开论文详情</p>
    {fullText.pending > 0 ? <p role="status" className="recommendation-interaction-hint">正在查找开放全文 · 剩余 {fullText.pending} 篇</p> : null}
    {fullText.failed > 0 ? <p role="status" className="recommendation-interaction-hint">{fullText.failed} 篇的全文来源暂不可用。<Button size="small" appearance="subtle" onClick={fullText.retry}>重试全文查询</Button></p> : null}
    {!visible.length && !fullText.pending ? <div className="recommendation-no-results"><p>{access ? "暂未发现符合筛选条件的全文链接；未收录链接不代表论文没有 PDF，可打开详情继续查找。" : "没有符合条件的论文。"}</p>
      <Button appearance="subtle" onClick={() => { setQuery(""); setYear(""); setAccess(false); }}>清除筛选</Button></div> : null}
    <ul className="recommendation-compact-list" aria-label="推荐论文">
      {visible.map((item) => <li key={item.id} className={`recommendation-compact-item${selectedId === item.id ? " selected" : ""}`}>
        <button type="button" className="recommendation-compact-row" aria-label={`查看推荐 ${item.title}`}
          aria-pressed={selectedId === item.id} aria-busy={pendingIds.includes(item.id)}
          title={`${item.title}\n单击查看元信息，双击打开论文详情`}
          draggable onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("application/x-liteasy-library-resource-v2", JSON.stringify({ area: "recommendation", recommendation: item }));
          }}
          onClick={() => onInspect?.(item)} onDoubleClick={() => onOpen?.(item)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onOpen?.(item); } }}>
          <DocumentRegular aria-hidden="true" />
          <span className="recommendation-row-content">
            <span className="recommendation-compact-title">{item.title}</span>
            <span className="recommendation-row-authors">{item.authors?.slice(0, 2).join(" · ") || item.source}{item.authors && item.authors.length > 2 ? " 等" : ""}</span>
            <span className="recommendation-row-meta"><time>{recommendationDateLabel(item)}</time>
              {item.venue ? <span className="recommendation-venue">{item.venue}</span> : null}
              {item.openAccessAvailable || item.openAccessPdfUrl ? <span className="recommendation-access-label">全文</span> : null}
            </span>
          </span>
        </button>
        <div className="recommendation-compact-actions">
          <Tooltip content="收藏" relationship="label"><Button appearance="subtle" size="small" aria-label={`收藏 ${item.title}`} disabled={!canSave || pendingIds.includes(item.id)} icon={<BookmarkRegular />} onClick={() => onSave(item)} /></Tooltip>
          <Tooltip content="不感兴趣" relationship="label"><Button appearance="subtle" size="small" aria-label={`忽略 ${item.title}`} icon={<DeleteRegular />} onClick={() => onDismiss(item)} /></Tooltip>
        </div>
      </li>)}
    </ul>
  </div>;
}
