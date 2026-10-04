import { SearchOptions, SearchHighlight } from "../search/SearchOptions";
import { writeAssetContextTransfer } from "../object-transfer/assetContextTransfer";
import { ResourceTagChips } from "../resource-tags/ResourceTagChips";
import { recommendationKeywords } from "./recommendationKeywords";
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
  const tags = useMemo(() => new Map(items.map((item) => [item.id, recommendationKeywords(item, items)])), [items]);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [access, setAccess] = useState(false);
  const [sort, setSort] = useState<RecommendationSort>("recommended");
  const years = useMemo(() => [...new Set(items.map(recommendationDateLabel).filter((date) => /^\d{4}/.test(date)).map((date) => date.slice(0, 4)))].sort().reverse(), [items]);
  const fullText = useRecommendationFullText(items, access, service);
  const visible = useMemo(() => filterRecommendations(savedOnly ? fullText.items.filter((item) => item.saved) : fullText.items, query, access, year, sort), [fullText.items, query, access, year, sort, savedOnly]);
  return <div className="recommendation-browser">
    <div className="recommendation-filters">
      <Input aria-label="搜索推荐论文" placeholder="搜索标题、作者、主题" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => setQuery(data.value)} />
      <SearchOptions query={query} onChange={setQuery} tags={[...tags.values()].flatMap((items) => items.map((tag) => tag.label))} />
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
        <Checkbox label="可下载 PDF" checked={access} onChange={(_, data) => setAccess(data.checked === true)} />
        <Checkbox label="已收藏" checked={savedOnly} onChange={(_, data) => setSavedOnly(data.checked === true)} />
        <span className="recommendation-result-count" aria-live="polite">{visible.length} / {items.length} 篇</span>
      </div>
    </div>
    {visible.length > 0 && (query || year || access || savedOnly) ? <Button appearance="subtle" size="small" onClick={() => { setQuery(""); setYear(""); setAccess(false); setSavedOnly(false); }}>清除筛选</Button> : null}
    <p className="recommendation-interaction-hint">单击查看底栏信息 · 双击打开论文详情</p>
    {fullText.pending > 0 ? <p role="status" className="recommendation-interaction-hint">正在查找开放全文 · 剩余 {fullText.pending} 篇</p> : null}
    {fullText.failed > 0 ? <p role="status" className="recommendation-interaction-hint">{fullText.failed} 篇的全文来源暂不可用。<Button size="small" appearance="subtle" onClick={fullText.retry}>重试全文查询</Button></p> : null}
    {access && fullText.unknown > 0 && !fullText.pending ? <p className="recommendation-interaction-hint">仍有 {fullText.unknown} 篇待检查。<Button appearance="subtle" size="small" onClick={fullText.checkMore}>继续检查全文</Button></p> : null}
    {!visible.length && !fullText.pending ? <div className="recommendation-no-results"><p>{access ? "暂未发现符合筛选条件的全文链接；未收录链接不代表论文没有 PDF，可打开详情继续查找。" : "没有符合条件的论文。"}</p>
      <Button appearance="subtle" onClick={() => { setQuery(""); setYear(""); setAccess(false); setSavedOnly(false); }}>清除筛选</Button></div> : null}
    <ul className="recommendation-compact-list" aria-label="推荐论文">
      {visible.map((item) => <li key={item.id} className={`recommendation-compact-item${selectedId === item.id ? " selected" : ""}`}>
        <button type="button" className="recommendation-compact-row" aria-label={`查看推荐 ${item.title}`}
          aria-pressed={selectedId === item.id} aria-busy={pendingIds.includes(item.id)}
          title={`${item.title}\n单击查看元信息，双击打开论文详情`}
          draggable onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            if (item.resourcePath) {
              const scope = new URL(item.resourcePath).searchParams.get("scope");
              if (scope) writeAssetContextTransfer(event.dataTransfer, scope, { kind: "path", path: item.resourcePath }, item.title);
              return;
            }
            event.dataTransfer.setData("application/x-liteasy-library-resource-v2", JSON.stringify({ area: "recommendation", recommendation: item }));
          }}
          onClick={() => onInspect?.(item)} onDoubleClick={() => onOpen?.(item)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onOpen?.(item); } }}>
          <DocumentRegular aria-hidden="true" />
          <span className="recommendation-row-content">
            <span className="recommendation-title-line"><span className="recommendation-compact-title"><SearchHighlight text={item.title} query={query} /></span><time>{recommendationDateLabel(item)}</time></span>
            <span className="recommendation-row-meta">
              {item.venue ? <span className="recommendation-venue">{item.venue}</span> : null}
              {item.fullText?.status === "available" ? <span className="recommendation-access-label">PDF 已验证</span> : null}
            </span>
          </span>
        </button>
        <div className="recommendation-keywords"><ResourceTagChips tags={tags.get(item.id) ?? []} label={`${item.title} 的关键词`} onSelect={(tag) => setQuery(tag.label)} /></div>
        <div className="recommendation-compact-actions">
          <Tooltip content="收藏" relationship="label"><Button appearance="subtle" size="small" aria-label={`收藏 ${item.title}`} disabled={Boolean(item.resourcePath) || !canSave || pendingIds.includes(item.id)} icon={<BookmarkRegular />} onClick={() => onSave(item)} /></Tooltip>
          <Tooltip content="不感兴趣" relationship="label"><Button appearance="subtle" size="small" aria-label={`忽略 ${item.title}`} icon={<DeleteRegular />} onClick={() => onDismiss(item)} /></Tooltip>
        </div>
      </li>)}
    </ul>
  </div>;
}
