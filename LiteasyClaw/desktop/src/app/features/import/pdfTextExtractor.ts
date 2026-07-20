import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.mjs?url";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { Paper } from "../workspace/workspace.types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ExtractedPdfPage = {
  page: number;
  text: string;
};

type PdfChunkingOptions = {
  maxChunkCharacters?: number;
  overlapCharacters?: number;
};

const defaultMaxChunkCharacters = 1_600;
const defaultOverlapCharacters = 180;

function normalizePdfText(value: string) {
  return value
    .replace(/-\s*\n\s*(?=[a-z])/g, "")
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

  return pages.flatMap((page) =>
    splitPageText(page.text, maximum, overlap).map((snippet, chunkIndex) => ({
      page: page.page,
      paperId: paper.id,
      paperTitle: paper.title,
      snippet,
      summary: compact(snippet, 360),
      tags: [
        "PDF 全文",
        `第 ${page.page} 页`,
        `页内片段 ${chunkIndex + 1}`,
        ...extractTerms(snippet)
      ]
    }))
  );
}

function isTextItem(item: unknown): item is { hasEOL?: boolean; str: string } {
  return Boolean(
    item &&
      typeof item === "object" &&
      "str" in item &&
      typeof item.str === "string"
  );
}

export async function extractPdfPages(sourcePath: string): Promise<ExtractedPdfPage[]> {
  const document = await pdfjsLib.getDocument(sourcePath).promise;
  try {
    const pages: ExtractedPdfPage[] = [];
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
        pages.push({ page: pageNumber, text });
      }
    }
    return pages;
  } finally {
    await document.destroy();
  }
}

export async function extractPdfChunksForPaper(paper: Paper): Promise<RetrievalChunk[]> {
  if (!paper.sourcePath) {
    throw new Error(`Paper ${paper.id} does not have a PDF source path`);
  }
  const pages = await extractPdfPages(paper.sourcePath);
  const chunks = buildPdfChunksFromPages(paper, pages);
  if (chunks.length === 0) {
    throw new Error(`No selectable text was extracted from ${paper.title}`);
  }
  return chunks;
}
