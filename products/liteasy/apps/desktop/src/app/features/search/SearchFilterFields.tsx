import { messageWithFallback } from "../../shared/i18n/i18n";
import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { InfoPopover } from "../../shared/ui/productPrimitives";
import { useId, useMemo, useState } from "react";
import { Button, Combobox, Field, Option, Tooltip } from "@fluentui/react-components";
import { AddRegular, DismissRegular } from "@fluentui/react-icons";
import { clearSearchFacets, compileSearchQuery, normalizeSearchValue, searchFormat, updateSearchFacet, type SearchFacet, type SearchFacetCounts } from "./searchQuery";

type Choice = { value: string; label: string; count?: number };
const formats = ["pdf", "markdown", "txt", "epub", "mobi", "fb2", "html", "canvas", "json", "csv", "docx", "pptx", "png", "jpg", "svg", "other"];
const types: Record<string, string> = { "journal-article": "期刊论文", "conference-paper": "会议论文", book: "图书", webpage: "网页", report: "报告", preprint: "预印本", note: "笔记", thesis: "学位论文", "book-section": "图书章节", board: "白板", artifact: "产物", other: "其他" };
const kinds: Record<string, string> = { paper: "论文", project: "项目", text: "原文", image: "图片", note: "笔记", annotation: "批注", excerpt: "摘录", board: "白板", artifact: "产物", document: "阅读文件", help: "帮助", setting: "设置" };
const origins: Record<string, string> = { user: "人工", agent: "生成", import: "导入", external: "外部文件", mixed: "混合编辑", unknown: "来源未知" };
const fields: Record<SearchFacet, string> = { tag: "标签", format: "格式", type: "类别", "tag-any": "任一标签", kind: "内容种类", origin: "来源", since: "起始时间", until: "结束时间" };
const fieldLabel = (field: SearchFacet) => messageWithFallback(`contextCatalog.filter.${field}`, fields[field]);
const normalized = (field: SearchFacet, value: string) => field === "format" ? searchFormat(value) : normalizeSearchValue(value);
export const searchFacetLabel = (field: SearchFacet, value: string) => field === "type" ? types[value] ?? value : field === "format" ? searchFormat(value).toUpperCase() : field === "kind" || field === "origin" ? messageWithFallback(`contextCatalog.${field}.${value}`, (field === "kind" ? kinds : origins)[value] ?? value) : value;
export const searchConditionLabel = (field: SearchFacet, value: string, exclude: boolean) => `${exclude ? "排除" : "包含"}${fieldLabel(field)}：${searchFacetLabel(field, value)}`;

function FacetPicker({ field, exclude, selected, choices, disabled, onToggle }: {
  field: SearchFacet; exclude: boolean; selected: string[]; choices: Choice[]; disabled: boolean;
  onToggle(value: string, enabled: boolean): void;
}) {
  const [draft, setDraft] = useState("");
  const id = useId();
  const label = `${exclude ? "排除" : "包含"}${fieldLabel(field)}`;
  const value = choices.find((choice) => normalized(field, choice.value) === normalized(field, draft.trim()) || normalizeSearchValue(choice.label) === normalizeSearchValue(draft))?.value
    ?? selected.find((item) => normalized(field, item) === normalized(field, draft.trim())) ?? draft.trim();
  const matches = choices.filter((choice) => normalizeSearchValue(`${choice.label} ${choice.value}`).includes(normalizeSearchValue(draft)));
  const has = (value: string) => selected.some((item) => normalized(field, item) === normalized(field, value));
  const add = () => { if (value && !disabled) { onToggle(value, true); setDraft(""); } };
  return <Field className="search-facet-field" label={{ children: label, htmlFor: id }}>
    <div className="search-facet-input">
      <Combobox id={id} aria-label={label} size="small" freeform multiselect disabled={disabled} value={draft}
        positioning={{ autoSize: "width" }} listbox={{ style: { maxHeight: "min(240px, 40dvh)" } }}
        placeholder={field === "tag" ? "选择或输入标签" : field === "format" ? "选择或输入格式" : "选择或输入类别"}
        selectedOptions={selected.map((item) => choices.find((choice) => normalized(field, choice.value) === normalized(field, item))?.value ?? item)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && !(event.target as HTMLElement).getAttribute("aria-activedescendant") && draft.trim()) { event.preventDefault(); event.stopPropagation(); add(); } }}
        onOptionSelect={(_, data) => { if (data.optionValue !== undefined) { onToggle(data.optionValue, !has(data.optionValue)); setDraft(""); } }}>
        {matches.slice(0, 100).map((choice) => <Option key={choice.value} value={choice.value} text={choice.label}><span>{choice.label}</span>{choice.count !== undefined ? <span className="search-facet-count">{choice.count}</span> : null}</Option>)}
        {value && !choices.some((choice) => normalized(field, choice.value) === normalized(field, value)) ? <Option value={value} text={value}>使用“{value}”</Option> : null}
        {!matches.length && !value ? <Option disabled value="">暂无候选，可直接输入</Option> : null}
      </Combobox>
      <Tooltip content={`添加${label}`} relationship="label"><Button size="small" appearance="subtle" icon={<AddRegular />} aria-label={`添加${label}`} disabled={disabled || !value} onClick={add} /></Tooltip>
    </div>
    <div className="search-facet-values" aria-label={`已选${label}`}>
      {selected.map((item) => <Tooltip key={item} content={searchConditionLabel(field, item, exclude)} relationship="description">
        <Button size="small" appearance="subtle" className={exclude ? "search-filter-chip is-excluded" : "search-filter-chip"} icon={<DismissRegular />} iconPosition="after"
          aria-label={`移除${searchConditionLabel(field, item, exclude)}`} onClick={() => onToggle(item, false)}>{searchFacetLabel(field, item)}</Button>
      </Tooltip>)}
    </div>
    {matches.length > 100 ? <small>输入名称可检索全部 {choices.length} 项</small> : null}
  </Field>;
}

