import { useEffect, useRef, type RefObject } from "react";
import { createObjectStorage } from "../objects/objectStorage";
import { localRecommendationScope } from "./recommendationEvidence";
import { updateRecommendationRow } from "./recommendationCoordinator";
import type { RecommendationItem } from "./recommendation.types";
type Impression = { id: string; candidateId: string; snapshotId: string; at: number; topics: string[]; position: number; visibleFraction: number; visibleMilliseconds: number };
export function useRecommendationExposure(root: RefObject<HTMLDivElement | null>, items: RecommendationItem[]) {
  const scope = localRecommendationScope(), exposure = useRef<Record<string, number>>({}), topicExposure = useRef<Record<string, number>>({});
  const key = "recommendation/v2/impressions";
  useEffect(() => {
    exposure.current = {}; topicExposure.current = {};
    const storage = createObjectStorage(scope, localRecommendationScope);
    void storage.get(key).then(row => {
      for (const event of (row?.value as Impression[] ?? []).filter(event => event.at >= Date.now() - 30 * 86400000)) {
        exposure.current[event.candidateId] = (exposure.current[event.candidateId] ?? 0) + 1;
        for (const topic of event.topics) topicExposure.current[topic] = (topicExposure.current[topic] ?? 0) + 1;
      }
    }).catch(() => {});
  }, [scope]);
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        clearTimeout(timers.get(entry.target)); timers.delete(entry.target);
        if (entry.intersectionRatio < .5 || document.visibilityState !== "visible") continue;
        const id = (entry.target as HTMLElement).dataset.candidateId, index = items.findIndex(item => item.id === id), item = items[index];
        if (!item?.feedSnapshotId) continue;
        const timer = setTimeout(() => {
          if (document.visibilityState !== "visible") return;
          const candidateId = item.canonicalId ?? item.id, topics = item.relatedDocumentTitles ?? [item.relatedDocumentTitle];
          const event: Impression = { id: `${item.feedSnapshotId}:${candidateId}`, candidateId, snapshotId: item.feedSnapshotId!, at: Date.now(), topics, position: Array.from(root.current?.querySelectorAll("[data-candidate-id]") ?? []).indexOf(entry.target), visibleFraction: entry.intersectionRatio, visibleMilliseconds: 1000 };
          void updateRecommendationRow<Impression[]>(createObjectStorage(scope, localRecommendationScope), key, () => [], rows => rows.some(row => row.id === event.id) ? rows : [...rows.filter(row => row.at >= event.at - 30 * 86400000), event].slice(-2000)).then(rows => {
            exposure.current = {}; topicExposure.current = {};
            for (const row of rows) { exposure.current[row.candidateId] = (exposure.current[row.candidateId] ?? 0) + 1; for (const topic of row.topics) topicExposure.current[topic] = (topicExposure.current[topic] ?? 0) + 1; }
          }).catch(() => {});
        }, 1000);
        timers.set(entry.target, timer);
      }
    }, { threshold: [.5] });
    root.current.querySelectorAll("[data-candidate-id]").forEach(node => observer.observe(node));
    const hidden = () => { if (document.visibilityState !== "visible") { timers.forEach(clearTimeout); timers.clear(); } };
    document.addEventListener("visibilitychange", hidden);
    return () => { observer.disconnect(); timers.forEach(clearTimeout); document.removeEventListener("visibilitychange", hidden); };
  }, [scope, items.map(item => `${item.feedSnapshotId}:${item.id}`).join("|")]);
  return { exposure, topicExposure };
}
