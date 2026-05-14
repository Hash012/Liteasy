import type { WorkspaceState } from "./workspace.types";

export function cloneWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    papers: [...state.papers],
    selectedPaperIds: [...state.selectedPaperIds],
    selectionLocked: state.selectionLocked,
    workspaceRevision: state.workspaceRevision
  };
}
