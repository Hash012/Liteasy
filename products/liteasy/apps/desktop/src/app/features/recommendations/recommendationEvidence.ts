import { createObjectStorage, type ObjectStorage } from "../objects/objectStorage";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import { loadRecommendationPreferences, saveRecommendationPreferences } from "./recommendationPreferences";
import { recommendationStatePrefix, updateRecommendationRow } from "./recommendationCoordinator";
import { clusterInterests, projectEvidence, type InterestFacet, type LocalEvidence } from "../../../../../../packages/recommendation-core/v2.mjs";
export type EvidenceState = { suppressedEvidence?: string[]; epoch: number; events: LocalEvidence[]; tombstones: string[]; facets: InterestFacet[]; revision: number };
const empty = (): EvidenceState => ({ epoch: 0, events: [], tombstones: [], facets: [], revision: 0 });
export const localRecommendationScope = () => { const owner = resolveLocalAccountKey(); return owner === "guest" ? "local" : owner; };
export function createRecommendationEvidenceStore(scope = localRecommendationScope(), active = localRecommendationScope, storage: ObjectStorage = createObjectStorage(scope, active)) {
  const key = recommendationStatePrefix + "evidence";
  const edit = (fn: (value: EvidenceState) => EvidenceState) => updateRecommendationRow(storage, key, empty, fn);
  const read = async () => (await storage.get(key))?.value as EvidenceState ?? empty();
  return { read,
    async record(event: LocalEvidence) {
      const preferences = loadRecommendationPreferences();
      if ((event.type === "qualified_reading_interval" && !preferences.signals.readingActivity) || (event.type === "user_question_committed" && !preferences.signals.userQuestions) || (event.type === "annotation_committed" && !preferences.useAnnotations) || event.epoch !== preferences.consentEpoch) return;
      if (!["annotation_committed", "user_question_committed", "qualified_reading_interval"].includes(event.type) || !event.text.trim() || event.text.length > 8000 || !Number.isFinite(event.at)) return;
      await edit(value => {
        if (event.epoch !== loadRecommendationPreferences().consentEpoch || value.tombstones.includes(event.sourceId) || value.events.some(row => row.id === event.id)) return value;
        // Revisions replace the previous semantic contribution; style-only saves keep the same event ID.
        const events = [...value.events.filter(row => row.producerActionId !== event.producerActionId), event].filter(row => row.at <= Date.now() && row.at >= Date.now() - 30 * 86400000).slice(-2000);
        return { ...value, events, facets: clusterInterests(projectEvidence(events, { now: Date.now(), epoch: event.epoch, tombstones: value.tombstones }).filter(event => !value.suppressedEvidence?.includes(event.id)), value.facets), revision: value.revision + 1 };
      });
    },
    async forget(sourceIds: string[]) { if (!sourceIds.length) return read(); return edit(value => ({ ...value, epoch: value.epoch + 1, revision: value.revision + 1, events: value.events.filter(row => !sourceIds.includes(row.sourceId)),
      facets: value.facets.filter(facet => !facet.evidenceIds.some(id => value.events.some(event => event.id === id && sourceIds.includes(event.sourceId)))), tombstones: [...new Set([...value.tombstones, ...sourceIds])] })); },
    async clearHistory() { const preferences = loadRecommendationPreferences(); saveRecommendationPreferences({ ...preferences, consentEpoch: preferences.consentEpoch + 1 }); return edit(value => ({ ...value, epoch: value.epoch + 1, revision: value.revision + 1, events: [], facets: value.facets.filter(facet => facet.status === "pinned") })); },
    async updateFacets(facets: InterestFacet[]) { if (facets.length > 6) throw new Error("最多保留六个活跃课题。"); return edit(value => ({ ...value, facets,
      suppressedEvidence: [...new Set([...(value.suppressedEvidence ?? []), ...value.facets.filter(facet => !facets.some(next => next.id === facet.id)).flatMap(facet => [...facet.evidenceIds]).filter(id => !facets.some(facet => facet.evidenceIds.includes(id)))])],
      revision: value.revision + 1 })); },
    async resetInterests() { return edit(value => ({ ...value, facets: [], suppressedEvidence: value.events.map(event => event.id), revision: value.revision + 1 })); },
  };
}
/** Monotonic deltas, capped sample gaps, explicit foreground focus and input-idle cutoff. */
export class QualifiedReadingClock {
  private last = 0;
  private lastInput = -Infinity;
  interact(now: number) { this.lastInput = now; }
  tick(now: number, foreground: boolean) {
    const delta = now - this.last; this.last = now;
    return foreground && now - this.lastInput <= 90_000 && delta >= 0 && delta <= 2500 ? delta : 0;
  }
}
