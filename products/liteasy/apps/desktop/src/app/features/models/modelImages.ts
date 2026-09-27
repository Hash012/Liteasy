// The desktop transport bounds its complete JSON request at 8 MiB; leave room for base64 and text.
export const MODEL_IMAGE_LIMITS = { count: 12, totalBytes: 5 * 1024 * 1024, imageBytes: 5 * 1024 * 1024 };
export type ModelImageInput = { mediaType: string; base64: string; label: string };

/** Only local, already-authorized image bytes are accepted; never fetch a supplied URL. */
export function validateModelImages(images: readonly ModelImageInput[] = []) {
  if (images.length > MODEL_IMAGE_LIMITS.count) throw new Error(`每轮最多读取 ${MODEL_IMAGE_LIMITS.count} 张图片，请分批添加。`);
  let totalBytes = 0;
  for (const image of images) {
    if (typeof image.label !== "string" || image.label.length > 1000 || image.label.includes("\u0000")) throw new Error("图片说明无效或过长，请重新添加。");
    if (!/^image\/(png|jpeg|gif|webp)$/.test(image.mediaType)) throw new Error("图片格式不支持，请使用 PNG、JPEG、GIF 或 WebP。");
    if (!image.base64 || image.base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)) throw new Error("图片数据无效，请重新添加。");
    const bytes = image.base64.length / 4 * 3 - (image.base64.endsWith("==") ? 2 : image.base64.endsWith("=") ? 1 : 0);
    if (bytes < 12) throw new Error("图片数据无效，请重新添加。");
    if (bytes > MODEL_IMAGE_LIMITS.imageBytes) throw new Error("单张图片超过 5 MB，请缩小图片后添加。");
    totalBytes += bytes;
  }
  if (totalBytes > MODEL_IMAGE_LIMITS.totalBytes) throw new Error("本轮图片总量超过 5 MB，请分批添加。");
}
