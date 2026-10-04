import { useId, useMemo, useState } from "react";
import { Button, Field, Input, Popover, PopoverSurface, PopoverTrigger, Select, Tooltip } from "@fluentui/react-components";
import { FilterRegular, AddRegular, DismissRegular } from "@fluentui/react-icons";
import { compileSearchQuery, updateSearchFacet, type SearchFacet } from "./searchQuery";
import "./search.css";

const formats = ["pdf", "markdown", "txt", "epub", "mobi", "fb2", "html", "canvas", "json", "csv", "docx", "pptx", "png", "other"];
const types: Record<string, string> = { "journal-article": "期刊论文", "conference-paper": "会议论文", book: "图书", webpage: "网页", report: "报告", preprint: "预印本", note: "笔记", thesis: "学位论文", "book-section": "图书章节", board: "白板", artifact: "产物", other: "其他" };

/** One query representation for every search surface, including saved searches. */
export function SearchOptions({ query, onChange, tags = [] }: { query: string; onChange(value: string): void; tags?: readonly string[] }) {
  const [field, setField] = useState<SearchFacet>("tag"), [exclude, setExclude] = useState(false), [value, setValue] = useState("");
  const id = useId();
  const compiled = useMemo(() => compileSearchQuery(query), [query]);
  const choices = field === "tag" ? [...new Set(tags)].sort() : field === "format" ? formats : Object.keys(types);
  return <span className="search-options">
    <Popover positioning="below-start"><PopoverTrigger disableButtonEnhancement><Tooltip content="标签、格式、类别与正则检索" relationship="description">
      <Button size="small" appearance="subtle" icon={<FilterRegular />} aria-label="高级检索条件" />
    </Tooltip></PopoverTrigger><PopoverSurface className="search-options-surface">
      <strong>检索条件</strong>
      <div className="search-options-fields">
        <Field label="条件"><Select aria-label="检索条件类型" value={field} onChange={(_, data) => { setField(data.value as SearchFacet); setValue(""); }}><option value="tag">标签</option><option value="format">格式</option><option value="type">类别</option></Select></Field>
        <Field label="规则"><Select aria-label="包含或排除" value={exclude ? "exclude" : "include"} onChange={(_, data) => setExclude(data.value === "exclude")}><option value="include">包含</option><option value="exclude">排除</option></Select></Field>
        <Field label="值"><Input aria-label="检索条件值" list={id} value={value} onChange={(_, data) => setValue(data.value)} placeholder={field === "tag" ? "输入或选择标签" : field === "format" ? "例如 pdf" : "例如 book"} /><datalist id={id}>{choices.map((choice) => <option key={choice} value={choice}>{field === "type" ? types[choice] : choice}</option>)}</datalist></Field>
        <Button icon={<AddRegular />} disabled={!value.trim() || Boolean(compiled.error)} onClick={() => { onChange(updateSearchFacet(query, field, value.trim(), exclude, true)); setValue(""); }}>添加条件</Button>
      </div>
      <div className="search-condition-list">{compiled.tokens.filter((token) => token.field).map((token, i) => <Button key={i} size="small" icon={<DismissRegular />} aria-label={`移除条件 ${token.raw}`} onClick={() => onChange(updateSearchFacet(query, token.field!, token.value, Boolean(token.exclude), false))}>{token.exclude ? "排除" : "包含"} · {token.value}</Button>)}</div>
      <p>多个标签需同时持有；多个格式或类别匹配任意一项。排除条件始终生效。</p>
      <p>正则：<code>/memory|记忆/i</code> 或 <code>re:"第[一二三]章"</code>；可与筛选条件组合。支持 i、m、s，不支持环视与反向引用。</p>
      <p>例如：<code>记忆 tag:精读 -tag:翻译 format:pdf -type:book</code></p>
    </PopoverSurface></Popover>
    {compiled.error ? <small role="alert" className="search-query-error">{compiled.error}</small> : null}
  </span>;
}

export function SearchHighlight({ text, query }: { text: string; query: string }) {
  const ranges = useMemo(() => compileSearchQuery(query).ranges(text), [text, query]);
  let end = 0;
  return <>{ranges.map((range, i) => { const before = text.slice(end, range.start); end = range.end; return <span key={i}>{before}<mark className="search-text-match">{text.slice(range.start, range.end)}</mark></span>; })}{text.slice(end)}</>;
}
