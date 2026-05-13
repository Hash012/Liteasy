import type {
  Paper,
  SelectedDocumentSet,
  WorkspaceState
} from "./workspace.types";

export function createWorkspaceStore() {
  const state: WorkspaceState = {
    papers: [],
    selectedPaperIds: [],
    selectionLocked: false
  };

  return {
    addPaper(paper: Paper) {
      state.papers.push(paper);
    },
    toggleSelection(id: string) {
      if (state.selectionLocked) {
        return;
      }

      state.selectedPaperIds = state.selectedPaperIds.includes(id)
        ? state.selectedPaperIds.filter((item) => item !== id)
        : [...state.selectedPaperIds, id];
    },
    lockSelection() {
      state.selectionLocked = true;
    },
    unlockSelection() {
      state.selectionLocked = false;
    },
    getSelectedDocumentSet(): SelectedDocumentSet {
      return {
        documentIds: [...state.selectedPaperIds],
        locked: state.selectionLocked
      };
    },
    getState() {
      return state;
    }
  };
}
