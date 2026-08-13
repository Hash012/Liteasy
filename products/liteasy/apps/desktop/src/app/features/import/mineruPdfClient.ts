import { buildPdfChunksFromPages, type ExtractedPdfPage } from "./pdfTextExtractor";
import type { MineruFigure } from "./import.types";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";

type MineruResponse = {
  figureAnalysis?: {
    message?: string;
    selectedFigureIds?: string[];
    status: "completed" | "skipped" | "unavailable";
  };
  figures: MineruFigure[];
  markdown?: string;
  pages: Array<{ page: number; text: string; textExtraction: "mineru" }>;
};

function base64(bytes: Uint8Array) {
  let output = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    output += String.fromCharCode(...bytes.subarray(index, Math.min(index + step, bytes.length)));
  }
  return btoa(output);
}

function endpoint(baseEndpoint: string) {
  const normalized = baseEndpoint.replace(/\/$/, "");
  return `${normalized}/v1/pdf/mineru-extract`;
}

export async function extractMineruPdfResources(input: {
  accessToken?: string;
  endpoint: string;
  loadPdfSource: (sourcePath: string) => Promise<Uint8Array>;
  paper: Paper;
}): Promise<{ chunks: RetrievalChunk[]; figures: MineruFigure[] }> {
  if (!input.paper.sourcePath) {
    throw new Error("该文献没有可供 MinerU 解析的本地 PDF。");
  }
  const bytes = await input.loadPdfSource(input.paper.sourcePath);
  const response = await fetch(endpoint(input.endpoint), {
    body: JSON.stringify({
      bytesBase64: base64(bytes),
      filename: `${input.paper.title.slice(0, 100) || input.paper.id}.pdf`
    }),
    headers: {
      ...(input.accessToken?.trim() ? { Authorization: `Bearer ${input.accessToken.trim()}` } : {}),
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  const payload = await response.json() as MineruResponse & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "MinerU PDF 解析失败。");
  const pages: ExtractedPdfPage[] = payload.pages.map((page) => ({
    page: page.page,
    text: page.text,
    textExtraction: "mineru"
  }));
  const chunks = buildPdfChunksFromPages(input.paper, pages);
  const sourceMarkdown = payload.markdown?.trim();
  if (sourceMarkdown && chunks[0]) {
    chunks[0] = { ...chunks[0], sourceMarkdown };
  }
  return { chunks, figures: payload.figures };
}

export async function extractPdfResourcesWithMineruFallback(input: {
  accessToken?: string;
  endpoint: string;
  extractFallback: () => Promise<RetrievalChunk[]>;
  loadPdfSource: (sourcePath: string) => Promise<Uint8Array>;
  paper: Paper;
}): Promise<{ chunks: RetrievalChunk[]; figures: MineruFigure[] }> {
  try {
    return await extractMineruPdfResources(input);
  } catch {
    return {
      chunks: await input.extractFallback(),
      figures: []
    };
  }
}
