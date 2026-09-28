import { readingFileLimits } from "./readingArchive";

const bad = () => new Error("MOBI 文件结构或压缩数据已损坏。");
function u16(data: Uint8Array, at: number) {
  if (at < 0 || at + 2 > data.length) throw bad();
  return data[at] * 256 + data[at + 1];
}
function u32(data: Uint8Array, at: number) { return u16(data, at) * 65536 + u16(data, at + 2); }
function magic(data: Uint8Array, at: number, value: string) { return Array.from(value).every((char, i) => data[at + i] === char.charCodeAt(0)); }

export function decompressPalmDoc(input: Uint8Array, limit: number): Uint8Array {
  const output = new Uint8Array(limit);
  let length = 0;
  const put = (byte: number) => { if (length >= limit) throw new Error("MOBI 解压内容超过允许大小。"); output[length++] = byte; };
  for (let i = 0; i < input.length; i++) {
    const byte = input[i];
    if (byte > 0 && byte <= 8) {
      if (i + byte >= input.length) throw bad();
      for (let j = 0; j < byte; j++) put(input[++i]);
    } else if (byte < 128) put(byte);
    else if (byte < 192) {
      if (++i >= input.length) throw bad();
      const pair = (byte << 8) | input[i];
      const distance = (pair & 0x3fff) >> 3;
      if (!distance || distance > length) throw bad();
      for (let j = 0; j < (pair & 7) + 3; j++) put(output[length - distance]);
    } else { put(32); put(byte ^ 128); }
  }
  return output.slice(0, length);
}

/** Bounded HUFF/CDIC decoder: reject cycles, invalid codes, and oversized dictionaries. */
function huffman(records: Uint8Array[], start: number, count: number, limit: number) {
  const huff = records[start];
  if (!huff || count < 2 || start + count > records.length || !magic(huff, 0, "HUFF")) throw bad();
  const first = u32(huff, 8); const second = u32(huff, 12);
  const table = Array.from({ length: 256 }, (_, i) => u32(huff, first + i * 4));
  const bounds = Array.from({ length: 32 }, (_, i) => [u32(huff, second + i * 8), u32(huff, second + i * 8 + 4)]);
  const dictionary: { data: Uint8Array; expanded: boolean; expanding?: boolean }[] = [];
  let cached = 0;
  for (let i = 1; i < count; i++) {
    const record = records[start + i];
    if (!magic(record, 0, "CDIC")) throw bad();
    const header = u32(record, 4); const total = u32(record, 8); const bits = u32(record, 12);
    if (bits > 16 || total > 65536 || header < 16 || header > record.length) throw bad();
    const entries = Math.min(2 ** bits, total - dictionary.length);
    if (entries < 0) throw bad();
    for (let j = 0; j < entries; j++) {
      const offset = header + u16(record, header + j * 2); const size = u16(record, offset);
      if (offset + 2 + (size & 0x7fff) > record.length) throw bad();
      dictionary.push({ data: record.subarray(offset + 2, offset + 2 + (size & 0x7fff)), expanded: Boolean(size & 0x8000) });
    }
  }
  const decode = (input: Uint8Array, depth = 0): Uint8Array => {
    if (depth > 32) throw bad();
    const output = new Uint8Array(limit); let length = 0;
    for (let offset = 0; offset < input.length * 8;) {
      // JS numbers exactly hold the 40 bits used to align a 32-bit code word.
      const byte = Math.floor(offset / 8); let word = 0;
      for (let i = 0; i < 5; i++) word = word * 256 + (input[byte + i] ?? 0);
      const code = Math.floor(word / 2 ** (8 - (offset % 8))) % 2 ** 32;
      const entry = table[Math.floor(code / 2 ** 24)]; let bits = entry & 31;
      if (!bits) throw bad();
      let maximum = entry >>> 8;
      if (!(entry & 128)) {
        while (bits <= 32 && Math.floor(code / 2 ** (32 - bits)) < bounds[bits - 1][0]) bits++;
        if (bits > 32) throw bad();
        maximum = bounds[bits - 1][1];
      }
      offset += bits;
      if (offset > input.length * 8) break;
      const item = dictionary[maximum - Math.floor(code / 2 ** (32 - bits))];
      if (!item || item.expanding) throw bad();
      if (!item.expanded) {
        item.expanding = true; item.data = decode(item.data, depth + 1); item.expanded = true; item.expanding = false;
        cached += item.data.length;
        if (cached > readingFileLimits.textBytes) throw new Error("MOBI 压缩字典过大。");
      }
      if (length + item.data.length > limit) throw new Error("MOBI 解压内容超过允许大小。");
      output.set(item.data, length); length += item.data.length;
    }
    return output.slice(0, length);
  };
  return decode;
}

