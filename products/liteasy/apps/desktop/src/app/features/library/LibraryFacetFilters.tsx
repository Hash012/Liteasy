import { useMemo, useState } from "react";
import { Button, Field, Input, Select } from "@fluentui/react-components";
import type { ReadingCatalogEntry } from "./readingCatalog.types";
import type { ReadingCatalogFilters } from "./readingCatalogSearch";
import { assetTypeLabels } from "./libraryAssetMetadata";

export function LibraryFacetFilters({ entries, filters, onChange }: { entries: ReadingCatalogEntry[]; filters: ReadingCatalogFilters; onChange: (value: ReadingCatalogFilters) => void }) {
  const [query, setQuery] = useState("");
  const counts = useMemo(() => {
    const values = new Map<string, number>();
    for (const entry of entries) for (const tag of new Set(entry.tags)) values.set(tag, (values.get(tag) ?? 0) + 1);
    return [...values].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
  }, [entries]);
  const visible = counts.filter(([tag]) => tag.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <Field label="类别"><Select aria-label="筛选资产类别" value={filters.assetType ?? ""} onChange={(_, data) => onChange({ ...filters, assetType: data.value })}>
      <option value="">全部类别</option>{Object.entries(assetTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </Select></Field>
    <Field label="作者"><Input aria-label="筛选作者" value={filters.author ?? ""} onChange={(_, data) => onChange({ ...filters, author: data.value })} placeholder="按作者姓名筛选" /></Field>
    <Field label="学科"><Input aria-label="筛选学科" value={filters.subject ?? ""} onChange={(_, data) => onChange({ ...filters, subject: data.value })} placeholder="按学科筛选" /></Field>
    <Field label="标签"><Input aria-label="查找标签" value={query} onChange={(_, data) => setQuery(data.value)} placeholder="查找库内标签" /></Field>
    <div className="library-tag-selector" aria-label="标签筛选">
      {visible.slice(0, 60).map(([tag, count]) => <Button key={tag} size="small" appearance="subtle"
        className="library-tag-chip library-tag-tag" aria-pressed={filters.tags?.includes(tag) ?? false}
        onClick={() => onChange({ ...filters, tags: filters.tags?.includes(tag) ? filters.tags.filter((value) => value !== tag) : [...(filters.tags ?? []), tag] })}>{tag}<small>{count}</small></Button>)}
      {!visible.length ? <small>没有匹配标签，可右键文件添加。</small> : null}
      {visible.length > 60 ? <small>还有 {visible.length - 60} 个标签，请输入名称查找。</small> : null}
    </div>
  </>;
}
