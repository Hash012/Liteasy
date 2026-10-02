import type { ReadingCatalogEntry } from "./readingCatalog.types";

export const assetTypeLabels: Record<string, string> = {
  "journal-article": "期刊论文", "conference-paper": "会议论文", book: "图书",
  webpage: "网页", report: "报告", preprint: "预印本", note: "笔记", other: "其他",
  thesis: "学位论文", "book-section": "图书章节"
};
export type LibraryAssetMetadata = { assetType?: string; subjects?: string[]; authors?: string[]; year?: number };
export function inferAssetType(format: string, documentType?: string) {
  if (documentType === "proceedings-article") return "conference-paper";
  if (documentType && assetTypeLabels[documentType]) return documentType;
  if (["epub", "mobi", "fb2"].includes(format)) return "book";
  if (format === "html") return "webpage";
  if (["markdown", "txt"].includes(format)) return "note";
  // A PDF may be a book, thesis or report: its format alone cannot establish type.
  return "";
}
export type LibraryTag = { kind: "type" | "year" | "author" | "subject" | "tag" | "collection"; value: string; label: string };
export function libraryEntryTags(entry: ReadingCatalogEntry): LibraryTag[] {
  const type = entry.assetType || inferAssetType(entry.format);
  return [
    ...(type ? [{ kind: "type" as const, value: type, label: assetTypeLabels[type] ?? type }] : []),
    ...(entry.year ? [{ kind: "year" as const, value: String(entry.year), label: String(entry.year) }] : []),
    ...(entry.subjects ?? []).map((value) => ({ kind: "subject" as const, value, label: value })),
    ...(entry.tags ?? []).map((value) => ({ kind: "tag" as const, value, label: value })),
    ...(entry.authors ?? []).map((value) => ({ kind: "author" as const, value, label: value })),
    ...(entry.collection ? [{ kind: "collection" as const, value: entry.collection, label: entry.collection }] : [])
  ];
}
