export type PdfTextBoxImages = Record<string, string>;

export function isPdfTextBoxImages(value: unknown): value is PdfTextBoxImages {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value as Record<string, unknown>).length <= 16 &&
    Object.entries(value as Record<string, unknown>).every(([key, data]) =>
      /^[a-zA-Z0-9-]+$/.test(key) && typeof data === "string" && data.length <= 3_000_000 &&
      /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(data));
}
