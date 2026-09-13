import { hashText } from "../context/objectContext";
import type { ObjectEnvelope } from "./object.types";
export type ObjectAsset = ObjectEnvelope["assets"][number];
export type StagedObjectAsset = ObjectAsset & { base64: string };
export async function stageImage(
  bytes: Uint8Array,
  mediaType: string,
): Promise<StagedObjectAsset> {
  if (bytes.length > 20 * 1024 * 1024 || bytes.length < 12)
    throw new Error("图片大小无效或超过 20 MB。");
  const signature = Array.from(bytes.slice(0, 12));
  const valid =
    (mediaType === "image/png" &&
      signature.slice(0, 8).join() === "137,80,78,71,13,10,26,10") ||
    (mediaType === "image/jpeg" &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255) ||
    (mediaType === "image/gif" &&
      new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/)) ||
    (mediaType === "image/webp" &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP");
  if (!valid)
    throw new Error(
      "图片格式与文件内容不一致，仅支持 PNG、JPEG、GIF 和 WebP。",
    );
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  const sha256 = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.slice(offset, offset + 8192));
  return {
    assetId: sha256,
    sha256,
    byteLength: bytes.length,
    mediaType,
    base64: btoa(binary),
  };
}
export async function stageDataUrl(dataUrl: string) {
  const match =
    /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
      dataUrl,
    );
  if (!match || dataUrl.length > 28 * 1024 * 1024)
    throw new Error("旧白板图片不受支持，原快照保持不变。");
  return stageImage(
    Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)),
    match[1],
  );
}
export function assetDescriptor({
  base64: _base64,
  ...descriptor
}: StagedObjectAsset): ObjectAsset {
  return descriptor;
}
export { hashText };
