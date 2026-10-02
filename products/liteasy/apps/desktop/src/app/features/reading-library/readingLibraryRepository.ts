import { readingMediaTypes } from "./readingFormats";
import { z } from "zod";
import { createObjectRepository } from "../objects/objectRepository";
import { objectRefSchema, refOf } from "../objects/object.types";
import type { ObjectStorage, StorageRow } from "../objects/objectStorage";
import type { StagedObjectAsset } from "../objects/objectAssets";
import type { ParsedReadingDocument } from "./readingDocument.types";
import { bibliographicDraftSchema, bibliographicSnapshotSchema, type BibliographicDraft } from "../library/bibliographicFields";
import { readingImportBibliography, readingImportSourceSchema, type ReadingImportSource } from "./readingImportIdentity";

export const MAX_LIBRARY_FILE_BYTES = 20 * 1024 * 1024;
const metadataSchema = z.object({
  assetType: z.string().trim().max(80).optional(),
  subjects: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  authors: z.array(z.string().trim().min(1).max(300)).max(200).optional(),
  year: z.number().int().min(1000).max(9999).optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  folderPath: z.string().max(4096).optional(),
  collection: z.string().trim().max(120).optional(),
  readingStatus: z.enum(["unread", "reading", "finished"]).optional()
}).passthrough();
export type ReadingMetadata = z.infer<typeof metadataSchema>;
const entrySchema = z.object({
  id: z.string(), ref: objectRefSchema, assetId: z.string(), fileName: z.string(),
  format: z.enum(["epub", "mobi", "fb2", "html", "markdown", "txt", "other"]), title: z.string(), authors: z.array(z.string()),
  language: z.string().optional(), publication: z.string().optional(), publishedAt: z.string().optional(),
  identifier: z.string().optional(), abstract: z.string().optional(), fileSize: z.number().int().nonnegative(),
  addedAt: z.string(), contextTruncated: z.boolean(),
  importSource: readingImportSourceSchema.optional()
}).passthrough();
export type ReadingLibraryFile = z.infer<typeof entrySchema>;
const importMappingSchema = z.object({
  schema: z.literal("liteasy.reading-import/v1"), id: z.string().min(1), objectKey: z.string().min(1),
}).passthrough();
const change = (key: string, value: unknown, previous?: StorageRow | null) => ({
  key, expected: previous?.version ?? null, row: { key, version: crypto.randomUUID(), value }
});
async function digest(bytes: Uint8Array) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice())), (n) => n.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: Uint8Array) {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(result);
}

