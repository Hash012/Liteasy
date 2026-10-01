import { useEffect, useMemo, useRef, useState } from "react";
import { discoverPaperPdfUrl, knownPaperPdfUrl, type PaperPdfSource } from "../paper-services/paperPdfResolver";
import type { PaperServiceConfig } from "../paper-services/paperServiceTransport";
import type { RecommendationItem } from "./recommendation.types";

function sourceOf(item: RecommendationItem): PaperPdfSource {
  return { id: item.canonicalId || item.id, doi: item.identityResolution?.doi, arxivId: item.identityResolution?.arxivId,
    url: item.sourceUrl, pdfUrl: item.openAccessPdfUrl };
}
export function withKnownRecommendationPdf(item: RecommendationItem) {
  const url = knownPaperPdfUrl(sourceOf(item));
  return url ? { ...item, openAccessAvailable: true, openAccessPdfUrl: url } : item;
}

/** Availability is a lazy, bounded metadata lookup, not a batch PDF download. */
export function useRecommendationFullText(items: RecommendationItem[], enabled: boolean, service?: PaperServiceConfig) {
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const cache = useRef(resolved);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [retry, setRetry] = useState(0);
  const key = (item: RecommendationItem) => JSON.stringify(sourceOf(item));
  const sources = JSON.stringify(items.filter((item) => !item.openAccessAvailable && !knownPaperPdfUrl(sourceOf(item))).map(sourceOf));
  const serviceKey = JSON.stringify(service);
  useEffect(() => {
    if (!enabled) { setPending(0); return; }
    const abort = new AbortController();
    const queue = (JSON.parse(sources) as PaperPdfSource[]).filter((source) => cache.current[JSON.stringify(source)] === undefined);
    const config = serviceKey ? JSON.parse(serviceKey) as PaperServiceConfig : undefined;
    setPending(queue.length); setFailed(0);
    let index = 0;
    const run = async () => {
      while (index < queue.length && !abort.signal.aborted) {
        const source = queue[index++];
        try {
          const url = await discoverPaperPdfUrl(source, { service: config, signal: abort.signal });
          if (abort.signal.aborted) return;
          cache.current = { ...cache.current, [JSON.stringify(source)]: url || null };
          setResolved(cache.current);
        } catch {
          if (abort.signal.aborted) return;
          setFailed((count) => count + 1);
        }
        if (!abort.signal.aborted) setPending((count) => Math.max(0, count - 1));
      }
    };
    for (let worker = 0; worker < Math.min(3, queue.length); worker++) void run();
    return () => abort.abort();
  }, [enabled, sources, serviceKey, retry]);
  const enriched = useMemo(() => items.map((item) => {
    const url = resolved[key(item)];
    return url ? { ...item, openAccessAvailable: true, openAccessPdfUrl: url } : withKnownRecommendationPdf(item);
  }), [items, resolved]);
  return { items: enriched, pending: enabled ? pending : 0, failed: enabled ? failed : 0, retry: () => setRetry((value) => value + 1) };
}
