import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, Input, Select, Tooltip } from "@fluentui/react-components";
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
  const index = useMemo(() => indexReadingCatalog(entries), [entries]);
  const results = useMemo(() => queryReadingCatalog(index, deferredFilters), [index, deferredFilters]);
  const collections = useMemo(() => [...new Set(entries.map((entry) => entry.collection).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "zh-CN")), [entries]);
  const years = useMemo(() => [...new Set(entries.flatMap((entry) => entry.year === undefined ? [] : [entry.year]))].sort((a, b) => b - a), [entries]);
  const pages = Math.max(1, Math.ceil(results.length / pageSize));
  const visiblePage = Math.min(page, pages - 1);
  const visibleEntries = results.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  const selected = results.find((entry) => entry.id === selectedId);
  const hasFilters = !!(filters.query || filters.format !== "all" || filters.status !== "all" || filters.collection || filters.year);

  useEffect(() => { setPage(0); }, [filters]);

  function updateFilter<K extends keyof ReadingCatalogFilters>(key: K, value: ReadingCatalogFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function open(entry: ReadingCatalogEntry) {
    if (entry.available === false) return;
    try { await actions.onOpen(entry); }
    catch (error) { setActionMessage(error instanceof Error ? error.message : "无法打开文件，请重试。"); }
  }

  function navigateRows(event: KeyboardEvent<HTMLTableRowElement>, offset: number) {
    if (event.key === "Enter") { event.preventDefault(); void open(visibleEntries[offset]); return; }
    if (event.key === " ") { event.preventDefault(); setSelectedId(visibleEntries[offset].id); return; }
    const next = event.key === "ArrowDown" ? Math.min(visibleEntries.length - 1, offset + 1)
      : event.key === "ArrowUp" ? Math.max(0, offset - 1)
        : event.key === "Home" ? 0 : event.key === "End" ? visibleEntries.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setSelectedId(visibleEntries[next].id);
    rowsElement.current?.rows.item(next)?.focus();
  }

  return <section className="reading-catalog" aria-label="阅读库">
    <header className="reading-catalog-heading">
      <div><h2>阅读库</h2><p>论文、书籍与笔记，在一处查找和阅读。</p></div>
      {onImport ? <Button appearance="primary" icon={<AddRegular />} disabled={loading} onClick={() => {
        void Promise.resolve().then(onImport).catch((error: unknown) => setActionMessage(error instanceof Error ? error.message : "导入未完成，请重试。"));
      }}>导入文件</Button> : null}
    </header>
    <div className="reading-catalog-controls" role="search" aria-label="筛查阅读库">
      <Input ref={searchInput} className="reading-catalog-search" aria-label="搜索文献与文件" placeholder="搜索标题、作者、DOI、摘要、标签或路径" contentBefore={<SearchRegular />} value={filters.query} onChange={(_, data) => updateFilter("query", data.value)} contentAfter={filters.query ? <Tooltip content="清空搜索" relationship="description"><Button appearance="transparent" size="small" icon={<DismissRegular />} aria-label="清空搜索" onClick={() => { updateFilter("query", ""); searchInput.current?.focus(); }} /></Tooltip> : undefined} />
      <div className="reading-catalog-filters">
        <Select aria-label="筛选文件格式" value={filters.format} onChange={(_, data) => updateFilter("format", data.value as ReadingCatalogFormat | "all")}>
          <option value="all">全部格式</option>{Object.entries(readingCatalogFormatLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select aria-label="筛选阅读状态" value={filters.status} onChange={(_, data) => updateFilter("status", data.value as ReadingCatalogStatus | "all")}>
          <option value="all">全部阅读状态</option>{Object.entries(readingCatalogStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        <Select aria-label="筛选分类" value={filters.collection} onChange={(_, data) => updateFilter("collection", data.value)}>
          <option value="">全部分类</option>{collections.map((value) => <option key={value} value={value}>{value}</option>)}
        </Select>
        <Select aria-label="筛选发表年份" value={filters.year} onChange={(_, data) => updateFilter("year", data.value)}>
          <option value="">全部年份</option>{years.map((value) => <option key={value} value={String(value)}>{value}</option>)}<option value="unknown">年份未提供</option>
        </Select>
        <Select aria-label="文件排序" value={filters.sort} onChange={(_, data) => updateFilter("sort", data.value as ReadingCatalogSort)}>
          <option value="added">最近添加</option><option value="title">标题 A–Z</option><option value="author">作者 A–Z</option><option value="year-desc">发表时间：新到旧</option><option value="year-asc">发表时间：旧到新</option>
        </Select>
        {hasFilters ? <Button appearance="subtle" onClick={() => setFilters(defaultFilters)}>重置筛选</Button> : null}
      </div>
    </div>
    <div className="reading-catalog-summary"><span aria-live="polite">{loading ? "正在读取文件库…" : `${results.length} / ${entries.length} 项`}</span><span>单击查看信息 · 双击或 Enter 阅读</span></div>
    {message || actionMessage ? <p className="reading-catalog-message" role="status">{actionMessage || message}</p> : null}
    <div className="reading-catalog-body">
      <div className="reading-catalog-list">
        <div className="reading-catalog-table-scroll" aria-busy={loading || deferredFilters !== filters}>
          <table className="reading-catalog-table" aria-label="文献与文件列表">
            <thead><tr><th scope="col">标题与作者</th><th scope="col">年份</th><th scope="col">格式</th><th scope="col">状态</th></tr></thead>
            <tbody ref={rowsElement}>{visibleEntries.map((entry, offset) => <tr
              key={entry.id} className={entry.id === selected?.id ? "is-selected" : undefined}
              tabIndex={entry.id === selected?.id || (!visibleEntries.some((item) => item.id === selected?.id) && offset === 0) ? 0 : -1}
              aria-selected={entry.id === selected?.id} onClick={() => setSelectedId(entry.id)} onFocus={() => setSelectedId(entry.id)}
              onDoubleClick={() => void open(entry)} onKeyDown={(event) => navigateRows(event, offset)}
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
