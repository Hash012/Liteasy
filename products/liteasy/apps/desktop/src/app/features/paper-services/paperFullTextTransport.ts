import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { paperServiceRequest, type PaperServiceConfig } from "./paperServiceTransport";
import type { LocalLibraryImportResult } from "../library/localLibrary.types";

export type FullTextProgress = { received: number; total?: number };
export type NativePdf = { downloadId: string; contentHash: string; byteLength: number };
export async function requestPaperDocument(url: string, options: { probe?: boolean; nativeDownload?: boolean; service?: PaperServiceConfig; signal: AbortSignal; onProgress?: (progress: FullTextProgress) => void }) {
  options.signal.throwIfAborted();
  if (isTauri() && (options.probe || options.nativeDownload)) {
    const requestId = crypto.randomUUID();
    const progress = new Channel<FullTextProgress>(); progress.onmessage = (value) => options.onProgress?.(value);
    const cancel = () => { void invoke("cancel_public_document", { requestId }).catch(() => undefined); };
    const request = invoke<{ status: number; finalUrl: string; bodyBase64: string; downloadId?: string; contentHash?: string; byteLength: number }>("request_public_document", {
      input: { requestId, url, probe: Boolean(options.probe), openalexConfig: options.service?.provider === "openalex" ? options.service : null }, progress,
    });
    options.signal.addEventListener("abort", cancel, { once: true });
    try {
      const result = await request;
      if (options.signal.aborted && result.downloadId) await releaseDownloadedPdf(result.downloadId);
      options.signal.throwIfAborted();
      const response = new Response(Uint8Array.from(atob(result.bodyBase64), (char) => char.charCodeAt(0)), { status: result.status });
      Object.defineProperty(response, "url", { value: result.finalUrl });
      return { response, native: result.downloadId && result.contentHash ? { downloadId: result.downloadId, contentHash: result.contentHash, byteLength: result.byteLength } : undefined };
    } catch (error) { options.signal.throwIfAborted(); throw new Error(String(error)); }
    finally { options.signal.removeEventListener("abort", cancel); }
  }
  const response = await paperServiceRequest({ provider: "crossref", endpoint: new URL(url).origin }, url, {
    authenticate: false, followPublicRedirects: true, maxResponseBytes: options.probe ? 2 * 1024 * 1024 : 200 * 1024 * 1024,
    prefixOnly: options.probe, timeoutMs: options.probe ? 15_000 : 90_000, signal: options.signal,
  });
  return { response, native: undefined };
}
export const releaseDownloadedPdf = (downloadId: string) => invoke<void>("release_downloaded_pdf", { downloadId }).catch(() => undefined);
export async function importDownloadedPdf(downloadId: string, fileName: string, targetFolderPath?: string) {
  const result = await invoke<LocalLibraryImportResult>("import_downloaded_pdf", { downloadId, name: fileName, targetFolderPath });
  return result.snapshot;
}
