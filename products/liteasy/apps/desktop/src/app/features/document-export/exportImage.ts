/** Read encoded dimensions before decode. Static images have bounded pixel and byte budgets. */
export function exportImageDimensions(bytes: Uint8Array, mediaType: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0;
  if (mediaType === "image/png" && bytes.length >= 24) { width = view.getUint32(16); height = view.getUint32(20); }
  else if (mediaType === "image/gif" && bytes.length >= 10) { width = view.getUint16(6, true); height = view.getUint16(8, true); }
  else if (mediaType === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset++] !== 255) throw new Error("JPEG 结构无效");
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw new Error("JPEG 结构无效");
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) { height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); break; }
      offset += length;
    }
  } else if (mediaType === "image/webp" && bytes.length >= 30) {
    const kind = new TextDecoder().decode(bytes.subarray(12, 16));
    if (kind === "VP8X") { width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16); }
    else if (kind === "VP8 ") { width = view.getUint16(26, true) & 16383; height = view.getUint16(28, true) & 16383; }
    else if (kind === "VP8L" && bytes[20] === 47) { const bits = view.getUint32(21, true); width = 1 + (bits & 16383); height = 1 + ((bits >>> 14) & 16383); }
  }
  if (!width || !height || width * height > 40_000_000) throw new Error("图片尺寸无效或超过 4000 万像素。");
  return { width, height };
}
