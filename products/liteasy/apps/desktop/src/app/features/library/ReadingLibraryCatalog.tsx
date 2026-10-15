import { ActionButton as Button, ControlToolbar, FilterPopover, OptionPicker } from "../../shared/ui/productPrimitives";
import { SearchOptions } from "../search/SearchOptions";
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { readingResourceCapabilities } from "../reading-library/readingResourceCapabilities";
import { Input, Tooltip } from "@fluentui/react-components";
import { AddRegular, ArrowLeftRegular, ArrowRightRegular, BookOpenRegular, DismissRegular, DocumentPdfRegular, DocumentTextRegular, SearchRegular } from "@fluentui/react-icons";
import { ReadingCatalogDetails, type ReadingCatalogActions } from "./ReadingCatalogDetails";
import { indexReadingCatalog, queryReadingCatalog, type ReadingCatalogFilters, type ReadingCatalogSort } from "./readingCatalogSearch";
import {
  readingCatalogFormatLabels, readingCatalogStatusLabels,
  type ReadingCatalogEntry, type ReadingCatalogFormat, type ReadingCatalogStatus
} from "./readingCatalog.types";
import "./readingCatalog.css";

export type ReadingLibraryCatalogProps = ReadingCatalogActions & {
  entries: ReadingCatalogEntry[];
  loading?: boolean;
  message?: string;
  onImport?: () => void | Promise<void>;
};

const pageSize = 50;
const defaultFilters: ReadingCatalogFilters = { query: "", format: "all", status: "all", collection: "", year: "", sort: "added" };

function FormatIcon({ format }: { format: ReadingCatalogFormat }) {
  return format === "pdf" ? <DocumentPdfRegular /> : format === "epub" ? <BookOpenRegular /> : <DocumentTextRegular />;
}