export function readMobiDocument(bytes: Uint8Array) {
  if (!magic(bytes, 60, "BOOKMOBI")) throw new Error("此文件不是有效的 MOBI 电子书。");
  const count = u16(bytes, 76);
  if (!count || 78 + count * 8 > bytes.length) throw bad();
  const offsets = Array.from({ length: count }, (_, i) => u32(bytes, 78 + i * 8)); offsets.push(bytes.length);
  if (offsets[0] < 78 + count * 8 || offsets.some((offset, i) => offset > bytes.length || (i > 0 && offset < offsets[i - 1]))) throw bad();
  const records = offsets.slice(0, -1).map((offset, i) => bytes.subarray(offset, offsets[i + 1]));
  const header = records[0]; const compression = u16(header, 0); const textLength = u32(header, 4); const textCount = u16(header, 8);
  if (u16(header, 12)) throw new Error("此 MOBI 已加密，暂不支持 DRM 保护的电子书。");
  if (!magic(header, 16, "MOBI")) throw bad();
  const headerLength = u32(header, 20);
  if (headerLength < 92 || headerLength + 16 > header.length) throw bad();
  if (u32(header, 36) >= 8) throw new Error("此文件使用 Kindle KF8 版式，请转换为 EPUB 后阅读。MOBI 双格式文件可读取兼容正文。");
  if (!textCount || textCount >= count || textLength > readingFileLimits.textBytes) throw new Error("MOBI 正文为空或超过 8 MB。");
  const encoding = u32(header, 28);
  const label = ({ 65001: "utf-8", 1252: "windows-1252", 936: "gb18030" } as Record<number, string>)[encoding];
  if (!label) throw new Error(`暂不支持此 MOBI 文本编码（${encoding}），请转换为 EPUB。`);
  const decoder = new TextDecoder(label, { fatal: true });
  const metadata = new Map<number, string[]>();
  if (headerLength >= 116 && (u32(header, 128) & 64)) {
    const start = 16 + headerLength;
    if (!magic(header, start, "EXTH")) throw bad();
    const end = start + u32(header, start + 4); const entries = u32(header, start + 8);
    if (end > header.length || entries > 4096) throw bad();
    let at = start + 12;
    for (let i = 0; i < entries; i++) {
      const type = u32(header, at); const length = u32(header, at + 4);
      if (length < 8 || at + length > end) throw bad();
      if ([100, 101, 103, 104, 106, 503, 524].includes(type)) metadata.set(type, [...(metadata.get(type) ?? []), decoder.decode(header.subarray(at + 8, at + length)).replace(/\0/g, "")]);
      at += length;
    }
  }
  const recordLimit = Math.min(65536, Math.max(4096, u16(header, 10)));
  const decompress = compression === 1 ? (data: Uint8Array) => data : compression === 2 ? (data: Uint8Array) => decompressPalmDoc(data, recordLimit)
    : compression === 17480 ? huffman(records, u32(header, 112), u32(header, 116), recordLimit) : undefined;
  if (!decompress) throw new Error("暂不支持此 MOBI 压缩格式，请转换为 EPUB。");
  const flags = headerLength >= 228 ? u32(header, 240) : 0;
  const text = new Uint8Array(textLength); let written = 0; let expandedTotal = 0;
  for (let i = 1; i <= textCount; i++) {
    let data = records[i];
    for (let mask = flags >>> 1; mask; mask >>>= 1) if (mask & 1) {
      let length = 0; let shift = 0; let last = data.length - 1;
      for (; last >= 0 && shift < 28; last--, shift += 7) {
        length += (data[last] & 127) * 2 ** shift;
        if (data[last] & 128) break;
      }
      if (last < 0 || shift >= 28 || !length || length > data.length) throw bad();
      data = data.subarray(0, data.length - length);
    }
    if (flags & 1) {
      const length = (data[data.length - 1] & 3) + 1;
      if (length > data.length) throw bad();
      data = data.subarray(0, data.length - length);
    }
    const expanded = decompress(data);
    if (expanded.length > recordLimit || (expandedTotal += expanded.length) > textLength + (i === textCount ? recordLimit : 0)) throw bad();
    const take = Math.min(expanded.length, text.length - written);
    text.set(expanded.subarray(0, take), written); written += take;
  }
  if (written !== textLength) throw bad();
  const titleOffset = u32(header, 84); const titleLength = u32(header, 88);
  if (titleOffset + titleLength > header.length) throw bad();
  return { html: decoder.decode(text), title: metadata.get(503)?.[0] ?? decoder.decode(header.subarray(titleOffset, titleOffset + titleLength)),
    authors: metadata.get(100) ?? [], publisher: metadata.get(101)?.[0], description: metadata.get(103)?.[0], identifier: metadata.get(104)?.[0],
    publishedAt: metadata.get(106)?.[0], language: metadata.get(524)?.[0], records, imageStart: u32(header, 108) };
}
