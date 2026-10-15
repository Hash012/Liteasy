import { recommendationReasonText } from "./recommendationReasonPresentation";
import type { FeedbackReceipt, FeedbackRequest } from "./recommendationFeedbackProjection";
import type { RecommendationFeedbackHandler } from "./recommendationFeedbackProjection";
import type { RecommendationFeedbackMeaning } from "./recommendationCoordinator";
import { useRecommendationExposure } from "./useRecommendationExposure";
import { useRecommendationPreferences } from "./recommendationPreferences";
import { composeSlate, canonicalCandidate } from "../../../../../../packages/recommendation-core/v2.mjs";
import { OptionPicker } from "../../shared/ui/productPrimitives";
import { displayBibliographicTitle } from "../metadata/displayBibliographicTitle";
import { IconAction, SourceDisclosure } from "../../shared/ui/productPrimitives";
import { SearchOptions, SearchHighlight } from "../search/SearchOptions";
import { writeAssetContextTransfer } from "../object-transfer/assetContextTransfer";
import { ResourceTagChips } from "../resource-tags/ResourceTagChips";
import { recommendationKeywords } from "./recommendationKeywords";
import { useRecommendationFullText } from "./useRecommendationFullText";
import type { PaperServiceConfig } from "../paper-services/paperServiceTransport";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Input, Popover, PopoverTrigger, PopoverSurface, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem, MenuItemCheckbox, MenuDivider } from "@fluentui/react-components";
import { BookmarkRegular, DeleteRegular, DocumentRegular, SearchRegular, FilterRegular, OpenRegular, MoreHorizontalRegular, ArrowClockwiseRegular } from "@fluentui/react-icons";
import type { RecommendationItem } from "./recommendation.types";
import { filterRecommendations, recommendationDateLabel, type RecommendationSort } from "./recommendationPresentation";
import "./recommendationList.css";

export { recommendationDateLabel } from "./recommendationPresentation";

