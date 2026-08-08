import type { ThinReadingExternalSource } from "../thin-reading/thinReading.types";
import type { ModelTransport } from "../models/modelHttpClient";

export const externalPdfDragMimeType = "application/liteasy-external-pdf";

/** Complete source provenance crosses the drag boundary so metadata-only works can be saved too. */
export type ExternalPdfDragPayload = ThinReadingExternalSource;

export function toExternalPdfDragPayload(source: ThinReadingExternalSource): ExternalPdfDragPayload {
  return source;
}

/**
 * Turns a paper title into a file name both the library import and the cache promotion
 * can write, dropping the characters Windows rejects outright.
 */
export function sanitizeExternalPdfFileName(value: string) {
  const stem = value
    .replace(/[\\/:*?"<>|\p{Cc}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 140) || "Untitled paper";
  return stem.toLowerCase().endsWith(".pdf") ? stem : `${stem}.pdf`;
}

type ExternalPdfPayload = {
  byteLength: number;
  bytesBase64: string;
  contentHash: string;
  contentType: string;
  finalUrl: string;
  sourceId: string;
};

export type DownloadedExternalPdf = {
  bytes: Uint8Array;
  contentHash: string;
  finalUrl: string;
  sourceId: string;
};

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function isExternalPdfPayload(value: unknown): value is ExternalPdfPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Partial<ExternalPdfPayload>;
  return Number.isInteger(payload.byteLength) && (payload.byteLength ?? 0) > 5 &&
    typeof payload.bytesBase64 === "string" && payload.bytesBase64.length > 8 &&
    typeof payload.contentHash === "string" && /^[a-f0-9]{64}$/iu.test(payload.contentHash) &&
    typeof payload.contentType === "string" && /pdf/i.test(payload.contentType) &&
    typeof payload.finalUrl === "string" && /^https:\/\//iu.test(payload.finalUrl) &&
    typeof payload.sourceId === "string";
}

function isPdfBytes(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
}

export async function downloadExternalPdf(input: {
  endpoint: string;
  signal?: AbortSignal;
  source: Pick<ThinReadingExternalSource, "fullTextGrantId" | "fullTextUrl" | "id">;
  transport?: ModelTransport;
}): Promise<DownloadedExternalPdf> {
  if (!input.source.fullTextUrl) {
    throw new Error("该关联论文没有可下载的开放全文。");
  }
  if (!input.source.fullTextGrantId) {
    throw new Error("开放全文授权已失效，请重新检索该文献。");
  }
  const request = {
    body: JSON.stringify({ grantId: input.source.fullTextGrantId, sourceId: input.source.id }),
    headers: { "Content-Type": "application/json" },
    method: "POST" as const,
    signal: input.signal,
    url: `${input.endpoint.replace(/\/+$/, "")}/v1/research/external-pdf`
  };
  const response = input.transport ? await input.transport(request) : await fetch(request.url, request);
  if (!response.ok) {
    throw new Error(`全文下载失败（${response.status}）。`);
  }
  const payload = await response.json();
  if (!isExternalPdfPayload(payload) || payload.sourceId !== input.source.id) {
    throw new Error("全文下载返回的数据无效。");
  }
  const bytes = decodeBase64(payload.bytesBase64);
  if (bytes.byteLength !== payload.byteLength || !isPdfBytes(bytes)) {
    throw new Error("下载的文件未通过 PDF 完整性检查。");
  }
  return {
    bytes,
    contentHash: payload.contentHash,
    finalUrl: payload.finalUrl,
    sourceId: payload.sourceId
  };
}

/**
 * Opens a server-verified PDF in browser builds. Opening the blank tab before the
 * request starts keeps the action inside the user's click gesture and avoids popup
 * blockers after the asynchronous download completes.
 */
export async function openExternalPdfInBrowser(input: {
  endpoint: string;
  source: ThinReadingExternalSource;
  transport?: ModelTransport;
}) {
  const readerWindow = window.open("about:blank", "_blank");
  if (!readerWindow) {
    throw new Error("浏览器阻止了 PDF 阅读页，请允许此站点打开新标签页后重试。");
  }

  readerWindow.document.title = `正在获取《${input.source.title}》`;
  try {
    const download = await downloadExternalPdf(input);
    const pdfBytes = new Uint8Array(download.bytes);
    const objectUrl = URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" }));
    readerWindow.location.replace(objectUrl);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10 * 60 * 1000);
  } catch (error) {
    readerWindow.close();
    throw error;
  }
}