export function ReadingLibraryCatalog({ entries, loading = false, message, onImport, ...actions }: ReadingLibraryCatalogProps) {
  const [filters, setFilters] = useState(defaultFilters);
  const [selectedId, setSelectedId] = useState<string>();
  const [page, setPage] = useState(0);
  const [actionMessage, setActionMessage] = useState("");
  const deferredFilters = useDeferredValue(filters);
  const searchInput = useRef<HTMLInputElement>(null);
  const rowsElement = useRef<HTMLTableSectionElement>(null);
  const pendingFocus = useRef<string>();
  const index = useMemo(() => indexReadingCatalog(entries), [entries]);
  const results = useMemo(() => queryReadingCatalog(index, deferredFilters), [index, deferredFilters]);
  const collections = useMemo(() => [...new Set(entries.map((entry) => entry.collection).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "zh-CN")), [entries]);
  const years = useMemo(() => [...new Set(entries.flatMap((entry) => entry.year === undefined ? [] : [entry.year]))].sort((a, b) => b - a), [entries]);
  const pages = Math.max(1, Math.ceil(results.length / pageSize));
  const visiblePage = Math.min(page, pages - 1);
  const visibleEntries = results.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  const selected = results.find((entry) => entry.id === selectedId);
  const selectedOffset = visibleEntries.findIndex((entry) => entry.id === selectedId);
  const hasFilters = !!(filters.query || filters.format !== "all" || filters.status !== "all" || filters.collection || filters.year);

  useEffect(() => { setPage(0); }, [filters]);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = undefined;
    const offset = results.findIndex((entry) => entry.id === target) - visiblePage * pageSize;
    if (offset < 0 || offset >= pageSize) return;
    const row = rowsElement.current?.rows.item(offset);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId, visiblePage, results]);

  function updateFilter<K extends keyof ReadingCatalogFilters>(key: K, value: ReadingCatalogFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function open(entry: ReadingCatalogEntry) {
    const capability = readingResourceCapabilities(entry).operations.open;
    if (!capability.available) { setActionMessage(capability.reason); return; }
    setActionMessage("");
    try { await actions.onOpen(entry); }
    catch (error) { setActionMessage(error instanceof Error ? error.message : "无法打开文件，请重试。"); }
  }

  function navigateRows(event: KeyboardEvent<HTMLTableRowElement>, offset: number) {
    if (event.nativeEvent.isComposing || event.altKey || event.target !== event.currentTarget) return;
    if (event.key === "Enter") { event.preventDefault(); void open(visibleEntries[offset]); return; }
    if (event.key === " ") { event.preventDefault(); setSelectedId(visibleEntries[offset].id); return; }
    const current = visiblePage * pageSize + offset;
    const requested = event.key === "ArrowDown" ? current + 1
      : event.key === "ArrowUp" ? current - 1
        : event.key === "Home" ? 0 : event.key === "End" ? results.length - 1
          : event.key === "PageDown" ? current + pageSize : event.key === "PageUp" ? current - pageSize : undefined;
    if (requested === undefined || !results.length) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(results.length - 1, requested));
    pendingFocus.current = results[next].id;
    setPage(Math.floor(next / pageSize));
    setSelectedId(results[next].id);
  }

  return <section className="reading-catalog" aria-label="阅读库">
    <header className="reading-catalog-heading">
      <div><h2>阅读库</h2><p>论文、书籍与笔记，在一处查找和阅读。</p></div>
      {onImport ? <Button appearance="primary" icon={<AddRegular />} disabled={loading} onClick={() => {
        void Promise.resolve().then(onImport).catch((error: unknown) => setActionMessage(error instanceof Error ? error.message : "导入未完成，请重试。"));
      }}>导入文件</Button> : null}
    </header>
    <ControlToolbar className="reading-catalog-controls" role="search" label="筛查阅读库">
      <Input ref={searchInput} className="reading-catalog-search" aria-label="搜索文献与文件" placeholder="搜索文献与文件" contentBefore={<SearchRegular />} value={filters.query} onChange={(_, data) => updateFilter("query", data.value)} contentAfter={filters.query ? <Tooltip content="清空搜索" relationship="description"><Button appearance="transparent" size="small" icon={<DismissRegular />} aria-label="清空搜索" onClick={() => { updateFilter("query", ""); searchInput.current?.focus(); }} /></Tooltip> : undefined} />
      <SearchOptions query={filters.query} onChange={(value) => updateFilter("query", value)} tags={entries.flatMap((entry) => entry.tags ?? [])} />
      <FilterPopover label="文件筛选" activeCount={[filters.format !== "all", filters.status !== "all", !!filters.collection, !!filters.year].filter(Boolean).length}>
        <label>文件格式<OptionPicker aria-label="筛选文件格式" value={filters.format} onValueChange={value => updateFilter("format", value as ReadingCatalogFormat | "all")} options={[{ value: "all", label: "全部格式" }, ...Object.entries(readingCatalogFormatLabels).map(([value, label]) => ({ value, label }))]} /></label>
        <label>阅读状态<OptionPicker aria-label="筛选阅读状态" value={filters.status} onValueChange={value => updateFilter("status", value as ReadingCatalogStatus | "all")} options={[{ value: "all", label: "全部阅读状态" }, ...Object.entries(readingCatalogStatusLabels).map(([value, label]) => ({ value, label }))]} /></label>
        <label>分类<OptionPicker aria-label="筛选分类" value={filters.collection} onValueChange={value => updateFilter("collection", value)} options={[{ value: "", label: "全部分类" }, ...collections.map(value => ({ value, label: value }))]} /></label>
        <label>发表年份<OptionPicker aria-label="筛选发表年份" value={filters.year} onValueChange={value => updateFilter("year", value)} options={[{ value: "", label: "全部年份" }, ...years.map(value => ({ value: String(value), label: String(value) })), { value: "unknown", label: "年份未提供" }]} /></label>
      </FilterPopover>
      <OptionPicker density="compact" aria-label="文件排序" value={filters.sort} onValueChange={value => updateFilter("sort", value as ReadingCatalogSort)} options={[{ value: "added", label: "最近添加" }, { value: "title", label: "标题 A–Z" }, { value: "author", label: "作者 A–Z" }, { value: "year-desc", label: "发表时间：新到旧" }, { value: "year-asc", label: "发表时间：旧到新" }]} />
      {hasFilters ? <Button appearance="subtle" onClick={() => setFilters(defaultFilters)}>重置筛选</Button> : null}
    </ControlToolbar>
    <div className="reading-catalog-summary"><span aria-live="polite">{loading ? "正在读取文件库…" : `${results.length} / ${entries.length} 项`}</span><span>单击查看信息 · 双击或 Enter 阅读</span></div>
    {message || actionMessage ? <p className="reading-catalog-message" role="status">{actionMessage || message}</p> : null}
    <div className="reading-catalog-body">
      <div className="reading-catalog-list">
        <div className="reading-catalog-table-scroll" aria-busy={loading || deferredFilters !== filters}>
          <table className="reading-catalog-table" aria-label="文献与文件列表">
            <thead><tr><th scope="col">标题与作者</th><th scope="col">年份</th><th scope="col">格式</th><th scope="col">状态</th></tr></thead>
            <tbody ref={rowsElement}>{visibleEntries.map((entry, offset) => <tr
              key={entry.id} className={entry.id === selected?.id ? "is-selected" : undefined}
              tabIndex={offset === selectedOffset || (selectedOffset < 0 && offset === 0) ? 0 : -1}
              aria-selected={entry.id === selected?.id} onClick={() => setSelectedId(entry.id)} onFocus={() => setSelectedId(entry.id)}
              onDoubleClick={() => void open(entry)} onKeyDown={(event) => navigateRows(event, offset)}
              data-reading-entry={entry.format !== "other" ? "true" : undefined}
            >
              <td><div className="reading-catalog-row-main"><span className="reading-catalog-format-icon" aria-hidden="true"><FormatIcon format={entry.format} /></span><div>
                <strong>{entry.title}</strong><span className="reading-catalog-authors">{entry.authors?.join(" · ") || entry.fileName || "作者未提供"}</span>
                {(entry.tags?.length || entry.collection) ? <span className="reading-catalog-row-tags">{[entry.collection, ...(entry.tags ?? [])].filter(Boolean).join(" · ")}</span> : null}
              </div></div></td>
              <td>{entry.year ?? "—"}</td><td>{readingCatalogFormatLabels[entry.format]}</td><td><span className="reading-catalog-status">{readingCatalogStatusLabels[entry.readingStatus ?? "unread"]}</span>{entry.available === false ? <span className="reading-catalog-unavailable">正文不可用</span> : null}</td>
            </tr>)}</tbody>
          </table>
          {!visibleEntries.length && !loading ? <div className="reading-catalog-empty"><BookOpenRegular /><h3>{entries.length ? "没有符合条件的文件" : "从一篇论文或一本书开始"}</h3><p>{entries.length ? "尝试缩短关键词，或清除部分筛选条件。" : "导入 PDF、EPUB、Markdown 或 TXT，建立你的阅读库。"}</p>{hasFilters ? <Button onClick={() => setFilters(defaultFilters)}>清除筛选</Button> : null}</div> : null}
        </div>
        <nav className="reading-catalog-pagination" aria-label="文件列表分页">
          <Button icon={<ArrowLeftRegular />} aria-label="上一页文件" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>上一页</Button>
          <span>第 {visiblePage + 1} / {pages} 页 · 每页 {pageSize} 项</span>
          <Button icon={<ArrowRightRegular />} iconPosition="after" aria-label="下一页文件" disabled={visiblePage >= pages - 1} onClick={() => setPage(visiblePage + 1)}>下一页</Button>
        </nav>
      </div>
      {selected ? <ReadingCatalogDetails key={selected.id} entry={selected} {...actions} /> : <aside className="reading-catalog-details reading-catalog-details-empty" aria-label="文件元信息"><BookOpenRegular /><h3>查看元信息</h3><p>选择一个文件，查看作者、发表信息、摘要与实际位置，并整理标签和阅读状态。</p></aside>}
    </div>
  </section>;
}
