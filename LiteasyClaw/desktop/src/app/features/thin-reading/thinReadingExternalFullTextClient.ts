import { buildPdfChunksFromPages, extractPdfPages } from "../import/pdfTextExtractor";
import {
  cacheExternalPdf,
  isPaperCacheAvailable,
  type CacheExternalPdf
} from "../library/paperCacheClient";
import type { ModelTransportResponse } from "../models/modelHttpClient";
import type { Paper } from "../workspace/workspace.types";
import type { ThinReadingExternalEvidence, ThinReadingExternalSource } from "./thinReading.types";

export type ThinReadingExternalPdfTransport = (request: {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  signal?: AbortSignal;
  url: string;
}) => Promise<ModelTransportResponse>;

type ExternalPdfPayload = {
  byteLength: number;
  bytesBase64: string;
  contentHash: string;
  contentType: string;
  finalUrl: string;
  sourceId: string;
};

const maximumFullTextSources = 4;
const maximumEvidenceChunksPerSource = 5;

async function defaultTransport(request: Parameters<ThinReadingExternalPdfTransport>[0]) {
  return fetch(request.url, request);
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", value as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isExternalPdfPayload(value: unknown): value is ExternalPdfPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Partial<ExternalPdfPayload>;
  return Number.isInteger(payload.byteLength) && (payload.byteLength ?? 0) > 5 &&
    typeof payload.bytesBase64 === "string" && payload.bytesBase64.length > 8 &&
    typeof payload.contentHash === "string" && /^[a-f0-9]{64}$/.test(payload.contentHash) &&
    typeof payload.contentType === "string" &&
    typeof payload.finalUrl === "string" && /^https:\/\//i.test(payload.finalUrl) &&
    typeof payload.sourceId === "string";
}

function tokenizeForRanking(value: string) {
  const normalized = value.toLowerCase();
  const wordTokens = normalized.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? [];
  const hanTokens = (normalized.match(/[\p{Script=Han}]+/gu) ?? []).flatMap((sequence) => (
    sequence.length <= 2
      ? [sequence]
      : Array.from({ length: sequence.length - 1 }, (_, index) => sequence.slice(index, index + 2))
  ));
  return [...wordTokens, ...hanTokens];
}

function scoreChunksWithBm25(
  source: ThinReadingExternalSource,
  chunks: ReturnType<typeof buildPdfChunksFromPages>
) {
  const queryTerms = [...new Set(tokenizeForRanking(
    [source.title, ...(source.retrievalQueries ?? [source.retrievalQuery])].join(" ")
  ))];
  const documents = chunks.map((chunk) => tokenizeForRanking(chunk.snippet));
  const averageLength = documents.reduce((total, tokens) => total + tokens.length, 0) /
    Math.max(1, documents.length);
  const documentFrequency = new Map(queryTerms.map((term) => [
    term,
    documents.filter((tokens) => tokens.includes(term)).length
  ]));
  const k1 = 1.2;
  const b = 0.75;
  return documents.map((tokens) => {
    const frequencies = new Map<string, number>();
    tokens.forEach((token) => frequencies.set(token, (frequencies.get(token) ?? 0) + 1));
    return queryTerms.reduce((score, term) => {
      const frequency = frequencies.get(term) ?? 0;
      if (frequency === 0) return score;
      const frequencyAcrossDocuments = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (documents.length - frequencyAcrossDocuments + 0.5) /
        (frequencyAcrossDocuments + 0.5));
      const normalizedFrequency = frequency * (k1 + 1) /
        (frequency + k1 * (1 - b + b * tokens.length / Math.max(1, averageLength)));
      return score + idf * normalizedFrequency;
    }, 0);
  });
}

