import { useEffect, useMemo } from "react";
import type { AssistantComposerSuggestion } from "../features/assistant/assistant.types";
import type { ReadingCatalogEntry } from "../features/library/readingCatalog.types";
import type { LibraryInventory } from "../features/library/libraryInventory";
import type { ObjectEnvelope } from "../features/objects/object.types";
import type { ArtifactTab } from "../features/artifacts/artifact.types";
import type { ProjectCatalog } from "./usePaperProjectsController";
import { createContextCatalogPort } from "../features/context-picker/catalogPort";
import { contextCatalogRelations } from "../features/context-picker/catalogAdapter";
import { reconcileLegacyCollections, type PickerCollection } from "../features/context-picker/collectionRegistry";
import { recordPickerActivity } from "../features/context-picker/recommendations";

export type ContextPickerSources = { projects?: ProjectCatalog[]; objects?: ObjectEnvelope[]; artifacts?: ArtifactTab[];
  inventories?: Record<string, LibraryInventory>; activePaperId?: string; workspaceId?: string; collections?: PickerCollection[] };
export function useContextPickerCatalog(input: ContextPickerSources & { scope: string; entries?: ReadingCatalogEntry[]; suggestions: AssistantComposerSuggestion[] }) {
  const collections = useMemo(() => reconcileLegacyCollections(input.scope, input.entries ?? [], input.collections), [input.scope, input.entries, input.collections]);
  const catalog = useMemo(() => createContextCatalogPort({ scope: input.scope, revision: crypto.randomUUID(), entries: input.entries ?? [], collections,
    assets: input.suggestions, relations: contextCatalogRelations({ ...input, suggestions: input.suggestions }), inventories: input.inventories,
  }), [input.scope, input.entries, input.suggestions, input.projects, input.objects, input.artifacts, input.inventories, collections]);
  return useMemo(() => ({ catalog, activePaperId: input.activePaperId, workspaceId: input.workspaceId ?? "library" }), [catalog, input.activePaperId, input.workspaceId]);
}

export function usePickerReaderActivity(input: { scope: string; activePaperId?: string; visible: boolean }) {
  useEffect(() => {
    if (!input.visible || !input.activePaperId) return;
    const id = `paper-${input.activePaperId}`;
    const record = () => { if (document.visibilityState === "visible") recordPickerActivity(input.scope, { id, at: Date.now(), origin: "reader", kind: "foreground-dwell", durationMs: 2000 }); };
    const timer = setTimeout(record, 2000);
    return () => clearTimeout(timer);
  }, [input.scope, input.activePaperId, input.visible]);
}
