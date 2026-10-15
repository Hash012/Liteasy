import type { ImportJob, MineruFigure } from "./import.types";
import type { Paper } from "../workspace/workspace.types";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
export type PdfCapabilityState = { state: "unknown" | "deferred" | "queued" | "running" | "ready" | "partial" | "failed" | "unavailable"; sourceHash?: string; recipe?: string; pages?: number[]; reason?: string };
export type PdfCapabilities = Record<"originalFile" | "pageRaster" | "embeddedPageText" | "textSelection" | "structuredFulltext" | "pageOcr" | "figures" | "searchIndex", PdfCapabilityState>;

/** No count or legacy `parsed` flag implies that unrelated capabilities are complete. */
export function projectPdfCapabilities(paper: Paper, job?: ImportJob, resources?: { textChunks: RetrievalChunk[]; figures: MineruFigure[] } | null): PdfCapabilities {
  const unknown = (): PdfCapabilityState => ({ state: "unknown", sourceHash: paper.contentHash });
  const matching = job?.sourcePath === paper.sourcePath ? job : undefined;
  const state: PdfCapabilityState = { state: matching?.status === "queued" ? "queued" : matching?.status === "parsing" ? "running" : matching?.status === "failed" ? "failed" : "deferred",
    sourceHash: paper.contentHash, recipe: matching?.taskKey, reason: matching?.error };
  const chunks = resources?.textChunks ?? matching?.parsedChunks ?? [], figures = resources?.figures ?? matching?.mineruFigures ?? [];
  const ready = (pages: number[]): PdfCapabilityState => ({ state: "partial", sourceHash: paper.contentHash, recipe: matching?.taskKey, pages: [...new Set(pages)].sort((a, b) => a - b) });
  return { originalFile: paper.sourcePath ? unknown() : { state: "unavailable", reason: "尚未关联原文件" }, pageRaster: unknown(), embeddedPageText: unknown(), textSelection: unknown(),
    structuredFulltext: chunks.length ? ready(chunks.map(chunk => chunk.page)) : state,
    pageOcr: chunks.some(chunk => chunk.textExtraction === "ocr") ? ready(chunks.filter(chunk => chunk.textExtraction === "ocr").map(chunk => chunk.page)) : unknown(),
    figures: figures.length ? ready(figures.map(figure => figure.page)) : { ...state, state: matching?.status === "parsed" ? "unknown" : state.state },
    searchIndex: unknown() };
}
