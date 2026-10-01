import { ExtensionLibraryColumns } from "../extensions/ExtensionMetadata";
import { ResourceTagChips } from "../resource-tags/ResourceTagChips";
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
  const tags = libraryEntryTags(entry).map((tag) => ({ ...tag,
    description: `${kindLabel[tag.kind]}：${tag.label}`, compactLabel: tag.kind === "author" ? compactAuthorName(tag.label) : tag.label }));
  return <ResourceTagChips className="library-tag-chips" label={`${entry.title} 的分类与标签`} tags={tags} limit={limit} onSelect={onSelect}>
    <ExtensionLibraryColumns entry={entry} />
  </ResourceTagChips>;
}
