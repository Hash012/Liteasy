import { useMemo, useRef } from "react";
import { createArtifactStore } from "../features/artifacts/artifact.store";
import { createImportStore } from "../features/import/import.store";
import { createSeededSettingsStore } from "../features/settings/settingsStateHelpers";
import type { SettingsState } from "../features/settings/settings.types";
import { createWorkspaceStore } from "../features/workspace/workspace.store";
import { starterPapers } from "./starterPapers";

export function useAppShellStores(initialSettings?: Partial<SettingsState>) {
  const workspaceStoreRef = useRef(createWorkspaceStore());
  const workspaceSeededRef = useRef(false);
  const importStoreRef = useRef(createImportStore());
  const settingsStoreRef = useRef(createSeededSettingsStore(initialSettings));
  const artifactStore = useMemo(() => createArtifactStore(), []);

  if (!workspaceSeededRef.current) {
    starterPapers.forEach((paper) => workspaceStoreRef.current.addPaper(paper));
    workspaceSeededRef.current = true;
  }

  return {
    artifactStore,
    importStoreRef,
    settingsStoreRef,
    workspaceStoreRef
  };
}
