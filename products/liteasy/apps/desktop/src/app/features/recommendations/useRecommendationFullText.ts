import { useEffect, useMemo, useRef, useState } from "react";
import { probePaperPdf, knownPaperPdfUrl, type PaperFullTextAvailability, type PaperPdfSource } from "../paper-services/paperPdfResolver";
import type { PaperServiceConfig } from "../paper-services/paperServiceTransport";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import type { RecommendationItem } from "./recommendation.types";

function sourceOf(item: RecommendationItem): PaperPdfSource {
  return { id: item.canonicalId || item.id, doi: item.identityResolution?.doi, arxivId: item.identityResolution?.arxivId,
    url: item.sourceUrl, pdfUrl: item.openAccessPdfUrl };
}
export function withKnownRecommendationPdf(item: RecommendationItem) {
  const url = knownPaperPdfUrl(sourceOf(item));
  return url ? { ...item, openAccessPdfUrl: url } : item;
}

/** Verify prefixes only, with bounded concurrency and an explicit budget for offscreen rows. */
export function useRecommendationFullText(items: RecommendationItem[], enabled: boolean, service?: PaperServiceConfig) {
  const [resolved, setResolved] = useState<Record<string, PaperFullTextAvailability>>({});
  const cache = useRef(resolved);
  const [pending, setPending] = useState(0);
  const [revision, setRevision] = useState(0);
  const [budget, setBudget] = useState(12);
  const scope = JSON.stringify([resolveLocalAccountKey(), service]);
  const sourceKey = (source: PaperPdfSource) => `${scope}:${JSON.stringify(source)}`;
  const sources = JSON.stringify(items.slice(0, budget).map(sourceOf));
  useEffect(() => {
    if (!enabled) { setPending(0); return; }
    const abort = new AbortController();
    const queue = (JSON.parse(sources) as PaperPdfSource[]).filter((source) => {
      const cached = cache.current[sourceKey(source)];
      return !cached?.checkedAt || Date.now() - cached.checkedAt > (cached.status === "available" ? 600_000 : 60_000);
    });
    setPending(queue.length);
    let index = 0;
    const run = async () => {
      while (index < queue.length && !abort.signal.aborted) {
        const source = queue[index++];
        try {
          const result = await probePaperPdf(source, { service, signal: abort.signal });
          if (abort.signal.aborted) return;
          cache.current = Object.fromEntries([...Object.entries(cache.current).filter(([key]) => key !== sourceKey(source)), [sourceKey(source), result]].slice(-300));
          setResolved(cache.current);
        } catch { if (abort.signal.aborted) return; }
        if (!abort.signal.aborted) setPending((count) => Math.max(0, count - 1));
      }
    };
    for (let worker = 0; worker < Math.min(3, queue.length); worker++) void run();
    return () => abort.abort();
  }, [enabled, sources, scope, revision]);
  const enriched = useMemo(() => items.map((item) => {
    const result = resolved[sourceKey(sourceOf(item))];
    const fullText = result?.checkedAt && Date.now() - result.checkedAt < 600_000 ? result : { status: "unknown" as const };
    return { ...withKnownRecommendationPdf(item), fullText, ...(fullText.status === "available" ? { openAccessPdfUrl: fullText.url } : {}) };
  }), [items, resolved, scope]);
  return { items: enriched, pending: enabled ? pending : 0,
    failed: enabled ? enriched.filter((item) => ["error", "blocked"].includes(item.fullText.status)).length : 0,
    unknown: enabled ? enriched.filter((item) => item.fullText.status === "unknown").length : 0,
    checkMore: () => { setBudget((value) => Math.min(items.length, value + 12)); setRevision((value) => value + 1); },
    retry: () => { cache.current = Object.fromEntries(Object.entries(cache.current).filter(([, value]) => value.status === "available")); setResolved(cache.current); setRevision((value) => value + 1); },
  };
}
