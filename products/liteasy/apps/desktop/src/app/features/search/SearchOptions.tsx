import { useId, useMemo, useState } from "react";
import { Button, Popover, PopoverSurface, PopoverTrigger, Tooltip } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular, FilterRegular, DismissRegular } from "@fluentui/react-icons";
import { compileSearchQuery, updateSearchFacet } from "./searchQuery";
import { SearchFilterFields, searchConditionLabel } from "./SearchFilterFields";
import "./search.css";

/** One query representation for every search surface, including saved searches. */
export function SearchOptions({ query, onChange, tags = [], presentation = "popover" }: {
  query: string; onChange(value: string): void; tags?: readonly string[]; presentation?: "popover" | "inline";
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const compiled = useMemo(() => compileSearchQuery(query), [query]);
  const facets = compiled.tokens.filter((token) => token.field);
  const content = <SearchFilterFields query={query} onChange={onChange} tags={tags} />;
  return <div className={`search-options${presentation === "inline" ? " search-options-inline" : ""}`}>
    {presentation === "inline" ? <>
      <div className="search-filter-toggle-row">
        <Button size="small" appearance="subtle" icon={expanded ? <ChevronDownRegular /> : <ChevronRightRegular />} aria-label="高级检索条件"
          aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}>筛选条件{facets.length ? ` · ${facets.length}` : ""}</Button>
        <span className="search-filter-toggle-hint">标签、格式、类别 · 包含或排除</span>
      </div>
      {expanded ? <div id={id} className="search-options-inline-panel">{content}</div> : facets.length ? <div className="search-condition-list" aria-label="当前筛选条件">
        {facets.map((token, index) => <Tooltip key={index} content={searchConditionLabel(token.field!, token.value, Boolean(token.exclude))} relationship="description">
          <Button size="small" appearance="subtle" className={`search-filter-chip${token.exclude ? " is-excluded" : ""}`} icon={<DismissRegular />} iconPosition="after"
            aria-label={`移除${searchConditionLabel(token.field!, token.value, Boolean(token.exclude))}`}
            onClick={() => onChange(updateSearchFacet(query, token.field!, token.value, Boolean(token.exclude), false))}>{searchConditionLabel(token.field!, token.value, Boolean(token.exclude))}</Button>
        </Tooltip>)}
      </div> : null}
    </> : <Popover positioning="below-start"><PopoverTrigger disableButtonEnhancement><Tooltip content="自定义标签、格式、类别筛选" relationship="description">
      <Button size="small" appearance={facets.length ? "secondary" : "subtle"} icon={<FilterRegular />} aria-label="高级检索条件">{facets.length || null}</Button>
    </Tooltip></PopoverTrigger><PopoverSurface className="search-options-surface" aria-label="自定义检索条件">{content}</PopoverSurface></Popover>}
    {compiled.error ? <small role="alert" className="search-query-error">{compiled.error}</small> : null}
  </div>;
}

export function SearchHighlight({ text, query }: { text: string; query: string }) {
  const ranges = useMemo(() => compileSearchQuery(query).ranges(text), [text, query]);
  let end = 0;
  return <>{ranges.map((range, i) => { const before = text.slice(end, range.start); end = range.end; return <span key={i}>{before}<mark className="search-text-match">{text.slice(range.start, range.end)}</mark></span>; })}{text.slice(end)}</>;
}
