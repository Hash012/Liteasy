import { useEffect, useMemo, useState } from "react";
import type { LocalLibrarySnapshot } from "../features/library/localLibrary.types";
import { buildSelectedDocumentSetSnapshot } from "../features/selection/selectionSnapshot";
import type { SelectedDocumentSetSnapshot } from "../features/selection/selection.types";
import type { createWorkspaceStore } from "../features/workspace/workspace.store";
import type { WorkspaceState } from "../features/workspace/workspace.types";
import { cloneWorkspaceState } from "../features/workspace/workspaceStateHelpers";

export type WorkspaceSelectionModel = {
  selectedDocumentSet: SelectedDocumentSetSnapshot;
  workspaceLabel: string;
  workspaceState: WorkspaceState;
};

export type WorkspaceSelectionActions = {
  setWorkspaceLabel: (workspaceLabel: string) => void;
  setWorkspaceState: (workspaceState: WorkspaceState) => void;
};

type UseWorkspaceSelectionControllerInput = {
  localLibrarySnapshot?: LocalLibrarySnapshot | null;
  workspaceStore: ReturnType<typeof createWorkspaceStore>;
};

export function useWorkspaceSelectionController({
  localLibrarySnapshot,
  workspaceStore
}: UseWorkspaceSelectionControllerInput): {
  actions: WorkspaceSelectionActions;
  model: WorkspaceSelectionModel;
} {
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(() =>
    cloneWorkspaceState(workspaceStore.getState())
  );
  const [workspaceLabel, setWorkspaceLabel] = useState("本地文献库");
  const localLibraryEntries = localLibrarySnapshot?.entries;
  const localLibraryRootPath = localLibrarySnapshot?.rootPath;
  const localLibrarySnapshotKey = localLibrarySnapshot
    ? [
        localLibrarySnapshot.rootPath,
        ...localLibrarySnapshot.entries.map((entry) => `${entry.id}:${entry.path}:${entry.title}`)
      ].join("\n")
    : "";
  const selectedDocumentSet = useMemo(
    () => buildSelectedDocumentSetSnapshot(workspaceState),
    [workspaceState]
  );

  useEffect(() => {
    if (!localLibraryRootPath) {
      return;
    }

    workspaceStore.openWorkspace((localLibraryEntries ?? []).map((entry) => ({
      id: entry.id,
      // A bodyless entry has no path to load, so the reader shows "entry only" instead
      // of failing to open a file that was never there.
      sourcePath: entry.path ?? undefined,
      title: entry.title
    })), {
      rootPath: localLibraryRootPath,
      type: "local_library"
    });
    setWorkspaceState(cloneWorkspaceState(workspaceStore.getState()));
    setWorkspaceLabel(localLibraryRootPath);
  }, [localLibrarySnapshotKey, workspaceStore]);

  return {
    actions: {
      setWorkspaceLabel,
      setWorkspaceState
    },
    model: {
      selectedDocumentSet,
      workspaceLabel,
      workspaceState
    }
  };
}
