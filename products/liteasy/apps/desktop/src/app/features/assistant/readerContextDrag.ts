import type { ReaderConversationContext } from "./assistantContext.types";

export const readerContextDragMime = "application/x-liteasy-reader-context";

export function readDraggedReaderContext(data: string): ReaderConversationContext | null {
  try {
    const value = JSON.parse(data) as ReaderConversationContext;
    if (!value || value.source !== "pdf_selection" || typeof value.excerpt !== "string" ||
      !value.excerpt.trim() || !Number.isInteger(value.page) || value.page < 1 ||
      typeof value.paperId !== "string" || typeof value.paperTitle !== "string") return null;
    return { excerpt: value.excerpt, page: value.page, paperId: value.paperId,
      paperTitle: value.paperTitle, source: "pdf_selection" };
  } catch { return null; }
}
