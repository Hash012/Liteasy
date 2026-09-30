import { ExtensionLibraryColumns } from "../extensions/ExtensionMetadata";
import { Tooltip } from "@fluentui/react-components";
import type { ReadingCatalogEntry } from "./readingCatalog.types";
import { libraryEntryTags, type LibraryTag } from "./libraryAssetMetadata";

const kindLabel = { type: "类别", year: "年份", author: "作者", subject: "学科", tag: "标签", collection: "分类" };
export function compactAuthorName(fullName: string) {
  const name = fullName.trim().replace(/\s+/g, " ");
  // Bibliographic "Family, Given" names explicitly identify the family name.
  if (name.includes(",")) return name.split(",")[0].trim() || name;
  // Preserve unsegmented names and CJK names rather than guessing their order.
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(name)) return name;
  const parts = name.replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/i, "").split(" ");
  return parts[parts.length - 1] || name;
}

export function LibraryTagChips({ entry, onSelect, limit = 4 }: { entry: ReadingCatalogEntry; onSelect?: (tag: LibraryTag) => void; limit?: number }) {
  const tags = libraryEntryTags(entry);
  return <span className="library-tag-chips" aria-label={`${entry.title} 的分类与标签`}>
    {tags.slice(0, limit).map((tag) => {
      const title = `${kindLabel[tag.kind]}：${tag.label}`;
      const className = `library-tag-chip library-tag-${tag.kind}`;
      const label = tag.kind === "author" ? compactAuthorName(tag.label) : tag.label;
      const key = `${tag.kind}:${tag.value}`;
      const chip = onSelect ? <button type="button" className={className} title={title} aria-label={title}
        onClick={(event) => { event.stopPropagation(); onSelect(tag); }}>{label}</button>
        : <span className={className} title={title} tabIndex={tag.kind === "author" ? 0 : undefined}>{label}</span>;
      return <Tooltip key={key} content={title} relationship="description">{chip}</Tooltip>;
    })}
    {tags.length > limit ? <span className="library-tags-overflow" title={tags.slice(limit).map((tag) => `${kindLabel[tag.kind]}：${tag.label}`).join("\n")}>+{tags.length - limit}</span> : null}
    <ExtensionLibraryColumns entry={entry} />
  </span>;
}
