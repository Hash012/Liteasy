import type { ReadingCatalogFormat } from "../library/readingCatalog.types";

export function readingFormatForName(name: string): ReadingCatalogFormat {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "mobi" || extension === "prc" || extension === "azw") return "mobi";
  if (extension === "html" || extension === "htm") return "html";
  return extension === "epub" || extension === "fb2" || extension === "txt" ? extension : "other";
}
export const isReadableFileName = (name: string) => readingFormatForName(name) !== "other";
export const readingMediaTypes = { epub: "application/epub+zip", mobi: "application/x-mobipocket-ebook", fb2: "application/x-fictionbook+xml", html: "text/html", markdown: "text/markdown", text: "text/plain", other: "application/octet-stream" };
