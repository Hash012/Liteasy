import type {
  Paper,
  SelectedDocumentSet,
  WorkspaceState
} from "./workspace.types";

export function createWorkspaceStore() {
  const state: WorkspaceState = {
    papers: [],
    selectedPaperIds: [],
    selectionLocked: false,
    workspaceRevision: 0
  };

  return {
    addPaper(paper: Paper) {
      if (state.papers.some((item) => item.id === paper.id)) {
        return false;
      }

      state.papers.push(paper);
      return true;
    },
    openWorkspace(papers: Paper[]) {
      state.papers = [...papers];
      state.selectedPaperIds = [];
      state.selectionLocked = false;
      state.workspaceRevision += 1;
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
    closeWorkspace() {
      state.papers = [];
      state.selectedPaperIds = [];
      state.selectionLocked = false;
      state.workspaceRevision += 1;
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
