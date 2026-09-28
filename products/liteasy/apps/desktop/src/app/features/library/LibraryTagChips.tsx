import type { ReadingCatalogEntry } from "./readingCatalog.types";
import { libraryEntryTags, type LibraryTag } from "./libraryAssetMetadata";

const kindLabel = { type: "类别", year: "年份", author: "作者", subject: "学科", tag: "标签", collection: "分类" };
export function LibraryTagChips({ entry, onSelect, limit = 4 }: { entry: ReadingCatalogEntry; onSelect?: (tag: LibraryTag) => void; limit?: number }) {
  const tags = libraryEntryTags(entry);
  if (!tags.length) return null;
  return <span className="library-tag-chips" aria-label={`${entry.title} 的分类与标签`}>
    {tags.slice(0, limit).map((tag) => {
      const title = `${kindLabel[tag.kind]}：${tag.label}`;
      const className = `library-tag-chip library-tag-${tag.kind}`;
      return onSelect ? <button type="button" key={`${tag.kind}:${tag.value}`} className={className} title={title}
        onClick={(event) => { event.stopPropagation(); onSelect(tag); }}>{tag.label}</button>
        : <span key={`${tag.kind}:${tag.value}`} className={className} title={title}>{tag.label}</span>;
    })}
    {tags.length > limit ? <span className="library-tags-overflow" title={tags.slice(limit).map((tag) => `${kindLabel[tag.kind]}：${tag.label}`).join("\n")}>+{tags.length - limit}</span> : null}
  </span>;
}
