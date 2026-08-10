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
import type { ModelTransport } from "../features/models/modelHttpClient";
import { normalizeLiteratureSnapshot } from "../features/paper-identity/literatureRecord";

type UseExternalPaperControllerInput = {
  addExternalPdfToLibrary: (input: {
    bytes: Uint8Array;
    fileName: string;
    title: string;
  }) => Promise<void>;
  cloudLibraryClientFactory?: (endpoint: string) => Pick<
    ReturnType<typeof createCloudLibraryStorageClient>,
    "exportDocument" | "openDocument"
  >;
  endpoint: string;
  promoteCachedPdf?: typeof promoteCachedPdfToLibrary;
  transport: ModelTransport;
  refreshLocalLibrary: () => Promise<unknown>;
  setActiveCenterArtifactId: Dispatch<SetStateAction<string | null>>;
  setActiveReaderPaperId: Dispatch<SetStateAction<string | null>>;
  setOpenReaderPaperIds: Dispatch<SetStateAction<string[]>>;
};

type CloudCachedSource = {
  documentId: string;
  scopeId: string;
  scopeType: "organization" | "user";
};

function cloudCachedSource(sourceId: string | undefined): CloudCachedSource | null {
  const match = sourceId?.match(/^cloud:(organization|user):([^:]+):([^:]+)$/);
  return match ? {
    documentId: match[3],
    scopeId: match[2],
    scopeType: match[1] as CloudCachedSource["scopeType"]
  } : null;
}

const defaultCloudLibraryClientFactory = (endpoint: string) =>
  createCloudLibraryStorageClient({ endpoint });

/**
 * Owns the cache-to-library lifecycle for papers reached through an association.
 * Keeping this out of AppShell preserves the intended layout -> controller -> feature direction.
 */
export function useExternalPaperController({
  addExternalPdfToLibrary,
  cloudLibraryClientFactory = defaultCloudLibraryClientFactory,
  endpoint,
  promoteCachedPdf = promoteCachedPdfToLibrary,
  refreshLocalLibrary,
  setActiveCenterArtifactId,
  setActiveReaderPaperId,
  setOpenReaderPaperIds,
  transport
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
    const download = await downloadExternalPdf({ endpoint, source, transport });
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
  }, [cachedReaderPapers, endpoint, transport]);

  const openExternalFullTextInReader = useCallback(async (
    source: ThinReadingExternalSource
  ) => {
    if (!isPaperCacheAvailable()) {
      await openExternalPdfInBrowser({ endpoint, source, transport });
      return;
    }
    const paper = await resolveExternalCachedPaper(source);
    setCachedReaderPapers((current) => upsertCachedReaderPaper(current, paper));
    setOpenReaderPaperIds((current) =>
      current.includes(paper.id) ? current : [...current, paper.id]
    );
    setActiveReaderPaperId(paper.id);
    setActiveCenterArtifactId(null);
  }, [endpoint, resolveExternalCachedPaper, setActiveCenterArtifactId, setActiveReaderPaperId, setOpenReaderPaperIds, transport]);

  const openCloudDocumentInReader = useCallback(async (input: {
    documentId: string;
    scopeId: string;
    scopeType: "organization" | "user";
    title: string;
  }) => {
    const opened = await cloudLibraryClientFactory(endpoint).openDocument(
      { scopeId: input.scopeId, scopeType: input.scopeType },
      input.documentId
    );
    const literatureValue = opened.authorization.document.metadata?.literature;
    const literature = literatureValue === undefined
      ? undefined
      : normalizeLiteratureSnapshot({ literature: literatureValue, version: 1 }).literature;
    const paper = {
      ...buildCachedReaderPaper({
        cachePath: opened.cachePath,
        contentHash: opened.authorization.document.contentHash,
        libraryReference: {
          documentId: input.documentId,
          revision: opened.authorization.revision,
          scopeId: input.scopeId,
          scopeType: input.scopeType
        },
        sourceId: `cloud:${input.scopeType}:${input.scopeId}:${input.documentId}`,
        title: input.title
      }),
      ...(literature ? { literature } : {})
    };
    setCachedReaderPapers((current) => upsertCachedReaderPaper(current, paper));
    setOpenReaderPaperIds((current) =>
      current.includes(paper.id) ? current : [...current, paper.id]
    );
    setActiveReaderPaperId(paper.id);
    setActiveCenterArtifactId(null);
    return paper;
  }, [cloudLibraryClientFactory, endpoint, setActiveCenterArtifactId, setActiveReaderPaperId, setOpenReaderPaperIds]);

  const promoteCachedPaperToLibrary = useCallback(async (paperId: string) => {
    const cached = findCachedReaderPaper(cachedReaderPapers, paperId);
    if (!cached || promotingPaperIdsRef.current.has(paperId)) return;
    promotingPaperIdsRef.current.add(paperId);
    try {
      const cloudSource = cloudCachedSource(cached.sourceId);
      if (cloudSource) {
        // Online reading is authorized separately from export. Never promote an
        // organization cache file directly because that would bypass export_policy.
        const exported = await cloudLibraryClientFactory(endpoint).exportDocument(
          { scopeId: cloudSource.scopeId, scopeType: cloudSource.scopeType },
          cloudSource.documentId
        );
        await addExternalPdfToLibrary({
          bytes: exported.bytes,
          fileName: sanitizeExternalPdfFileName(cached.title),
          title: cached.title
        });
      } else {
        await promoteCachedPdf({
          cachePath: cached.cachePath,
          fileName: sanitizeExternalPdfFileName(cached.title)
        });
      }
      await refreshLocalLibrary();
      setCachedReaderPapers((current) => removeCachedReaderPaper(current, cached.id));
    } finally {
      promotingPaperIdsRef.current.delete(paperId);
    }
  }, [addExternalPdfToLibrary, cachedReaderPapers, cloudLibraryClientFactory, endpoint, promoteCachedPdf, refreshLocalLibrary]);

  const promoteExternalPaperToLibrary = useCallback(async (
    source: ThinReadingExternalSource
  ) => {
    if (!isPaperCacheAvailable()) {
      if (!source.fullTextUrl) {
        throw new Error("该关联论文暂时没有可下载的开放全文。");
      }
      const download = await downloadExternalPdf({ endpoint, source, transport });
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
    await promoteCachedPdf({
      cachePath: cached.cachePath,
      fileName: sanitizeExternalPdfFileName(source.title)
    });
    setCachedReaderPapers((current) => removeCachedReaderPaper(current, cached.id));
    await refreshLocalLibrary();
  }, [addExternalPdfToLibrary, endpoint, promoteCachedPdf, refreshLocalLibrary, resolveExternalCachedPaper, transport]);

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