function selectRelevantEvidence(
  source: ThinReadingExternalSource,
  chunks: ReturnType<typeof buildPdfChunksFromPages>,
  contentHash: string,
  finalUrl: string
): ThinReadingExternalEvidence[] {
  const scores = scoreChunksWithBm25(source, chunks);
  const pageChunkCounts = new Map<number, number>();
  return chunks
    .map((chunk, chunkIndex) => {
      const pageChunkIndex = pageChunkCounts.get(chunk.page) ?? 0;
      pageChunkCounts.set(chunk.page, pageChunkIndex + 1);
      return {
      chunk,
      pageChunkIndex,
      score: scores[chunkIndex]
      };
    })
    .sort((left, right) => right.score - left.score || left.chunk.page - right.chunk.page || left.pageChunkIndex - right.pageChunkIndex)
    .slice(0, maximumEvidenceChunksPerSource)
    .map(({ chunk, pageChunkIndex }) => ({
      contentHash,
      finalUrl,
      id: `external-evidence:${encodeURIComponent(source.id)}:${contentHash}:p${chunk.page}:c${pageChunkIndex}`,
      page: chunk.page,
      pageTextEnd: chunk.pageTextEnd,
      pageTextStart: chunk.pageTextStart,
      quote: chunk.snippet,
      textExtraction: "embedded" as const
    }));
}

export function createThinReadingExternalFullTextClient(input: {
  cachePdf?: CacheExternalPdf;
  endpoint: string;
  transport?: ThinReadingExternalPdfTransport;
}) {
  return async (source: ThinReadingExternalSource, signal?: AbortSignal): Promise<ThinReadingExternalSource> => {
    if (!source.fullTextUrl) return source;
    const response = await (input.transport ?? defaultTransport)({
      body: JSON.stringify({ sourceId: source.id, url: source.fullTextUrl }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
      url: `${input.endpoint.replace(/\/+$/, "")}/v1/research/external-pdf`
    });
    if (!response.ok) throw new Error(`外部 PDF 获取失败（${response.status}）`);
    const payload = await response.json();
    if (!isExternalPdfPayload(payload) || payload.sourceId !== source.id) {
      throw new Error("外部 PDF 返回格式无效");
    }
    const bytes = decodeBase64(payload.bytesBase64);
    if (bytes.byteLength !== payload.byteLength || await sha256(bytes) !== payload.contentHash) {
      throw new Error("外部 PDF 完整性校验失败");
    }
    let localPdfCachePath: string | undefined;
    const cachePdf = input.cachePdf ?? (isPaperCacheAvailable() ? cacheExternalPdf : undefined);
    if (cachePdf) {
      try {
        localPdfCachePath = await cachePdf({
          bytes,
          contentHash: payload.contentHash
        });
      } catch {
        // Evidence extraction can continue when a local cache write is temporarily unavailable.
      }
    }
    const pages = await extractPdfPages(bytes, { ocrEnabled: false });
    const paper: Paper = { id: source.id, title: source.title };
    const chunks = buildPdfChunksFromPages(paper, pages);
    if (chunks.length === 0) throw new Error("外部 PDF 没有可引用的内嵌文本");
    return {
      ...source,
      evidenceBasis: "full_text",
      fullTextEvidence: selectRelevantEvidence(source, chunks, payload.contentHash, payload.finalUrl),
      ...(localPdfCachePath ? {
        localPdfCachePath,
        localPdfContentHash: payload.contentHash
      } : {})
    };
  };
}

export async function enrichThinReadingSourcesWithFullText(input: {
  cachePdf?: CacheExternalPdf;
  endpoint: string;
  maximumSources?: number;
  signal?: AbortSignal;
  sources: readonly ThinReadingExternalSource[];
  transport?: ThinReadingExternalPdfTransport;
}) {
  const client = createThinReadingExternalFullTextClient(input);
  const maximumSources = Math.max(0, input.maximumSources ?? maximumFullTextSources);
  const candidates = input.sources.filter((source) => source.fullTextUrl).slice(0, maximumSources);
  const enriched = await Promise.allSettled(candidates.map((source) => client(source, input.signal)));
  if (input.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
  const byId = new Map(enriched.flatMap((result) => result.status === "fulfilled" ? [[result.value.id, result.value] as const] : []));
  return input.sources.map((source) => byId.get(source.id) ?? source);
}