export function RecommendationList({ items, service, selectedId, pendingIds, canSave, onInspect, onOpen, onSave, onDismiss, onAdoptBrief, onFeedback, onCurate, onRestore, onApplyPreferences, busy, onRefresh, menuActions, filterOptions, emptyMessage }: {
  onRefresh?: () => void;
  menuActions?: ReactNode;
  filterOptions?: ReactNode;
  emptyMessage?: string;
  items: RecommendationItem[];
  onCurate?: (item?: RecommendationItem) => Promise<void>;
  onRestore?: () => Promise<void>;
  onApplyPreferences?: () => Promise<void>;
  busy?: boolean;
  onFeedback?: RecommendationFeedbackHandler;
  onAdoptBrief?: (item: RecommendationItem) => Promise<unknown>;
  service?: PaperServiceConfig;
  selectedId?: string;
  pendingIds: string[];
  canSave: boolean;
  onInspect?: (item: RecommendationItem) => void;
  onOpen?: (item: RecommendationItem) => void;
  onSave: (item: RecommendationItem) => void;
  onDismiss: (item: RecommendationItem) => void;
}) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const root = useRef<HTMLDivElement>(null);
  const exposure = useRecommendationExposure(root, items);
  const preferences = useRecommendationPreferences();
  const tags = useMemo(() => new Map(items.map((item) => [item.id, recommendationKeywords(item, items)])), [items]);
  const [lastFeedback, setLastFeedback] = useState<{ item: RecommendationItem; receipt: FeedbackReceipt }>();
  const [feedbackRows, setFeedbackRows] = useState<Record<string, { state: "pending" | "committed" | "failed"; action: RecommendationFeedbackMeaning; command: FeedbackRequest; receipt?: FeedbackReceipt; message: string }>>({});
  const pendingFeedback = useRef(new Set<string>());
  async function submitFeedback(item: RecommendationItem, action: RecommendationFeedbackMeaning, retry?: FeedbackRequest) {
    if (!onFeedback || pendingFeedback.current.has(item.id)) return;
    const command = retry ?? { commandId: crypto.randomUUID(), issuedAt: Date.now(), ...(action === "undo" ? { targetEventId: lastFeedback?.receipt.eventId } : {}) };
    pendingFeedback.current.add(item.id);
    setFeedbackRows(rows => ({ ...rows, [item.id]: { state: "pending", action, command, message: "正在保存…" } }));
    try {
      const receipt = await onFeedback(item, action, command);
      if (!mounted.current) return;
      if (!receipt?.eventId) throw new Error("未收到保存回执，请重试。");
      const labels = { read: "已读", snoozed: "已暂缓 7 天", not_relevant: "已在此课题隐藏", too_basic: "太基础 · 已用于下次精选", too_advanced: "太难 · 已用于下次精选", undo: "已撤销这次反馈" };
      setFeedbackRows(rows => ({ ...rows, [item.id]: { state: "committed", action, command, receipt, message: labels[action] } }));
      setLastFeedback(action === "undo" ? undefined : { item, receipt }); setNotice(labels[action]);
    } catch {
      if (!mounted.current) return;
      setFeedbackRows(rows => ({ ...rows, [item.id]: { state: "failed", action, command, message: "反馈未保存，请重试。" } }));
    } finally { pendingFeedback.current.delete(item.id); }
  }
  const [notice, setNotice] = useState("");
  const [explore, setExplore] = useState(false);
  const [page, setPage] = useState(0);
  const [seen, setSeen] = useState<string[]>([]);
  const lastVisibleSnapshot = useRef(items[0]?.feedSnapshotId);
  useEffect(() => {
    const snapshot = items[0]?.feedSnapshotId;
    if (!snapshot || snapshot === lastVisibleSnapshot.current) return;
    lastVisibleSnapshot.current = snapshot;
    setSeen([]); setPage(0);
  }, [items[0]?.feedSnapshotId]);
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  const [savedOnly, setSavedOnly] = useState(false);
  const [access, setAccess] = useState(false);
  const [checkFullText, setCheckFullText] = useState(false);
  const [sort, setSort] = useState<RecommendationSort>("recommended");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterCount = Number(Boolean(query)) + Number(Boolean(year)) + Number(access) + Number(savedOnly) + Number(sort !== "recommended");
  const clearFilters = () => { setQuery(""); setYear(""); setAccess(false); setCheckFullText(false); setSavedOnly(false); setSort("recommended"); };
  const years = useMemo(() => [...new Set(items.map(recommendationDateLabel).filter((date) => /^\d{4}/.test(date)).map((date) => date.slice(0, 4)))].sort().reverse(), [items]);
  const fullText = useRecommendationFullText(items, access && checkFullText, service);
  const filtered = useMemo(() => filterRecommendations(savedOnly ? fullText.items.filter((item) => item.saved) : fullText.items, query, access, year, sort), [fullText.items, query, access, year, sort, savedOnly]);
  const slate = useMemo(() => sort === "recommended" ? composeSlate(filtered, { count: preferences.feed.displayCount, preserveOrder: true, excluded: seen, exposure: exposure.exposure.current, topicExposure: exposure.topicExposure.current }) : filtered.filter(item => (item.scoreComponents?.finalScore ?? item.relevanceScore) >= .15 && !seen.includes(canonicalCandidate(item))).slice(0, preferences.feed.displayCount), [filtered, seen, preferences.feed.displayCount, sort]);
  const anchor = useRef<{ key: string; rows: RecommendationItem[] }>();
  const snapshot = useRef(items[0]?.feedSnapshotId);
  if (items[0]?.feedSnapshotId) snapshot.current = items[0].feedSnapshotId;
  const anchorKey = JSON.stringify([snapshot.current, explore, page, seen, query, year, savedOnly, access, checkFullText, sort, preferences.feed.displayCount]);
  const nextVisible = explore ? filtered.slice(page * 12, (page + 1) * 12) : slate;
  const retainSlots = Object.values(feedbackRows).some(row => row.state === "pending" || row.state === "committed" && ["read", "snoozed", "not_relevant"].includes(row.action));
  if (!anchor.current || anchor.current.key !== anchorKey || !retainSlots) anchor.current = { key: anchorKey, rows: nextVisible };
  const visible = anchor.current.rows.flatMap(old => { const current = filtered.find(row => row.id === old.id); return current ? [current] : feedbackRows[old.id] ? [old] : []; });
  return <div ref={root} className="recommendation-browser">
    {notice ? <p role="status" className="recommendation-notice">{notice}{lastFeedback && onFeedback ? <Button size="small" appearance="subtle" onClick={() => { void submitFeedback(lastFeedback.item, "undo"); }}>撤销反馈</Button> : null}</p> : null}
    <div className="recommendation-toolbar" role="group" aria-label="推荐操作">
      {onCurate ? <Button size="small" disabled={busy} onClick={() => void onCurate()}>AI 精选</Button> : null}
      {onRefresh ? <IconAction density="compact" label="检查新论文" disabled={busy} appearance="subtle" icon={<ArrowClockwiseRegular />} onClick={onRefresh} /> : null}
      <Menu><MenuTrigger disableButtonEnhancement><IconAction density="compact" label="更多推荐操作" appearance="subtle" icon={<MoreHorizontalRegular />} /></MenuTrigger><MenuPopover className="recommendation-menu"><MenuList>
        {!explore ? <MenuItem disabled={!filtered.length} onClick={() => { const next = [...seen, ...slate.map(canonicalCandidate)]; setSeen(composeSlate(filtered, { excluded: next }).length ? next : []); }}>换一组</MenuItem> : null}
        <MenuItem onClick={() => { setExplore(!explore); setPage(0); }}>{explore ? "返回精选" : `查看更多候选 · ${items.length}`}</MenuItem>
        {onRestore ? <MenuItem onClick={() => void onRestore()}>返回原组</MenuItem> : null}
        {onApplyPreferences ? <MenuItem onClick={() => void onApplyPreferences()}>应用反馈</MenuItem> : null}
        {menuActions ? <><MenuDivider />{menuActions}</> : null}
      </MenuList></MenuPopover></Menu>
    </div>
    <div className="recommendation-filters">
      <Input aria-label="搜索推荐论文" placeholder="搜索标题、作者、主题" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => { setQuery(data.value); setPage(0); }} />
      <Popover open={filtersOpen} onOpenChange={(_, data) => setFiltersOpen(data.open)} positioning="below-end"><PopoverTrigger disableButtonEnhancement><Button size="small" icon={<FilterRegular />} aria-label="推荐筛选" aria-pressed={filterCount > 0}>筛选{filterCount ? ` · ${filterCount}` : ""}</Button></PopoverTrigger><PopoverSurface className="recommendation-filter-panel" aria-label="推荐筛选条件">
        {filterOptions}
        <SearchOptions query={query} onChange={setQuery} tags={[...tags.values()].flatMap(items => items.map(tag => tag.label))} />
        <div className="recommendation-filter-row">
          <OptionPicker aria-label="推荐排序" value={String(sort ?? "")} onValueChange={nextValue => setSort(nextValue as RecommendationSort)} options={[{ value: String("recommended"), label: String("\u63A8\u8350\u987A\u5E8F") }, { value: String("newest"), label: String("\u6700\u65B0\u53D1\u8868") }, { value: String("citations"), label: String("\u5F15\u7528\u6700\u591A") }]} />
          <OptionPicker aria-label="推荐发表年份" value={String(year ?? "")} onValueChange={nextValue => setYear(nextValue)} options={[{ value: String(""), label: String("\u5168\u90E8\u5E74\u4EFD") }, ...(years.map(value => ({ value: String(value), label: String(value) }))), ...(year && !years.includes(year) ? [{ value: String(year), label: String(year) }] : [])]} />
        </div>
        <Checkbox label="可下载 PDF" checked={access} onChange={(_, data) => { setAccess(data.checked === true); if (!data.checked) setCheckFullText(false); }} />
        <Checkbox label="已收藏" checked={savedOnly} onChange={(_, data) => setSavedOnly(data.checked === true)} />
      </PopoverSurface></Popover>
    </div>
    <div className="recommendation-filter-summary"><span className="recommendation-result-count" aria-live="polite">{visible.length} / {items.length} 篇{filterCount ? ` · 已筛选 ${filterCount} 项` : ""}</span>{filterCount && visible.length > 0 ? <Button appearance="subtle" size="small" onClick={clearFilters}>清除筛选</Button> : null}</div>
    {explore ? <div className="recommendation-pagination" aria-label="候选分页"><Button appearance="subtle" size="small" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一页</Button><span>第 {page + 1} 页</span><Button appearance="subtle" size="small" disabled={(page + 1) * 12 >= filtered.length} onClick={() => setPage(value => value + 1)}>下一页</Button></div> : null}
    {fullText.pending > 0 ? <p role="status" className="recommendation-interaction-hint">正在查找开放全文 · 剩余 {fullText.pending} 篇</p> : null}
    {fullText.failed > 0 ? <p role="status" className="recommendation-interaction-hint">{fullText.failed} 篇的全文来源暂不可用。<Button size="small" appearance="subtle" onClick={fullText.retry}>重试全文查询</Button></p> : null}
    {access && fullText.unknown > 0 && !fullText.pending ? <p className="recommendation-interaction-hint">仍有 {fullText.unknown} 篇待检查。<Button appearance="subtle" size="small" onClick={() => { setCheckFullText(true); if (checkFullText) fullText.checkMore(); }}>{checkFullText ? "继续检查全文" : "检查全文链接"}</Button></p> : null}
    {!visible.length && !fullText.pending && !busy ? <div className="recommendation-no-results"><p>{access ? "暂未发现符合筛选条件的全文链接；未收录链接不代表论文没有 PDF，可打开详情继续查找。" : !items.length ? emptyMessage || "暂无关联推荐" : "没有符合条件的论文。"}</p>
      {filterCount ? <Button appearance="subtle" onClick={clearFilters}>清除筛选</Button> : null}</div> : null}
    <ul className="recommendation-compact-list" aria-label="推荐论文">
      {visible.map((item) => { const row = feedbackRows[item.id];
        if (row?.state === "committed" && ["read", "snoozed", "not_relevant"].includes(row.action)) return <li key={item.id} className="recommendation-compact-item" aria-label="已处理的推荐"><p role="status">{row.message}</p><Button size="small" appearance="subtle" onClick={() => void submitFeedback(item, "undo", { commandId: crypto.randomUUID(), issuedAt: Date.now(), targetEventId: row.receipt!.eventId })}>撤销此操作</Button></li>;
        const displayTitle = displayBibliographicTitle(item.title) || "未提供题名"; return <li key={item.id} data-candidate-id={item.id} className={`recommendation-compact-item${selectedId === item.id ? " selected" : ""}`}>
        <div className="recommendation-item-heading"><Button appearance="transparent" type="button" className="recommendation-compact-row" aria-label={`查看推荐 ${displayTitle}`}
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
              {item.authors?.length ? <span className="recommendation-row-authors" title={item.authors.join("、")}>{item.authors.length > 2 ? `${item.authors[0]} 等 ${item.authors.length} 位作者` : item.authors.join("、")}</span> : null}
              <time>{recommendationDateLabel(item)}</time>
              {item.venue ? <span className="recommendation-venue">{item.venue}</span> : null}
              {item.fullText?.status === "available" ? <span className="recommendation-access-label">PDF 已验证</span> : null}
            </span>
          </span>
        </Button>
        <Menu checkedValues={{ feedback: (["read", "snoozed", "too_basic", "too_advanced"] as const).filter(action => item.feedbackState?.some(value => value.action === action) || row?.state === "committed" && row.action === action) }}><MenuTrigger disableButtonEnhancement>
          <IconAction density="compact" label={`推荐操作 ${displayTitle}`} appearance="subtle" icon={<MoreHorizontalRegular />} />
        </MenuTrigger><MenuPopover className="recommendation-menu"><MenuList>
          {onOpen ? <MenuItem icon={<OpenRegular />} onClick={() => onOpen(item)}>打开论文详情</MenuItem> : null}
          <MenuItem icon={<BookmarkRegular />} disabled={Boolean(item.resourcePath) || !canSave || pendingIds.includes(item.id)} onClick={() => onSave(item)}>{item.saved || item.resourcePath ? "已收藏" : "收藏论文"}</MenuItem>
          {onCurate ? <MenuItem disabled={busy} onClick={() => void onCurate(item)}>解释为什么推荐</MenuItem> : null}
          {item.researchReason && onAdoptBrief ? <MenuItem onClick={() => { void onAdoptBrief(item).then(() => setNotice("研究建议已保存为笔记。"), () => setNotice("研究建议暂未保存，请重试。")); }}>采用为研究笔记</MenuItem> : null}
          <MenuDivider />
          {onFeedback ? ([["read", "已读"], ["snoozed", "稍后看"], ["too_basic", "太基础"], ["too_advanced", "太难"]] as const).map(([action, label]) => <MenuItemCheckbox key={action} persistOnClick={false} name="feedback" value={action} disabled={row?.state === "pending"} onClick={() => void submitFeedback(item, action)}>{label}</MenuItemCheckbox>) : null}
          <MenuItem icon={<DeleteRegular />} disabled={row?.state === "pending"} onClick={() => { if (onFeedback) void submitFeedback(item, "not_relevant"); else onDismiss(item); }}>不感兴趣</MenuItem>
        </MenuList></MenuPopover></Menu></div>
        <p className="recommendation-reason">{recommendationReasonText(item)}</p>
        <SourceDisclosure summary="推荐详情">
          {item.researchReason?.evaluatedCount ? <p>本次评估 {item.researchReason.evaluatedCount} / {item.researchReason.poolCount} 篇候选。</p> : null}
          {item.reasonState === "grounded" && item.researchReason ? <>
            <p>依据：{item.researchReason.basis === "abstract" ? "论文摘要" : item.researchReason.basis === "introduction" ? "论文引言节选" : item.researchReason.basis === "abstract_and_introduction" ? "论文摘要与引言节选" : "题录信息"}与已授权资料；研究关系仍需阅读核实。</p>
            {item.researchReason.limitation ? <p>局限：{item.researchReason.limitation}</p> : null}
          </> : <p>当前匹配依据来自题录与已提供的信息。</p>}
          <ResourceTagChips tags={tags.get(item.id) ?? []} label={`${displayTitle} 的关键词`} onSelect={tag => setQuery(tag.label)} />
        </SourceDisclosure>
        {row && row.state !== "committed" ? <p role="status" className="recommendation-row-status">{row.message}{row.state === "failed" ? <Button size="small" onClick={() => void submitFeedback(item, row.action, row.command)}>重试保存反馈</Button> : null}</p> : null}
      </li>; })}
    </ul>
  </div>;
}
