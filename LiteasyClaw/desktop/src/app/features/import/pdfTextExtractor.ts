import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import { normalizePdfTextForSearch } from "../pdf/pdfTextSearch";
import { ensureReadableStreamAsyncIterator } from "../pdf/pdfStreamCompatibility";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";

ensureReadableStreamAsyncIterator();
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ExtractedPdfPage = {
  textExtraction?: "embedded" | "ocr";
  page: number;
  text: string;
};

type PdfChunkingOptions = {
  maxChunkCharacters?: number;
  overlapCharacters?: number;
};

export type PdfOcrWorker = {
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

export type PdfOcrLanguage = "chi_sim" | "eng" | "eng+chi_sim";

export type PdfExtractionOptions = {
  createOcrWorker?: (language: string) => Promise<PdfOcrWorker>;
  loadPdfSource?: (sourcePath: string) => Promise<Uint8Array>;
  ocrLanguage?: PdfOcrLanguage;
};

const defaultMaxChunkCharacters = 1_600;
const defaultOverlapCharacters = 180;

function normalizePdfText(value: string) {
  return value
    .replace(/-\s*\n\s*(?=[a-z])/g, "")
    .replace(/\u00ad\s*\n?\s*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compact(value: string, maximum: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, maximum).trimEnd()}…`;
}

function splitLongParagraph(paragraph: string, maximum: number) {
  if (paragraph.length <= maximum) {
    return [paragraph];
  }

  const sentences = paragraph.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
  if (sentences.length <= 1) {
    return Array.from(
      { length: Math.ceil(paragraph.length / maximum) },
      (_, index) => paragraph.slice(index * maximum, (index + 1) * maximum)
    );
  }

  const segments: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maximum) {
      segments.push(current);
      current = "";
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) {
    segments.push(current);
  }
  return segments;
}

function splitPageText(
  text: string,
  maximum: number,
  overlap: number
) {
  const paragraphs = normalizePdfText(text)
    .split(/\n{2,}|(?<=\.)\s+(?=[A-Z][A-Za-z])/)
    .flatMap((paragraph) => splitLongParagraph(paragraph.trim(), maximum))
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > maximum) {
      chunks.push(current);
      const overlapText = current.slice(-overlap).replace(/^\S*\s*/, "");
      current = overlapText ? `${overlapText}\n\n${paragraph}` : paragraph;
      if (current.length > maximum) {
        current = current.slice(-maximum);
      }
      continue;
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }

  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function extractTerms(text: string) {
  const candidates = text.match(
    /\b(?:[A-Z]{2,}[A-Z0-9-]*|[A-Z][A-Za-z0-9-]{2,}|[A-Za-z]+(?:[- ][A-Za-z]+){1,3})\b/g
  ) ?? [];
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const normalized = candidate.trim().replace(/\s+/g, " ");
    if (normalized.length < 3 || /^(The|This|That|These|Those|With|From|Figure|Table)$/i.test(normalized)) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .slice(0, 16)
    .map(([term]) => term);
}

export function buildPdfChunksFromPages(
  paper: Paper,
  pages: ExtractedPdfPage[],
  options: PdfChunkingOptions = {}
): RetrievalChunk[] {
  const maximum = Math.max(600, options.maxChunkCharacters ?? defaultMaxChunkCharacters);
  const overlap = Math.max(
    0,
    Math.min(Math.floor(maximum / 3), options.overlapCharacters ?? defaultOverlapCharacters)
  );

  return pages.flatMap((page) => {
    const pageText = normalizePdfText(page.text);
    const pageTextForSearch = normalizePdfTextForSearch(pageText);
    let searchStart = 0;
    return splitPageText(pageText, maximum, overlap).map((snippet, chunkIndex) => {
      const snippetForSearch = normalizePdfTextForSearch(snippet);
      const matchedStart = pageTextForSearch.indexOf(snippetForSearch, searchStart);
      const pageTextStart = matchedStart >= 0 ? matchedStart : searchStart;
      const pageTextEnd = pageTextStart + snippetForSearch.length;
      // Overlapping chunks can share a prefix, so advance by one character rather than past the chunk.
      searchStart = Math.min(pageTextForSearch.length, pageTextStart + 1);
      return {
        page: page.page,
        pageTextEnd,
        pageTextStart,
        paperId: paper.id,
        paperTitle: paper.title,
        snippet,
        summary: compact(snippet, 360),
        textExtraction: page.textExtraction ?? "embedded",
        tags: [
          "PDF 全文",
          ...(page.textExtraction === "ocr" ? ["OCR 识别"] : []),
          `第 ${page.page} 页`,
          `页内片段 ${chunkIndex + 1}`,
          ...extractTerms(snippet)
        ]
      };
    });
  });
}

function isTextItem(item: unknown): item is { hasEOL?: boolean; str: string } {
  return Boolean(
    item &&
      typeof item === "object" &&
      "str" in item &&
      typeof item.str === "string"
  );
}

async function renderPdfPageForOcr(page: PDFPageProxy) {
  if (typeof document === "undefined") {
    throw new Error("OCR 只能在桌面阅读器中运行。");
  }
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("无法创建 OCR 页面画布。");
  }
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas;
}

export function pdfOcrWorkerOptions(language: PdfOcrLanguage) {
  // Bundled language files keep scanned documents readable without a first-run network request.
  if (typeof window !== "undefined") {
    return {
      gzip: true,
      langPath: new URL("/ocr", window.location.href).toString()
    };
  }
  return {};
}

async function createPdfOcrWorker(language: PdfOcrLanguage): Promise<PdfOcrWorker> {
  const { createWorker } = await import("tesseract.js");
  return createWorker(language, 1, pdfOcrWorkerOptions(language));
}

async function extractScannedPdfPageText(page: PDFPageProxy, worker: PdfOcrWorker) {
  const canvas = await renderPdfPageForOcr(page);
  const result = await worker.recognize(canvas);
  return normalizePdfText(result.data.text);
}

export async function extractPdfPages(
  sourcePath: string | Uint8Array,
  options: PdfExtractionOptions = {}
): Promise<ExtractedPdfPage[]> {
  const document = await pdfjsLib.getDocument(sourcePath).promise;
  try {
    const pages: ExtractedPdfPage[] = [];
    const scannedPageNumbers: number[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = normalizePdfText(
        content.items
          .flatMap((item) =>
            isTextItem(item) ? [`${item.str}${item.hasEOL ? "\n" : " "}`] : []
          )
          .join("")
      );
      if (text) {
        pages.push({ page: pageNumber, text, textExtraction: "embedded" });
      } else {
        scannedPageNumbers.push(pageNumber);
      }
    }
    if (scannedPageNumbers.length > 0) {
      let worker: PdfOcrWorker | null = null;
      try {
        worker = await (options.createOcrWorker ?? createPdfOcrWorker)(options.ocrLanguage ?? "eng");
        for (const pageNumber of scannedPageNumbers) {
          const page = await document.getPage(pageNumber);
          let text = "";
          try {
            text = await extractScannedPdfPageText(page, worker);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`第 ${pageNumber} 页没有可选文字，且 OCR 失败：${message}`);
          }
          if (!text) {
            throw new Error(`第 ${pageNumber} 页没有可选文字，OCR 未识别出可用文本。`);
          }
          pages.push({ page: pageNumber, text, textExtraction: "ocr" });
        }
      } finally {
        await worker?.terminate();
      }
    }
    pages.sort((left, right) => left.page - right.page);
    return pages;
  } finally {
    await document.destroy();
  }
}

export async function extractPdfChunksForPaper(
  paper: Paper,
  options: PdfExtractionOptions = {}
): Promise<RetrievalChunk[]> {
  if (!paper.sourcePath) {
    throw new Error(`Paper ${paper.id} does not have a PDF source path`);
  }
  const source = options.loadPdfSource
    ? await options.loadPdfSource(paper.sourcePath)
    : paper.sourcePath;
  const pages = await extractPdfPages(source, options);
  const chunks = buildPdfChunksFromPages(paper, pages);
  if (chunks.length === 0) {
    throw new Error(`No selectable text was extracted from ${paper.title}`);
  }
  return chunks;
}
