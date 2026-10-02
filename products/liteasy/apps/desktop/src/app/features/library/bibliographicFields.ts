import { z } from "zod";
import type { ReadingCatalogEntry } from "./readingCatalog.types";

export const bibliographicFields = [
  { key: "title", label: "标题", limit: 2000, multiline: true },
  { key: "publishedAt", label: "出版日期", limit: 80, placeholder: "2026、2026-10 或 2026-10-02" },
  { key: "publication", label: "期刊 / 会议", limit: 500 },
  { key: "publisher", label: "出版社", limit: 500 },
  { key: "place", label: "出版地", limit: 200 },
  { key: "volume", label: "卷", limit: 80 },
  { key: "issue", label: "期", limit: 80 },
  { key: "pages", label: "页码", limit: 80 },
  { key: "edition", label: "版次", limit: 120 },
  { key: "series", label: "丛书", limit: 500 },
  { key: "seriesNumber", label: "丛书编号", limit: 80 },
  { key: "doi", label: "DOI", limit: 500, placeholder: "10.xxxx/…" },
  { key: "isbn", label: "ISBN", limit: 500 },
  { key: "issn", label: "ISSN", limit: 200 },
  { key: "url", label: "网址", limit: 4096 },
  { key: "accessedAt", label: "访问日期", limit: 80 },
  { key: "language", label: "语言", limit: 80 },
  { key: "shortTitle", label: "短标题", limit: 500 },
  { key: "abstract", label: "摘要", limit: 30000, multiline: true },
  { key: "extra", label: "其他信息", limit: 12000, multiline: true },
] as const;
export type BibliographicField = typeof bibliographicFields[number]["key"];
export type BibliographicDraft = Record<BibliographicField, string> & { authors: string[]; assetType: string };

const fields = Object.fromEntries(bibliographicFields.map((field) => [field.key, z.string().trim().max(field.limit)])) as Record<BibliographicField, z.ZodString>;
export const bibliographicDraftSchema = z.object({ ...fields,
  title: fields.title.min(1, "请填写标题。"),
  authors: z.array(z.string().trim().min(1).max(300)).max(200), assetType: z.string().trim().max(80),
});
// Complete local display overrides: an empty value intentionally clears a registry field.
// Registry-confirmed identity and the original file remain untouched.
export const bibliographicSnapshotSchema = bibliographicDraftSchema.extend({
  version: z.literal(1), revision: z.number().int().positive(), updatedAt: z.string(),
}).passthrough();

function isbnIdentifier(value?: string) {
  const normalized = (value ?? "").replace(/^urn:isbn:/i, "").replace(/[-\s]/g, "");
  return /^(?:\d{9}[\dXx]|\d{13})$/.test(normalized);
}

export function bibliographicDraft(entry: ReadingCatalogEntry): BibliographicDraft {
  return { ...Object.fromEntries(bibliographicFields.map(({ key }) => [key, entry[key] ?? ""])),
    title: entry.title, publishedAt: entry.publishedAt ?? String(entry.year ?? ""),
    authors: [...(entry.authors ?? [])], assetType: entry.assetType ?? "", isbn: entry.isbn ?? (isbnIdentifier(entry.identifier) ? entry.identifier!.replace(/^urn:isbn:/i, "") : ""),
  } as BibliographicDraft;
}

export function applyBibliographicMetadata(entry: ReadingCatalogEntry, value: unknown): ReadingCatalogEntry {
  const result = bibliographicSnapshotSchema.safeParse(value);
  if (!result.success) return entry;
  const { revision, updatedAt } = result.data;
  const metadata = bibliographicDraftSchema.parse(result.data);
  const year = Number(metadata.publishedAt.match(/^\d{4}/)?.[0]);
  return { ...entry, ...metadata, identifier: metadata.isbn || (isbnIdentifier(entry.identifier) ? "" : entry.identifier),
    year: year >= 1000 ? year : undefined, updatedAt, bibliographicRevision: revision };
}
