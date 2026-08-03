import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";

import {
  addMetadataOnlyLibraryEntry,
  readLocalLibraryPdf
} from "../features/library/libraryFileSystemClient";
import {
  buildCachedReaderPaper,
  findCachedReaderPaper,
  findCachedReaderPaperBySourceId,
  isCachedSourcePath,
  removeCachedReaderPaper,
  upsertCachedReaderPaper
} from "../features/library/cachedReaderPapers";
import {
  downloadExternalPdf,
  openExternalPdfInBrowser,
  sanitizeExternalPdfFileName
} from "../features/library/externalPdfDownload";
import {
  cacheExternalPdf,
  isPaperCacheAvailable,
  promoteCachedPdfToLibrary,
  readCachedPdf
} from "../features/library/paperCacheClient";
import { createCloudLibraryStorageClient } from "../features/library/cloudLibraryStorageClient";
import type { ThinReadingExternalSource } from "../features/thin-reading/thinReading.types";

type UseExternalPaperControllerInput = {
  addExternalPdfToLibrary: (input: {
    bytes: Uint8Array;
    fileName: string;
    title: string;
  }) => Promise<void>;
  endpoint: string;
  refreshLocalLibrary: () => Promise<unknown>;
  setActiveCenterArtifactId: Dispatch<SetStateAction<string | null>>;
  setActiveReaderPaperId: Dispatch<SetStateAction<string | null>>;
  setOpenReaderPaperIds: Dispatch<SetStateAction<string[]>>;
};

/**
 * Owns the cache-to-library lifecycle for papers reached through an association.
 * Keeping this out of AppShell preserves the intended layout -> controller -> feature direction.
 */
export function useExternalPaperController({
  addExternalPdfToLibrary,
  endpoint,
  refreshLocalLibrary,
  setActiveCenterArtifactId,
  setActiveReaderPaperId,
  setOpenReaderPaperIds
}: UseExternalPaperControllerInput) {
  const [cachedReaderPapers, setCachedReaderPapers] = useState<ReturnType<
    typeof buildCachedReaderPaper
  >[]>([]);
  const promotingPaperIdsRef = useRef<Set<string>>(new Set());

  const resolveExternalCachedPaper = useCallback(async (
    source: ThinReadingExternalSource
  ) => {
    const existing = findCachedReaderPaperBySourceId(cachedReaderPapers, source.id);
    if (existing) return existing;
    if (source.localPdfCachePath && source.localPdfContentHash) {
      try {
        await readCachedPdf({ cachePath: source.localPdfCachePath });
        return buildCachedReaderPaper({
          cachePath: source.localPdfCachePath,
          contentHash: source.localPdfContentHash,
          sourceId: source.id,
          title: source.title
        });
      } catch {
        // The cache may have been cleared since the thin-reading artifact was generated.
      }
    }
    const download = await downloadExternalPdf({ endpoint, source });
    const cachePath = await cacheExternalPdf({
      bytes: download.bytes,
      contentHash: download.contentHash
    });
    return buildCachedReaderPaper({
      cachePath,
      contentHash: download.contentHash,
      sourceId: source.id,
      title: source.title
    });
  }, [cachedReaderPapers, endpoint]);

  const openExternalFullTextInReader = useCallback(async (
    source: ThinReadingExternalSource
  ) => {
    if (!isPaperCacheAvailable()) {
      await openExternalPdfInBrowser({ endpoint, source });
      return;
    }
    const paper = await resolveExternalCachedPaper(source);
    setCachedReaderPapers((current) => upsertCachedReaderPaper(current, paper));
    setOpenReaderPaperIds((current) =>
      current.includes(paper.id) ? current : [...current, paper.id]
    );
    setActiveReaderPaperId(paper.id);
    setActiveCenterArtifactId(null);
  }, [endpoint, resolveExternalCachedPaper, setActiveCenterArtifactId, setActiveReaderPaperId, setOpenReaderPaperIds]);

  const openCloudDocumentInReader = useCallback(async (input: {
    documentId: string;
    scopeId: string;
    scopeType: "organization" | "user";
    title: string;
  }) => {
    const opened = await createCloudLibraryStorageClient({ endpoint }).openDocument(
      { scopeId: input.scopeId, scopeType: input.scopeType },
      input.documentId
    );
    const paper = buildCachedReaderPaper({
      cachePath: opened.cachePath,
      contentHash: opened.authorization.document.contentHash,
      sourceId: `cloud:${input.scopeType}:${input.scopeId}:${input.documentId}`,
      title: input.title
    });
    setCachedReaderPapers((current) => upsertCachedReaderPaper(current, paper));
    setOpenReaderPaperIds((current) =>
      current.includes(paper.id) ? current : [...current, paper.id]
    );
    setActiveReaderPaperId(paper.id);
    setActiveCenterArtifactId(null);
    return paper;
  }, [endpoint, setActiveCenterArtifactId, setActiveReaderPaperId, setOpenReaderPaperIds]);

  const promoteCachedPaperToLibrary = useCallback(async (paperId: string) => {
    const cached = findCachedReaderPaper(cachedReaderPapers, paperId);
    if (!cached || promotingPaperIdsRef.current.has(paperId)) return;
    promotingPaperIdsRef.current.add(paperId);
    try {
      await promoteCachedPdfToLibrary({
        cachePath: cached.cachePath,
        fileName: sanitizeExternalPdfFileName(cached.title)
      });
      await refreshLocalLibrary();
      setCachedReaderPapers((current) => removeCachedReaderPaper(current, cached.id));
    } finally {
      promotingPaperIdsRef.current.delete(paperId);
    }
  }, [cachedReaderPapers, refreshLocalLibrary]);

  const promoteExternalPaperToLibrary = useCallback(async (
    source: ThinReadingExternalSource
  ) => {
    if (!isPaperCacheAvailable()) {
      if (!source.fullTextUrl) {
        throw new Error("该关联论文暂时没有可下载的开放全文。");
      }
      const download = await downloadExternalPdf({ endpoint, source });
      await addExternalPdfToLibrary({
        bytes: download.bytes,
        fileName: sanitizeExternalPdfFileName(source.title),
        title: source.title
      });
      return;
    }
    if (!source.fullTextUrl) {
      await addMetadataOnlyLibraryEntry({
        doi: source.doi,
        externalUrl: source.url,
        sourceId: source.id,
        title: source.title
      });
      await refreshLocalLibrary();
      return;
    }
    const cached = await resolveExternalCachedPaper(source);
    await promoteCachedPdfToLibrary({
      cachePath: cached.cachePath,
      fileName: sanitizeExternalPdfFileName(source.title)
    });
    setCachedReaderPapers((current) => removeCachedReaderPaper(current, cached.id));
    await refreshLocalLibrary();
  }, [addExternalPdfToLibrary, endpoint, refreshLocalLibrary, resolveExternalCachedPaper]);

  const loadPdfSource = useCallback((sourcePath: string) =>
    isCachedSourcePath(cachedReaderPapers, sourcePath)
      ? readCachedPdf({ cachePath: sourcePath })
      : readLocalLibraryPdf(sourcePath), [cachedReaderPapers]);

  return {
    cachedReaderPapers,
    loadPdfSource,
    openCloudDocumentInReader,
    openExternalFullTextInReader,
    promoteCachedPaperToLibrary,
    promoteExternalPaperToLibrary
  };
}
