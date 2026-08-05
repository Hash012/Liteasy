import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadUserPaperArtifact, saveUserPaperArtifact } from "../library/userPaperArtifactClient";
import type { PdfPageText } from "./citationAttribution";
import {
  buildPaperFulltextSnapshot,
  findPagesWithoutTextLayer,
  mergePaperPageTexts,
  normalizePaperFulltext,
  paperFulltextExtractionsToRecord,
  paperFulltextPagesToRecord,
  samePaperPageTexts
} from "./paperFulltextStore";

type TextExtraction = "embedded" | "mineru" | "ocr";

/** Owns the durable PDF text-position snapshot; the renderer only reports finished page text. */
export function usePdfFulltextStore(activePaperId: string | undefined) {
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});
  const [pageTextExtractions, setPageTextExtractions] = useState<Record<number, TextExtraction>>({});
  const [hydratedPaperId, setHydratedPaperId] = useState<string | null>(null);
  const extractionRef = useRef<Record<number, TextExtraction>>({});
  const persistedTextsRef = useRef<Record<number, string>>({});
  const persistedExtractionsRef = useRef<Record<number, TextExtraction>>({});

  useEffect(() => {
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
        if (cancelled || !stored) return;
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
  }, [activePaperId]);

  useEffect(() => {
    if (!activePaperId || hydratedPaperId !== activePaperId) return;
    const merged = mergePaperPageTexts(persistedTextsRef.current, pageTexts);
    if (samePaperPageTexts(merged, persistedTextsRef.current)) return;
    persistedTextsRef.current = merged;
    persistedExtractionsRef.current = {
      ...persistedExtractionsRef.current,
      ...pageTextExtractions
    };
    void saveUserPaperArtifact({
      artifactKind: "fulltext",
      paperId: activePaperId,
      snapshot: buildPaperFulltextSnapshot({
        extractedAt: new Date().toISOString(),
        pageTextExtractions: persistedExtractionsRef.current,
        pageTexts: merged
      })
    }).catch(() => {
      // The in-memory text remains usable; the next page update retries the durable write.
    });
  }, [activePaperId, hydratedPaperId, pageTextExtractions, pageTexts]);

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
    documentHasNoTextLayer: textLayerGaps.documentHasNoTextLayer,
    hydratedPaperId,
    onPageTextRendered,
    pageTexts,
    scannedPages
  };
}
