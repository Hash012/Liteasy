import { invoke } from "@tauri-apps/api/core";

export type PaperCacheUsage = {
  byteLength: number;
  fileCount: number;
};

export type PaperCacheInvoke = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

/**
 * Cached bodies live on the desktop filesystem, so the browser build cannot reach
 * them. Callers use this to decide whether to offer 「阅读全文」 at all rather than
 * letting the entry fail after a click.
 */
export function isPaperCacheAvailable() {
  return typeof window !== "undefined" &&
    typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
      .__TAURI_INTERNALS__?.invoke === "function";
}

function resolveInvoke(override?: PaperCacheInvoke): PaperCacheInvoke {
  if (override) {
    return override;
  }
  if (!isPaperCacheAvailable()) {
    throw new Error("当前环境没有本地论文缓存，无法把全文取到本地打开。");
  }
  return invoke as PaperCacheInvoke;
}

export type CacheExternalPdfInput = {
  bytes: Uint8Array;
  /** Content fingerprint from the download; the cache is keyed by it so the same
   *  paper reached from different anchors resolves to one file. */
  contentHash: string;
  invoke?: PaperCacheInvoke;
};

export type CacheExternalPdf = (input: CacheExternalPdfInput) => Promise<string>;

export const cacheExternalPdf: CacheExternalPdf = async ({ bytes, contentHash, invoke: override }) =>
  resolveInvoke(override)<string>("cache_external_pdf", {
    bytes: Array.from(bytes),
    contentHash
  });

export type ReadCachedPdfInput = {
  cachePath: string;
  invoke?: PaperCacheInvoke;
};

export type ReadCachedPdf = (input: ReadCachedPdfInput) => Promise<Uint8Array>;

export const readCachedPdf: ReadCachedPdf = async ({ cachePath, invoke: override }) => {
  const bytes = await resolveInvoke(override)<number[]>("read_cached_pdf", {
    cachePath
  });
  return new Uint8Array(bytes);
};

export type PromoteCachedPdfToLibraryInput = {
  cachePath: string;
  fileName: string;
  invoke?: PaperCacheInvoke;
};

export type PromoteCachedPdfToLibrary = (
  input: PromoteCachedPdfToLibraryInput
) => Promise<string>;

/** Moves the body out of the cache into the library, so a promoted paper has exactly
 *  one authoritative copy on disk. Returns its new library path. */
export const promoteCachedPdfToLibrary: PromoteCachedPdfToLibrary = async ({
  cachePath,
  fileName,
  invoke: override
}) =>
  resolveInvoke(override)<string>("promote_cached_pdf_to_library", {
    cachePath,
    fileName
  });

export type PaperCacheUsageInput = { invoke?: PaperCacheInvoke };

export const paperCacheUsage = async ({ invoke: override }: PaperCacheUsageInput = {}) =>
  resolveInvoke(override)<PaperCacheUsage>("paper_cache_usage");

export const clearPaperCache = async ({ invoke: override }: PaperCacheUsageInput = {}) =>
  resolveInvoke(override)<PaperCacheUsage>("clear_paper_cache");
