import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadUserPaperArtifact, saveUserPaperArtifact } from "../library/userPaperArtifactClient";
import type { PdfPageText } from "./citationAttribution";
import {
  buildPaperFulltextSnapshot, paperFulltextRevision,
  findPagesWithoutTextLayer,
  mergePaperPageTexts,
  normalizePaperFulltext,
  paperFulltextExtractionsToRecord,
  paperFulltextPagesToRecord,
  samePaperPageTexts
} from "./paperFulltextStore";

type TextExtraction = "embedded" | "mineru" | "ocr";

/** Owns the durable PDF text-position snapshot; the renderer only reports finished page text. */
export function usePdfFulltextStore(activePaperId: string | undefined, sourceHash?: string) {
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});
  const [pageTextExtractions, setPageTextExtractions] = useState<Record<number, TextExtraction>>({});
  const [hydratedPaperId, setHydratedPaperId] = useState<string | null>(null);
  const generation = useRef(0);
  const representation = useRef<string>();
  const persistenceTail = useRef(Promise.resolve());
  const extractionRef = useRef<Record<number, TextExtraction>>({});
  const persistedTextsRef = useRef<Record<number, string>>({});
  const persistedExtractionsRef = useRef<Record<number, TextExtraction>>({});

  useEffect(() => {
    generation.current++; representation.current = undefined;
    setPageTexts({});
    setPageTextExtractions({});
    setHydratedPaperId(null);
    extractionRef.current = {};
    persistedTextsRef.current = {};
    persistedExtractionsRef.current = {};
    if (!activePaperId) return;

    const paperId = activePaperId;
    let cancelled = false;
    void loadUserPaperArtifact<unknown>({ artifactKind: "fulltext", paperId })
      .then((snapshot) => {
        const stored = normalizePaperFulltext(snapshot);
        if (cancelled || !stored || stored.sourceHash && stored.sourceHash !== sourceHash) return;
        representation.current = stored.representationRevision;
        const storedTexts = paperFulltextPagesToRecord(stored.pages);
        const storedExtractions = paperFulltextExtractionsToRecord(stored.pages);
        persistedTextsRef.current = storedTexts;
        persistedExtractionsRef.current = storedExtractions;
        setPageTexts((current) => mergePaperPageTexts(storedTexts, current));
        extractionRef.current = { ...storedExtractions, ...extractionRef.current };
        setPageTextExtractions(extractionRef.current);
      })
      .catch(() => {
        // Without a stored snapshot, pages repopulate it as PDF.js renders them.
      })
      .finally(() => {
        if (!cancelled) setHydratedPaperId(paperId);
      });
    return () => {
      cancelled = true;
    };
  }, [activePaperId, sourceHash]);

  useEffect(() => {
    if (!activePaperId || hydratedPaperId !== activePaperId) return;
    const merged = mergePaperPageTexts(persistedTextsRef.current, pageTexts);
    if (samePaperPageTexts(merged, persistedTextsRef.current)) return;
    const mergedExtractions = {
      ...persistedExtractionsRef.current,
      ...pageTextExtractions
    };
    const epoch = generation.current;
    const snapshot = buildPaperFulltextSnapshot({ sourceHash, recipe: "pdfjs-page-text/v1", extractedAt: new Date().toISOString(), pageTextExtractions: mergedExtractions, pageTexts: merged });
    persistenceTail.current = persistenceTail.current.catch(() => {}).then(async () => {
      const revision = await paperFulltextRevision(snapshot);
      if (epoch !== generation.current) return;
      await saveUserPaperArtifact({ artifactKind: "fulltext", paperId: activePaperId, snapshot });
      if (epoch === generation.current) { persistedTextsRef.current = merged; persistedExtractionsRef.current = mergedExtractions; representation.current = revision; }
    }).catch(() => { /* A later page update retries; old immutable snapshots remain readable. */ });
  }, [activePaperId, hydratedPaperId, pageTextExtractions, pageTexts, sourceHash]);

  const onPageTextRendered = useCallback((input: PdfPageText) => {
    if (extractionRef.current[input.page] === "ocr") return;
    setPageTexts((current) => {
      if (!input.text && current[input.page]) return current;
      return current[input.page] === input.text ? current : { ...current, [input.page]: input.text };
    });
    if (input.text) {
      extractionRef.current = { ...extractionRef.current, [input.page]: "embedded" };
      setPageTextExtractions(extractionRef.current);
    }
  }, []);

  const textLayerGaps = useMemo(() => findPagesWithoutTextLayer(pageTexts), [pageTexts]);
  const scannedPages = useMemo(() => new Set([
    ...textLayerGaps.pages,
    ...Object.entries(pageTextExtractions)
      .filter(([, extraction]) => extraction === "ocr")
      .map(([page]) => Number(page))
  ]), [pageTextExtractions, textLayerGaps.pages]);

  return {
    representationForPage: (page: number) => representation.current && persistedTextsRef.current[page] === pageTexts[page] ? representation.current : undefined,
    documentHasNoTextLayer: textLayerGaps.documentHasNoTextLayer,
    hydratedPaperId,
    onPageTextRendered,
    pageTexts,
    scannedPages
  };
}