/** Compact metadata is separate from source assets and text: listing never reads book bodies. */
export function createReadingLibraryRepository(storage: ObjectStorage, scopeId: string) {
  const objects = createObjectRepository(storage, scopeId);
  async function listRows(prefix: string) {
    const rows: StorageRow[] = [];
    let cursor = "";
    do {
      const batch = await storage.list(prefix, cursor, 500);
      rows.push(...batch);
      cursor = batch.length === 500 ? batch.at(-1)!.key : "";
    } while (cursor);
    return rows;
  }
  return {
    async list() {
      return (await listRows("reading-library/file/")).map((row) => entrySchema.parse(row.value));
    },
    async metadata(): Promise<Record<string, ReadingMetadata>> {
      return Object.fromEntries((await listRows("reading-library/metadata/")).map((row) => [
        row.key.slice("reading-library/metadata/".length), metadataSchema.parse(row.value)
      ]));
    },
    async updateMetadata(id: string, patch: ReadingMetadata) {
      const key = `reading-library/metadata/${id}`;
      const previous = await storage.get(key);
      const value = metadataSchema.parse({ ...metadataSchema.parse(previous?.value ?? {}), ...patch });
      // The older classification editor exposes author/year/type too. Keep those
      // edits in the same bibliography instead of creating competing overrides.
      const has = (key: string) => Object.prototype.hasOwnProperty.call(patch, key);
      if (value.bibliographic !== undefined && ["authors", "year", "assetType"].some(has)) {
        const saved = bibliographicSnapshotSchema.safeParse(value.bibliographic);
        if (!saved.success) throw new Error("元信息格式无法安全编辑，请使用兼容的应用版本。");
        const next = { ...saved.data,
          ...(has("authors") ? { authors: patch.authors ?? [] } : {}),
          ...(has("assetType") ? { assetType: patch.assetType ?? "" } : {}),
          ...(has("year") ? { publishedAt: patch.year === undefined ? "" : saved.data.publishedAt.startsWith(String(patch.year)) ? saved.data.publishedAt : String(patch.year) } : {}),
        };
        if (JSON.stringify(next) !== JSON.stringify(saved.data)) value.bibliographic = {
          ...next, revision: saved.data.revision + 1, updatedAt: new Date().toISOString(),
        };
      }
      if (value.tags) value.tags = [...new Set(value.tags)];
      await storage.commit([change(key, value, previous)]);
      return value;
    },
    async saveBibliography(id: string, draft: BibliographicDraft, expectedRevision: number) {
      const key = `reading-library/metadata/${id}`;
      const previous = await storage.get(key);
      const metadata = metadataSchema.parse(previous?.value ?? {});
      const existing = metadata.bibliographic === undefined ? undefined : bibliographicSnapshotSchema.safeParse(metadata.bibliographic);
      if (existing && !existing.success) throw new Error("已保存的元信息格式无法安全编辑，请先导出或使用兼容的应用版本。");
      const revision = existing?.success ? existing.data.revision : 0;
      if (revision !== expectedRevision) throw new Error("元信息已在其他位置修改，请重新载入后再保存。");
      const value = { ...metadata, bibliographic: { ...(existing?.success ? existing.data : {}), ...bibliographicDraftSchema.parse(draft),
        version: 1 as const, revision: revision + 1, updatedAt: new Date().toISOString() } };
      await storage.commit([change(key, value, previous)]);
      return value;
    },
    async importFile(name: string, bytes: Uint8Array, document: ParsedReadingDocument, options: { source?: ReadingImportSource } = {}) {
      if (!bytes.length || bytes.length > MAX_LIBRARY_FILE_BYTES) throw new Error("单个阅读文件需在 1 字节至 20 MB 之间。");
      const importSource = readingImportSourceSchema.parse(options.source ?? { kind: "file-name", location: name });
      const bibliography = readingImportBibliography(document);
      const hash = await digest(bytes);
      const importHash = await digest(new TextEncoder().encode(JSON.stringify({ source: importSource, bibliography, contentHash: hash })));
      const mappingKey = `reading-library/import/${importHash}`;
      let mappingRow = await storage.get(mappingKey);
      if (!mappingRow) {
        // Adopt only an unambiguous legacy entry. Keep its ID and pinned object ref;
        // an unknown old path is not evidence that a newly supplied path is the same source.
        const legacyRow = await storage.get(`reading-library/file/reading:${hash}`);
        const legacy = legacyRow ? entrySchema.parse(legacyRow.value) : undefined;
        const legacyBibliography = legacy ? {
          format: legacy.format, title: legacy.title, authors: legacy.authors, language: legacy.language,
          publication: legacy.publication, publishedAt: legacy.publishedAt, identifier: legacy.identifier,
        } : undefined;
        const adoptLegacy = legacy && !legacy.importSource && importSource.kind === "file-name"
          && legacy.fileName === name.slice(0, 300) && legacy.assetId === hash
          && JSON.stringify(legacyBibliography) === JSON.stringify(bibliography);
        const id = adoptLegacy ? legacy.id : `reading:${crypto.randomUUID()}`;
        const value = { schema: "liteasy.reading-import/v1" as const, id, objectKey: `reading-file:${adoptLegacy ? hash : id}` };
        try { await storage.commit([change(mappingKey, value)]); }
        catch (error) {
          // Another importer can reserve the same logical resource concurrently.
          if (!(await storage.get(mappingKey))) throw error;
        }
        mappingRow = await storage.get(mappingKey);
      }
      const mapping = importMappingSchema.parse(mappingRow?.value);
      const id = mapping.id;
      const key = `reading-library/file/${id}`;
      const previous = await storage.get(key);
      if (previous) return { entry: entrySchema.parse(previous.value), duplicate: true };
      const asset: StagedObjectAsset = {
        assetId: hash, sha256: hash, byteLength: bytes.length, base64: base64(bytes),
        mediaType: readingMediaTypes[document.format]
      };
      // Persist the immutable source first, keeping each transaction below the shared
      // store limit. Retry reuses the same hash if index creation was interrupted.
      if (!(await storage.get(`asset/${hash}`))) {
        try { await storage.commit([change(`asset/${hash}`, asset)]); }
        catch (error) {
          const raced = await storage.get(`asset/${hash}`);
          if (!raced || (raced.value as StagedObjectAsset).sha256 !== hash) throw error;
        }
      }
      const limit = 2_000_000;
      let text = document.format === "other" ? `文件：${name}\n当前格式仅保存原文件，未提取正文。` : "", truncated = false;
      for (const chapter of document.chapters) {
        const section = `${chapter.title}\n\n${chapter.plainText}\n\n`;
        if (text.length + section.length > limit) {
          text += section.slice(0, limit - text.length); truncated = true; break;
        }
        text += section;
      }
      if (truncated) text += "\n\n[上下文为节选；完整原文保存在阅读文件中。]";
      const { base64: _base64, ...descriptor } = asset;
      const source = await objects.legacy(mapping.objectKey, {
          kind: "source.document", title: document.title.slice(0, 1000), assets: [descriptor],
          content: { schema: "liteasy.source-document/v1", payload: {
            paperId: id, text, availability: "local", legacyKey: mapping.objectKey, documentHash: hash
          } }
      });
      const entry = entrySchema.parse({
        id, ref: refOf(source), assetId: hash, fileName: name.slice(0, 300), importSource,
        ...bibliography, abstract: document.description?.slice(0, 12000),
        fileSize: bytes.length, addedAt: new Date().toISOString(), contextTruncated: truncated
      });
      try { await storage.commit([change(key, entry)]); }
      catch (error) {
        const raced = await storage.get(key);
        if (!raced) throw error;
        return { entry: entrySchema.parse(raced.value), duplicate: true };
      }
      return { entry, duplicate: false };
    },
    async readFile(id: string) {
      const entry = entrySchema.parse((await storage.get(`reading-library/file/${id}`))?.value);
      const asset = await objects.readAsset(entry.assetId);
      const bytes = Uint8Array.from(atob(asset.base64), (char) => char.charCodeAt(0));
      if (bytes.length !== entry.fileSize || await digest(bytes) !== entry.assetId) throw new Error("文件校验失败，请检查存储或恢复数据备份。");
      return { entry, bytes };
    },
    async removeFromLibrary(id: string) {
      const key = `reading-library/file/${id}`;
      const row = await storage.get(key);
      if (row) await storage.commit([{ key, expected: row.version, row: null }]);
      // Referenced source objects and immutable assets remain available to notes/Agent history.
    }
  };
}