/** Shared by global search and each local search surface; edits the same saved query. */
export function SearchFilterFields({ query, onChange, tags = [], facetCounts }: { query: string; onChange(value: string): void; tags?: readonly string[]; facetCounts?: SearchFacetCounts }) {
  const { locale, tChinese } = useUiTranslation();
  const compiled = useMemo(() => compileSearchQuery(query), [query]);
  const choices = useMemo<Record<SearchFacet, Choice[]>>(() => ({
    tag: [...new Map(tags.filter((tag) => tag.trim()).map((tag) => [normalizeSearchValue(tag), tag])).values()].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value })),
    format: formats.map((value) => ({ value, label: searchFacetLabel("format", value) })),
    type: Object.entries(types).map(([value, label]) => ({ value, label })),
    "tag-any": tags.map((value) => ({ value, label: value })),
    kind: Object.keys(kinds).map((value) => ({ value, label: searchFacetLabel("kind", value) })),
    origin: Object.keys(origins).map((value) => ({ value, label: searchFacetLabel("origin", value) })),
    since: [], until: [],
  }), [tags, locale]);
  const facets = compiled.tokens.filter((token) => token.field);
  return <div className="search-filter-panel">
    <div className="search-filter-heading"><strong>筛选范围</strong><Button size="small" appearance="subtle" disabled={!facets.length} onClick={() => onChange(clearSearchFacets(query))}>清除筛选条件</Button></div>
    <div className="search-filter-grid">
      {(["tag", "tag-any", "format", "type", "kind", "origin"] as const).flatMap((field) => [false, true].map((exclude) => <FacetPicker key={`${field}:${exclude}`} field={field} exclude={exclude} choices={choices[field].map((choice) => ({ ...choice, ...(facetCounts?.[field === "tag-any" ? "tag" : field] ? { count: facetCounts[field === "tag-any" ? "tag" : field]!.get(normalized(field, choice.value)) ?? 0 } : {}) }))}
        selected={[...new Set(facets.filter((token) => token.field === field && Boolean(token.exclude) === exclude).map((token) => token.value))]}
        disabled={Boolean(compiled.error)} onToggle={(value, enabled) => onChange(updateSearchFacet(query, field, value, exclude, enabled))} />))}
    </div>

    <InfoPopover label="检索语法与正则表达式">
      <p>{tChinese("contextCatalog.filter.help", "包含标签须同时满足；任一标签、格式、类别和内容种类分别匹配任意一项。排除条件始终生效。时间范围使用 since: 起始时刻（含）和 until: 结束时刻（不含），推荐带时区的 ISO 时间。")}</p>
      <p>也可在搜索框直接输入 <code>记忆 tag:精读 -tag:翻译 format:pdf -type:book</code>。</p>
      <p>正则：<code>/memory|记忆/i</code> 或 <code>re:"第[一二三]章"</code>，可与筛选组合。支持 i、m、s，不支持环视与反向引用。</p>
    </InfoPopover>
  </div>;
}
