export type ResourceKind = "pdf" | "image" | "text" | "link" | "file";

export type LibraryItem = {
  id: string;
  kind: ResourceKind;
  title: string;
  filename: string;
  mimeType: string;
  size: number;
  contentHash: string;
  sourceUrl?: string;
  text?: string;
  collection: string;
  tags: string[];
  note: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  lastReadAt?: string;
  page: number;
  pinned: boolean;
  downloaded: boolean;
  revision: number;
};

export type ImportResource = {
  title: string;
  filename?: string;
  mimeType?: string;
  sourceUrl?: string;
  text?: string;
  collection?: string;
  note?: string;
  bytes?: Uint8Array;
};

export interface LibraryRepository {
  list(scope: string): Promise<LibraryItem[]>;
  importResource(scope: string, input: ImportResource): Promise<LibraryItem>;
  update(scope: string, item: LibraryItem): Promise<LibraryItem>;
  readBytes(scope: string, id: string, expectedHash?: string): Promise<Uint8Array>;
  readRecord<T>(scope: string, key: string): Promise<T | undefined>;
  writeRecord<T>(scope: string, key: string, value: T): Promise<void>;
}

export const maxImportBytes = 256 * 1024 * 1024;

export function resourceKind(mimeType: string, filename: string, text?: string, sourceUrl?: string): ResourceKind {
  if (mimeType === "application/pdf" || /\.pdf$/i.test(filename)) return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (sourceUrl && !filename) return "link";
  if (text !== undefined && !filename) return "text";
  return "file";
}

export function validateImport(input: ImportResource) {
  if (!input.title.trim() || input.title.length > 1024) throw new Error("请填写不超过 1024 个字符的标题。");
  if (input.bytes && input.bytes.byteLength > maxImportBytes) throw new Error("单个文件不能超过 256 MiB。");
  if (input.sourceUrl) {
    const url = new URL(input.sourceUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持 HTTP 或 HTTPS 链接。");
  }
  if (!input.bytes && !input.sourceUrl && !input.text?.trim()) throw new Error("资料内容为空。");
  if ((input.text?.length ?? 0) > 2_000_000) throw new Error("文字内容过长，请作为文件导入。");
  if (resourceKind(input.mimeType ?? "", input.filename ?? "", input.text, input.sourceUrl) === "pdf" &&
    input.bytes && new TextDecoder().decode(input.bytes.subarray(0, 1024)).indexOf("%PDF-") < 0) {
    throw new Error("文件内容不是有效的 PDF。");
  }
}
