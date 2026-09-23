import { Inflate } from "fflate";

export const readingFileLimits = {
  inputBytes: 20 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  entryBytes: 8 * 1024 * 1024,
  textBytes: 8 * 1024 * 1024,
  entries: 2048,
  chapters: 512,
  chapterCharacters: 100_000
} as const;

const decoder = new TextDecoder("utf-8", { fatal: true });
const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function normalizeArchivePath(path: string) {
  if (!path || path.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new Error("电子书包含不安全的资源路径。");
  }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("电子书包含越界的资源路径。");
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

export function resolveReadingPath(base: string, reference: string): { path: string; anchor?: string } | undefined {
  if (!reference || /^[a-z][a-z0-9+.-]*:/i.test(reference) || reference.startsWith("//")) return undefined;
  try {
    const [file, hash] = reference.split("#", 2);
    const path = file ? normalizeArchivePath(base.slice(0, base.lastIndexOf("/") + 1) + decodeURIComponent(file.split("?")[0])) : base;
    return { path, ...(hash ? { anchor: decodeURIComponent(hash) } : {}) };
  } catch { return undefined; }
}

type Entry = { path: string; offset: number; compressed: number; expanded: number; method: number; crc: number };

/** Validate central and local headers before allocating; ZIP64 and encrypted archives are deliberately unsupported. */
function inspectArchive(bytes: Uint8Array): Entry[] {
  if (bytes.byteLength > readingFileLimits.inputBytes) throw new Error("电子书超过 20 MB，请拆分后导入。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end -= 1) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < Math.max(0, bytes.length - 65557)) throw new Error("电子书压缩容器不完整或已损坏。");
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const directoryEnd = cursor + view.getUint32(end + 12, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count > readingFileLimits.entries || count === 65535 || directoryEnd !== end) {
    throw new Error("电子书容器过大，或使用了暂不支持的分卷 / ZIP64 格式。");
  }
  let expandedTotal = 0;
  const paths = new Set<string>();
  const entries: Entry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > directoryEnd || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("电子书目录已损坏。");
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const expanded = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const next = cursor + 46 + nameLength + view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    const local = view.getUint32(cursor + 42, true);
    if (flags & 0x2041) throw new Error("此电子书已加密，暂不支持 DRM 保护的电子书。");
    if (![0, 8].includes(method) || expanded > readingFileLimits.entryBytes || compressed > readingFileLimits.inputBytes || next > directoryEnd || local + 30 > cursor) {
      throw new Error("电子书资源超过安全大小限制，或使用了不支持的压缩格式。");
    }
    const rawName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const path = normalizeArchivePath(rawName);
    if (rawName.split("/").includes("..") || paths.has(path)) throw new Error("电子书包含重复或不安全的资源路径。");
    paths.add(path);
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw new Error("电子书资源头信息不一致。");
    const localNameLength = view.getUint16(local + 26, true);
    const offset = local + 30 + localNameLength + view.getUint16(local + 28, true);
    if (offset + compressed > view.getUint32(end + 16, true) || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== rawName) throw new Error("电子书资源已损坏。");
    expandedTotal += expanded;
    if (expandedTotal > readingFileLimits.expandedBytes) throw new Error("电子书解压后超过 64 MB，请拆分后导入。");
    if (!rawName.endsWith("/")) entries.push({ path, offset, compressed, expanded, method, crc: view.getUint32(cursor + 16, true) });
    cursor = next;
  }
  if (cursor !== directoryEnd) throw new Error("电子书目录长度不一致。");
  return entries;
}

/** Tiny compressed chunks bound each inflate allocation even when advertised sizes are dishonest. */
export function readReadingArchive(bytes: Uint8Array) {
  const entries = inspectArchive(bytes);
  const entryByPath = new Map(entries.map((entry) => [entry.path, entry]));
  const result = new Map<string, Uint8Array>();
  let actualTotal = 0;
  let work = 0;
  const read = async (path: string) => {
    const cached = result.get(path);
    if (cached) return cached;
    const entry = entryByPath.get(path);
    if (!entry) return undefined;
    const output = new Uint8Array(entry.expanded);
    let size = 0;
    let checksum = 0xffffffff;
    const consume = (chunk: Uint8Array) => {
      size += chunk.length;
      actualTotal += chunk.length;
      if (size > entry.expanded || actualTotal > readingFileLimits.expandedBytes) throw new Error("电子书实际解压大小超过声明值，已停止读取。");
      output.set(chunk, size - chunk.length);
      for (const byte of chunk) checksum = crcTable[(checksum ^ byte) & 255] ^ (checksum >>> 8);
    };
    if (!entry.method) consume(bytes.subarray(entry.offset, entry.offset + entry.compressed));
    else {
      const inflate = new Inflate((chunk) => consume(chunk));
      for (let position = 0; position < entry.compressed; position += 1024) {
        const next = Math.min(position + 1024, entry.compressed);
        inflate.push(bytes.subarray(entry.offset + position, entry.offset + next), next === entry.compressed);
        work += next - position;
        if (work >= 256 * 1024) { work = 0; await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
      }
    }
    if (size !== entry.expanded || ((checksum ^ 0xffffffff) >>> 0) !== entry.crc) throw new Error("电子书资源校验失败，文件可能已损坏。");
    result.set(entry.path, output);
    return output;
  };
  return { has: (path: string) => entryByPath.has(path), read };
}
