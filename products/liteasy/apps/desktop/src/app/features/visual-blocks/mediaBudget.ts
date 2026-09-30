let occupied = 0;
const limit = 24 * 1024 * 1024;
export function reserveVisualMedia(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || occupied + bytes > limit) throw new Error("当前图片显示预算已满；移出其他图片后可重试。");
  occupied += bytes; let released = false;
  return () => { if (!released) { released = true; occupied -= bytes; } };
}
export const visualMediaUsage = () => occupied;

/** Header inspection happens before giving compressed bytes to the browser decoder.
 * WebP layout: https://developers.google.com/speed/webp/docs/riff_container
 */
export function decodedMediaBytes(bytes: Uint8Array, type: string): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, count: number) => new TextDecoder().decode(bytes.slice(offset, offset + count));
  let width = 0, height = 0, frames = 1;
  if (type === "image/png" && bytes.length >= 24) {
    width = view.getUint32(16); height = view.getUint32(20);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset); if (size > bytes.length - offset - 12) throw new Error("PNG 图片数据不完整。");
      if (ascii(offset + 4, 4) === "acTL" && size >= 8) frames = view.getUint32(offset + 8);
      offset += size + 12;
    }
  } else if (type === "image/jpeg") {
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++]; if (marker === 0xda || marker === 0xd9) break;
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      const length = view.getUint16(offset); if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) { height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break; }
      offset += length;
    }
  } else if (type === "image/webp" && bytes.length >= 30) {
    const chunk = ascii(12, 4);
    if (chunk === "VP8X") { width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16); if (bytes[20] & 2) throw new Error("请将动画图片转换为静态图片后放入白板。"); }
    else if (chunk === "VP8 ") { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
    else if (chunk === "VP8L") { const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
  } else if (type === "image/gif" && bytes.length >= 13) {
    width = view.getUint16(6, true); height = view.getUint16(8, true); frames = 0;
    let offset = 13 + (bytes[10] & 128 ? 3 * (1 << ((bytes[10] & 7) + 1)) : 0);
    const skipBlocks = () => { while (offset < bytes.length) { const size = bytes[offset++]; if (!size) return; offset += size; } };
    while (offset < bytes.length) {
      const marker = bytes[offset++]; if (marker === 0x3b) break;
      if (marker === 0x21) { offset++; skipBlocks(); }
      else if (marker === 0x2c && offset + 9 <= bytes.length) { frames++; const packed = bytes[offset + 8]; offset += 9 + (packed & 128 ? 3 * (1 << ((packed & 7) + 1)) : 0); offset++; skipBlocks(); }
      else break;
    }
  }
  const pixels = width * height * frames;
  if (!width || !height || width > 32768 || height > 32768 || !frames || pixels > 6 * 1024 * 1024) throw new Error("图片尺寸无法安全预览或解码体积过大，请缩小图片后使用。");
  return bytes.length + pixels * 4;
}

let loading = 0;
const queue: Array<() => void> = [];
/** Bound compressed-byte reads as well as decoded textures. Cancelled queued reads never start. */
export async function readVisualMedia<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  if (loading >= 2) await new Promise<void>((resolve, reject) => {
    const take = () => { signal.removeEventListener("abort", abort); resolve(); };
    const abort = () => { const index = queue.indexOf(take); if (index >= 0) queue.splice(index, 1); reject(signal.reason); };
    queue.push(take); signal.addEventListener("abort", abort, { once: true });
  });
  else loading++;
  try { signal.throwIfAborted(); return await read(); } finally { loading--; const next = queue.shift(); if (next) { loading++; next(); } }
}
