import { OptionPicker } from "../../shared/ui/productPrimitives";
import { displayBibliographicTitle } from "../metadata/displayBibliographicTitle";
import { IconAction, SourceDisclosure } from "../../shared/ui/productPrimitives";
import { SearchOptions, SearchHighlight } from "../search/SearchOptions";
import { writeAssetContextTransfer } from "../object-transfer/assetContextTransfer";
import { ResourceTagChips } from "../resource-tags/ResourceTagChips";
import { recommendationKeywords } from "./recommendationKeywords";
import { useRecommendationFullText } from "./useRecommendationFullText";
import type { PaperServiceConfig } from "../paper-services/paperServiceTransport";
import { useMemo, useState } from "react";
import { Button, Checkbox, Input, Tooltip, Popover, PopoverTrigger, PopoverSurface } from "@fluentui/react-components";
import { BookmarkRegular, DeleteRegular, DocumentRegular, SearchRegular, FilterRegular, OpenRegular } from "@fluentui/react-icons";
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterCount = Number(Boolean(query)) + Number(Boolean(year)) + Number(access) + Number(savedOnly) + Number(sort !== "recommended");
  const clearFilters = () => { setQuery(""); setYear(""); setAccess(false); setSavedOnly(false); setSort("recommended"); };
  const years = useMemo(() => [...new Set(items.map(recommendationDateLabel).filter((date) => /^\d{4}/.test(date)).map((date) => date.slice(0, 4)))].sort().reverse(), [items]);
  const fullText = useRecommendationFullText(items, access, service);
  const visible = useMemo(() => filterRecommendations(savedOnly ? fullText.items.filter((item) => item.saved) : fullText.items, query, access, year, sort), [fullText.items, query, access, year, sort, savedOnly]);
  return <div className="recommendation-browser">
    <div className="recommendation-filters">
      <Input aria-label="搜索推荐论文" placeholder="搜索标题、作者、主题" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => setQuery(data.value)} />
      <Popover open={filtersOpen} onOpenChange={(_, data) => setFiltersOpen(data.open)} positioning="below-end"><PopoverTrigger disableButtonEnhancement><Button size="small" icon={<FilterRegular />} aria-label="推荐筛选" aria-pressed={filterCount > 0}>筛选{filterCount ? ` · ${filterCount}` : ""}</Button></PopoverTrigger><PopoverSurface className="recommendation-filter-panel" aria-label="推荐筛选条件">
        <SearchOptions query={query} onChange={setQuery} tags={[...tags.values()].flatMap(items => items.map(tag => tag.label))} />
        <div className="recommendation-filter-row">
          <OptionPicker aria-label="推荐排序" value={String(sort ?? "")} onValueChange={nextValue => setSort(nextValue as RecommendationSort)} options={[{ value: String("recommended"), label: String("\u63A8\u8350\u987A\u5E8F") }, { value: String("newest"), label: String("\u6700\u65B0\u53D1\u8868") }, { value: String("citations"), label: String("\u5F15\u7528\u6700\u591A") }]} />
          <OptionPicker aria-label="推荐发表年份" value={String(year ?? "")} onValueChange={nextValue => setYear(nextValue)} options={[{ value: String(""), label: String("\u5168\u90E8\u5E74\u4EFD") }, ...(years.map(value => ({ value: String(value), label: String(value) }))), ...(year && !years.includes(year) ? [{ value: String(year), label: String(year) }] : [])]} />
        </div>
        <Checkbox label="可下载 PDF" checked={access} onChange={(_, data) => setAccess(data.checked === true)} />
        <Checkbox label="已收藏" checked={savedOnly} onChange={(_, data) => setSavedOnly(data.checked === true)} />
      </PopoverSurface></Popover>
    </div>
    <div className="recommendation-filter-summary"><span className="recommendation-result-count" aria-live="polite">{visible.length} / {items.length} 篇{filterCount ? ` · 已筛选 ${filterCount} 项` : ""}</span>{filterCount && visible.length > 0 ? <Button appearance="subtle" size="small" onClick={clearFilters}>清除筛选</Button> : null}</div>
    {fullText.pending > 0 ? <p role="status" className="recommendation-interaction-hint">正在查找开放全文 · 剩余 {fullText.pending} 篇</p> : null}
    {fullText.failed > 0 ? <p role="status" className="recommendation-interaction-hint">{fullText.failed} 篇的全文来源暂不可用。<Button size="small" appearance="subtle" onClick={fullText.retry}>重试全文查询</Button></p> : null}
    {access && fullText.unknown > 0 && !fullText.pending ? <p className="recommendation-interaction-hint">仍有 {fullText.unknown} 篇待检查。<Button appearance="subtle" size="small" onClick={fullText.checkMore}>继续检查全文</Button></p> : null}
    {!visible.length && !fullText.pending ? <div className="recommendation-no-results"><p>{access ? "暂未发现符合筛选条件的全文链接；未收录链接不代表论文没有 PDF，可打开详情继续查找。" : "没有符合条件的论文。"}</p>
      <Button appearance="subtle" onClick={clearFilters}>清除筛选</Button></div> : null}
    <ul className="recommendation-compact-list" aria-label="推荐论文">
      {visible.map((item) => { const displayTitle = displayBibliographicTitle(item.title) || "未提供题名"; return <li key={item.id} className={`recommendation-compact-item${selectedId === item.id ? " selected" : ""}`}>
        <Button appearance="transparent" type="button" className="recommendation-compact-row" aria-label={`查看推荐 ${displayTitle}`}
          aria-pressed={selectedId === item.id} aria-busy={pendingIds.includes(item.id)}
          title={`${displayTitle}\n单击查看元信息，双击打开论文详情`}
          draggable onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            if (item.resourcePath) {
              const scope = new URL(item.resourcePath).searchParams.get("scope");
              if (scope) writeAssetContextTransfer(event.dataTransfer, scope, { kind: "path", path: item.resourcePath }, displayTitle);
              return;
            }
            event.dataTransfer.setData("application/x-liteasy-library-resource-v2", JSON.stringify({ area: "recommendation", recommendation: item }));
          }}
          onClick={() => onInspect?.(item)} onDoubleClick={() => onOpen?.(item)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onOpen?.(item); } }}>
          <DocumentRegular aria-hidden="true" />
          <span className="recommendation-row-content">
            <span className="recommendation-title-line"><span className="recommendation-compact-title"><SearchHighlight text={displayTitle} query={query} /></span></span>

            <span className="recommendation-row-meta">
              <time>{recommendationDateLabel(item)}</time>
              {item.venue ? <span className="recommendation-venue">{item.venue}</span> : null}
              {item.fullText?.status === "available" ? <span className="recommendation-access-label">PDF 已验证</span> : null}
            </span>
          </span>
        </Button>
        <SourceDisclosure summary="推荐详情"><p>{displayTitle}</p><p>{item.reason?.trim() || "未提供个别推荐理由"}</p><ResourceTagChips tags={tags.get(item.id) ?? []} label={`${displayTitle} 的关键词`} onSelect={tag => setQuery(tag.label)} /></SourceDisclosure>

        <div className="recommendation-compact-actions">
          <IconAction density="compact" label={`打开详情 ${displayTitle}`} appearance="subtle" icon={<OpenRegular />} onClick={() => onOpen?.(item)} />
          <Tooltip content="收藏" relationship="label"><Button appearance="subtle" size="small" aria-label={`收藏 ${displayTitle}`} disabled={Boolean(item.resourcePath) || !canSave || pendingIds.includes(item.id)} icon={<BookmarkRegular />} onClick={() => onSave(item)} /></Tooltip>
          <Tooltip content="不感兴趣" relationship="label"><Button appearance="subtle" size="small" aria-label={`忽略 ${displayTitle}`} icon={<DeleteRegular />} onClick={() => onDismiss(item)} /></Tooltip>
        </div>
      </li>; })}
    </ul>
  </div>;
}
