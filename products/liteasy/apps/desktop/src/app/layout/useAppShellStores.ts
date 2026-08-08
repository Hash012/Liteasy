import { useMemo, useRef } from "react";
import { createArtifactStore } from "../features/artifacts/artifact.store";
import { createImportStore } from "../features/import/import.store";
import { createSeededSettingsStore } from "../features/settings/settingsStateHelpers";
import type { SettingsState } from "../features/settings/settings.types";
import { createWorkspaceStore } from "../features/workspace/workspace.store";
import type { Paper } from "../features/workspace/workspace.types";

export function useAppShellStores(initialSettings?: Partial<SettingsState>, initialPapers: Paper[] = []) {
  const workspaceStoreRef = useRef(createWorkspaceStore(initialPapers));
  const importStoreRef = useRef(createImportStore());
  const settingsStoreRef = useRef(createSeededSettingsStore(initialSettings));
  const artifactStore = useMemo(() => createArtifactStore(), []);

  return {
    artifactStore,
    importStoreRef,
    settingsStoreRef,
    workspaceStoreRef
  };
}
