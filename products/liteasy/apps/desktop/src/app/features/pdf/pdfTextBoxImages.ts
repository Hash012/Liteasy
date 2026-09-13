export type PdfTextBoxImages = Record<string, string>;

export function isPdfTextBoxImages(value: unknown): value is PdfTextBoxImages {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value as Record<string, unknown>).length <= 16 &&
    Object.entries(value as Record<string, unknown>).every(([key, data]) =>
      /^[a-zA-Z0-9-]+$/.test(key) && typeof data === "string" && data.length <= 3_000_000 &&
      /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(data));
}

export async function readPdfTextBoxImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error("请选择 PNG、JPEG、GIF 或 WebP 图片。");
  if (file.size > 2 * 1024 * 1024) throw new Error("图片需小于 2 MB。");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败，请重试。"));
    reader.readAsDataURL(file);
  });
}
