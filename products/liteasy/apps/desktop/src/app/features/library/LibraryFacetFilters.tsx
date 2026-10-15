import { OptionPicker } from "../../shared/ui/productPrimitives";
import { useMemo, useState } from "react";
import { Button, Field, Input } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { ReadingCatalogEntry } from "./readingCatalog.types";
import type { ReadingCatalogFilters } from "./readingCatalogSearch";
import { assetTypeLabels } from "./libraryAssetMetadata";
import { normalizeResourceTags, resourceTagKey } from "../resource-tags/resourceTagValues";

const hasTag = (tags: string[] | undefined, tag: string) => tags?.some((value) => resourceTagKey(value) === resourceTagKey(tag)) ?? false;
const withoutTag = (tags: string[] | undefined, tag: string) => (tags ?? []).filter((value) => resourceTagKey(value) !== resourceTagKey(tag));

export function LibraryFacetFilters({ entries, filters, onChange }: { entries: ReadingCatalogEntry[]; filters: ReadingCatalogFilters; onChange: (value: ReadingCatalogFilters) => void }) {
  const [query, setQuery] = useState("");
  const counts = useMemo(() => {
    const values = new Map<string, { tag: string; count: number }>();
    for (const entry of entries) for (const tag of normalizeResourceTags(entry.tags)) {
      const key = resourceTagKey(tag);
      const previous = values.get(key);
      values.set(key, { tag: previous?.tag ?? tag, count: (previous?.count ?? 0) + 1 });
    }
    return [...values.values()].sort((a, b) => a.tag.localeCompare(b.tag, "zh-CN"));
  }, [entries]);
  const visible = counts.filter(({ tag }) => resourceTagKey(tag).includes(resourceTagKey(query)));
  function toggle(tag: string, exclude = false) {
    onChange({ ...filters,
      tags: exclude || hasTag(filters.tags, tag) ? withoutTag(filters.tags, tag) : normalizeResourceTags([...(filters.tags ?? []), tag]),
      excludeTags: !exclude || hasTag(filters.excludeTags, tag) ? withoutTag(filters.excludeTags, tag) : normalizeResourceTags([...(filters.excludeTags ?? []), tag]),
    });
  }
  return <>
    <Field label="类别"><OptionPicker aria-label="筛选资产类别" value={filters.assetType ?? ""} onValueChange={(assetType) => onChange({ ...filters, assetType })} options={[{ value: "", label: "全部类别" }, ...Object.entries(assetTypeLabels).map(([value, label]) => ({ value, label }))]} /></Field>
    <Field label="作者"><Input aria-label="筛选作者" value={filters.author ?? ""} onChange={(_, data) => onChange({ ...filters, author: data.value })} placeholder="按作者姓名筛选" /></Field>
    <Field label="学科"><Input aria-label="筛选学科" value={filters.subject ?? ""} onChange={(_, data) => onChange({ ...filters, subject: data.value })} placeholder="按学科筛选" /></Field>
    <Field label="标签"><Input aria-label="查找标签" value={query} onChange={(_, data) => setQuery(data.value)} placeholder="查找库内标签" /></Field>
    {filters.tags?.length || filters.excludeTags?.length ? <div className="library-tag-selector" role="group" aria-label="已启用的标签筛选">
      {(["tags", "excludeTags"] as const).flatMap((field) => normalizeResourceTags(filters[field]).map((tag) => <Button key={`${field}:${resourceTagKey(tag)}`} size="small" appearance="subtle" icon={<DismissRegular />} aria-label={`取消${field === "tags" ? "包含" : "排除"}标签 ${tag}`} onClick={() => onChange({ ...filters, [field]: withoutTag(filters[field], tag) })}>{field === "tags" ? "包含" : "排除"}：{tag}</Button>))}
    </div> : null}
    <div className="library-tag-selector" aria-label="标签筛选">
      {visible.slice(0, 60).map(({ tag, count }) => <span key={resourceTagKey(tag)}>
        <Button size="small" appearance="subtle" className="library-tag-chip library-tag-tag" aria-label={`包含标签 ${tag}（${count} 项）`} aria-pressed={hasTag(filters.tags, tag)} onClick={() => toggle(tag)}>{tag}<small>{count}</small></Button>
        <Button size="small" appearance="subtle" aria-label={`排除标签 ${tag}`} title={`排除标签 ${tag}`} aria-pressed={hasTag(filters.excludeTags, tag)} onClick={() => toggle(tag, true)}>{hasTag(filters.excludeTags, tag) ? "已排除" : "−"}</Button>
      </span>)}
      {!visible.length ? <small>没有匹配标签，可右键文件添加。</small> : null}
      {visible.length > 60 ? <small>还有 {visible.length - 60} 个标签，请输入名称查找。</small> : null}
    </div>
  </>;
}
