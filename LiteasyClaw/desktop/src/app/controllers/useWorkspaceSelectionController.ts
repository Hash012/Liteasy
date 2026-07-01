import { useMemo, useState } from "react";
import { buildSelectedDocumentSetSnapshot } from "../features/selection/selectionSnapshot";
import type { SelectedDocumentSetSnapshot } from "../features/selection/selection.types";
import type { createWorkspaceStore } from "../features/workspace/workspace.store";
import type { WorkspaceState } from "../features/workspace/workspace.types";
import { cloneWorkspaceState } from "../features/workspace/workspaceStateHelpers";

export type WorkspaceSelectionModel = {
  selectedDocumentSet: SelectedDocumentSetSnapshot;
  workspaceState: WorkspaceState;
};

export type WorkspaceSelectionActions = {
  setWorkspaceState: (workspaceState: WorkspaceState) => void;
};

type UseWorkspaceSelectionControllerInput = {
  workspaceStore: ReturnType<typeof createWorkspaceStore>;
};

export function useWorkspaceSelectionController({
  workspaceStore
}: UseWorkspaceSelectionControllerInput): {
  actions: WorkspaceSelectionActions;
  model: WorkspaceSelectionModel;
} {
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(() =>
    cloneWorkspaceState(workspaceStore.getState())
  );
  const selectedDocumentSet = useMemo(
    () => buildSelectedDocumentSetSnapshot(workspaceState),
    [workspaceState]
  );

  return {
    actions: {
      setWorkspaceState
    },
    model: {
      selectedDocumentSet,
      workspaceState
    }
  };
}
