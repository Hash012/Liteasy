import { useRecommendationPreferences } from "../features/recommendations/recommendationPreferences";
import { createRecommendationEvidenceStore, QualifiedReadingClock } from "../features/recommendations/recommendationEvidence";
import { useEffect, useMemo, useState } from "react";
import type { AssistantComposerSuggestion } from "../features/assistant/assistant.types";
import type { ReadingCatalogEntry } from "../features/library/readingCatalog.types";
import type { LibraryInventory } from "../features/library/libraryInventory";
import type { ObjectEnvelope } from "../features/objects/object.types";
import type { ArtifactTab } from "../features/artifacts/artifact.types";
import type { ProjectCatalog } from "./usePaperProjectsController";
import { createContextCatalogPort } from "../features/context-picker/catalogPort";
import { contextCatalogRelations } from "../features/context-picker/catalogAdapter";
import { reconcileLegacyCollections, type PickerCollection } from "../features/context-picker/collectionRegistry";
import { recordPickerActivity, readRecommendationSettings } from "../features/context-picker/recommendations";

export type ContextPickerSources = { projects?: ProjectCatalog[]; objects?: ObjectEnvelope[]; artifacts?: ArtifactTab[];
  inventories?: Record<string, LibraryInventory>; activePaperId?: string; workspaceId?: string; collections?: PickerCollection[] };
export function useContextPickerCatalog(input: ContextPickerSources & { scope: string; entries?: ReadingCatalogEntry[]; suggestions: AssistantComposerSuggestion[] }) {
  const collections = useMemo(() => reconcileLegacyCollections(input.scope, input.entries ?? [], input.collections), [input.scope, input.entries, input.collections]);
  const catalog = useMemo(() => createContextCatalogPort({ scope: input.scope, revision: crypto.randomUUID(), entries: input.entries ?? [], collections,
    assets: input.suggestions, relations: contextCatalogRelations({ ...input, suggestions: input.suggestions }), inventories: input.inventories,
  }), [input.scope, input.entries, input.suggestions, input.projects, input.objects, input.artifacts, input.inventories, collections]);
  return useMemo(() => ({ catalog, activePaperId: input.activePaperId, workspaceId: input.workspaceId ?? "library" }), [catalog, input.activePaperId, input.workspaceId]);
}

export function usePickerReaderActivity(input: { scope: string; activePaperId?: string; title?: string; visible: boolean }) {
  const preferences = useRecommendationPreferences();
  const [pickerRevision, setPickerRevision] = useState(0);
  useEffect(() => { const changed = () => setPickerRevision(value => value + 1); window.addEventListener("liteasy:context-picker:recommendations", changed); return () => window.removeEventListener("liteasy:context-picker:recommendations", changed); }, []);
  useEffect(() => {
    if (!input.visible || !input.activePaperId || !(preferences.signals.readingActivity || readRecommendationSettings(input.scope).recentReading)) return;
    const paperId = input.activePaperId, clock = new QualifiedReadingClock();
    const store = createRecommendationEvidenceStore(input.scope, () => input.scope);
    let elapsed = 0;
    const interact = () => clock.interact(performance.now());
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) window.addEventListener(type, interact, { passive: true });
    // Opening a tab is not activity. Count only after actual input while the reader is foreground.
    const timer = setInterval(() => {
      elapsed += clock.tick(performance.now(), document.visibilityState === "visible" && document.hasFocus());
      if (elapsed < 30_000) return;
      const at = Date.now(), intervalId = `reading:${paperId}:${Math.floor(at / 86400000)}`;
      recordPickerActivity(input.scope, { id: `paper-${paperId}`, at, origin: "reader", kind: "foreground-dwell", durationMs: elapsed });
      void store.record({ id: intervalId, producerActionId: intervalId, type: "qualified_reading_interval",
        sourceId: `paper:${paperId}`, revision: "foreground-30s-v2", at, epoch: preferences.consentEpoch, text: input.title || "" }).catch(() => {});
      elapsed = 0;
    }, 1000);
    return () => { clearInterval(timer); for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) window.removeEventListener(type, interact); };
  }, [input.scope, input.activePaperId, input.visible, preferences.signals.readingActivity, preferences.consentEpoch, pickerRevision]);
}
