import { z } from "zod";
import { createObjectRepository } from "../objects/objectRepository";
import { objectRefSchema, refOf } from "../objects/object.types";
import type { ObjectStorage, StorageRow } from "../objects/objectStorage";
import type { StagedObjectAsset } from "../objects/objectAssets";
import type { ParsedReadingDocument } from "./readingDocument.types";

export const MAX_LIBRARY_FILE_BYTES = 20 * 1024 * 1024;
const metadataSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  collection: z.string().trim().max(120).optional(),
  readingStatus: z.enum(["unread", "reading", "finished"]).optional()
});
export type ReadingMetadata = z.infer<typeof metadataSchema>;
const entrySchema = z.object({
  id: z.string(), ref: objectRefSchema, assetId: z.string(), fileName: z.string(),
  format: z.enum(["epub", "markdown", "txt"]), title: z.string(), authors: z.array(z.string()),
  language: z.string().optional(), publication: z.string().optional(), publishedAt: z.string().optional(),
  identifier: z.string().optional(), abstract: z.string().optional(), fileSize: z.number().int().nonnegative(),
  addedAt: z.string(), contextTruncated: z.boolean()
});
export type ReadingLibraryFile = z.infer<typeof entrySchema>;
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
      if (value.tags) value.tags = [...new Set(value.tags)];
      await storage.commit([change(key, value, previous)]);
      return value;
    },
    async importFile(name: string, bytes: Uint8Array, document: ParsedReadingDocument) {
      if (!bytes.length || bytes.length > MAX_LIBRARY_FILE_BYTES) throw new Error("单个阅读文件需在 1 字节至 20 MB 之间。");
      const hash = await digest(bytes);
      const id = `reading:${hash}`;
      const key = `reading-library/file/${id}`;
      const previous = await storage.get(key);
      if (previous) return { entry: entrySchema.parse(previous.value), duplicate: true };
      const asset: StagedObjectAsset = {
        assetId: hash, sha256: hash, byteLength: bytes.length, base64: base64(bytes),
        mediaType: document.format === "epub" ? "application/epub+zip" : document.format === "markdown" ? "text/markdown" : "text/plain"
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
      let text = "", truncated = false;
      for (const chapter of document.chapters) {
        const section = `${chapter.title}\n\n${chapter.plainText}\n\n`;
        if (text.length + section.length > limit) {
          text += section.slice(0, limit - text.length); truncated = true; break;
        }
        text += section;
      }
      if (truncated) text += "\n\n[上下文为节选；完整原文保存在阅读文件中。]";
      const { base64: _base64, ...descriptor } = asset;
      const source = await objects.legacy(`reading-file:${hash}`, {
          kind: "source.document", title: document.title.slice(0, 1000), assets: [descriptor],
          content: { schema: "liteasy.source-document/v1", payload: {
            paperId: id, text, availability: "local", legacyKey: `reading-file:${hash}`, documentHash: hash
          } }
      });
      const entry = entrySchema.parse({
        id, ref: refOf(source), assetId: hash, fileName: name.slice(0, 300),
        format: document.format === "text" ? "txt" : document.format,
        title: document.title.slice(0, 1000), authors: document.authors,
        language: document.language, publication: document.publisher, publishedAt: document.publishedAt,
        identifier: document.identifier, abstract: document.description?.slice(0, 12000),
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
