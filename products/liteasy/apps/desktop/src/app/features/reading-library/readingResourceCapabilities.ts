import type { ReadingCatalogEntry, ReadingCatalogFormat } from "../library/readingCatalog.types";
import { isPaperMetadataReference, type ObjectEnvelope } from "../objects/object.types";
import { readingMediaTypes } from "./readingFormats";

export type ResourceCapability = { available: true; mode?: "body" | "metadata" | "text-layer" }
  | { available: false; reason: string };
export type ReadingResourceFormat = ReadingCatalogFormat | "office" | "csv" | "json" | "image";
export type ReadingResourceOperation = "open" | "read" | "search" | "annotate" | "edit" | "export" | "aiExtract";
const unavailable = (reason: string): ResourceCapability => ({ available: false, reason });
const body: ResourceCapability = { available: true, mode: "body" };

function formatOf(entry: ReadingCatalogEntry): ReadingResourceFormat {
  if (entry.format !== "other") return entry.format;
  const extension = entry.fileName?.split(".").at(-1)?.toLowerCase();
  if (extension && /^(docx?|xlsx?|pptx?|odt|ods|odp)$/.test(extension)) return "office";
  if (extension === "csv" || extension === "json") return extension;
  if (extension && /^(png|jpe?g|gif|webp|svg|bmp|tiff?)$/.test(extension)) return "image";
  return "other";
}

/** Capabilities of the existing reading-library adapter, not every editor in the app.
 * Search can remain metadata-only; AI extraction never implies a configured model.
 * PDF text must be confirmed by the caller after extraction, including scanned PDFs.
 */
export function readingResourceCapabilities(entry: ReadingCatalogEntry,
  options: { canExport?: boolean; bodyTextAvailable?: boolean } = {}): {
    format: ReadingResourceFormat; operations: Record<ReadingResourceOperation, ResourceCapability>;
  } {
  const format = formatOf(entry);
  const supported = !["other", "office", "csv", "json", "image"].includes(format);
  const fileAvailable = entry.available !== false;
  const read = !fileAvailable ? unavailable("正文文件暂不可用，请重新选择源文件；仍可查看和整理元信息。")
    : !supported ? unavailable("此格式暂不支持内置阅读，可导出原文件后使用对应应用打开。") : body;
  const extracted = fileAvailable && supported && (options.bodyTextAvailable ?? format !== "pdf");
  const operations: Record<ReadingResourceOperation, ResourceCapability> = {
    open: read, read,
    search: { available: true, mode: read.available ? format === "pdf" ? "text-layer" : "body" : "metadata" },
    annotate: read.available && format === "pdf" ? body : unavailable(format === "pdf" ? "正文不可用，无法定位批注。" : "此阅读格式暂不支持批注。"),
    edit: unavailable("阅读库中的原文件以只读方式打开。"),
    export: fileAvailable && entry.canExport !== false && (options.canExport ?? entry.canExport === true)
      ? body : unavailable(fileAvailable ? "此来源没有原文件导出入口。" : "原文件暂不可用，无法导出。"),
    aiExtract: extracted ? body : unavailable(!fileAvailable ? "正文文件暂不可用，无法提取内容。"
      : !supported ? "此格式尚未提取正文，仅保留原文件和元信息。" : "正文文本尚未提取；扫描页需要先完成文字识别。")
  };
  return { format, operations };
}

const readableMediaTypes = new Set(Object.entries(readingMediaTypes).filter(([format]) => format !== "other").map(([, mediaType]) => mediaType));

/** Gate full-text indexing/extraction using the actual saved source, never its title.
 * Legacy unsupported imports contain a human-readable placeholder, not body text.
 */
export function sourceDocumentBodyCapability(object: ObjectEnvelope): ResourceCapability {
  if (object.kind !== "source.document") return unavailable("此对象不是正文来源。");
  const source = object.content.payload;
  if (source.availability !== "local") return unavailable("来源正文暂不可用。");
  if (isPaperMetadataReference(object)) return unavailable("当前仅有题录，正文需要另行读取。");
  if (source.legacyKey.startsWith("reading-file:") && !object.assets.some((asset) => readableMediaTypes.has(asset.mediaType))) {
    return unavailable("此格式尚未提取正文，仅保留原文件和元信息。");
  }
  if (!source.text.trim()) return unavailable("此来源没有可用正文文本。");
  return body;
}
