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
  const localLibraryRootPath = localLibrarySnapshot?.rootPath;
  const selectedDocumentSet = useMemo(
    () => buildSelectedDocumentSetSnapshot(workspaceState),
    [workspaceState]
  );

  useEffect(() => {
    if (!localLibraryRootPath) {
      return;
    }

    workspaceStore.openWorkspace([], {
      rootPath: localLibraryRootPath,
      type: "local_library"
    });
    setWorkspaceState(cloneWorkspaceState(workspaceStore.getState()));
    setWorkspaceLabel(localLibraryRootPath);
  }, [localLibraryRootPath, workspaceStore]);

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
