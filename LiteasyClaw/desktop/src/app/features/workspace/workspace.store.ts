import type {
  Paper,
  SelectedDocumentSet,
  WorkspaceSource,
  WorkspaceState
} from "./workspace.types";

export function createWorkspaceStore() {
  const state: WorkspaceState = {
    papers: [],
    selectedPaperIds: [],
    selectionLocked: false,
    workspaceSource: {
      rootPath: "本地文献库",
      type: "local_library"
    },
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
    updatePapers(papers: Paper[]) {
      if (papers.length === 0) {
        return;
      }
      const updates = new Map(papers.map((paper) => [paper.id, paper]));
      state.papers = state.papers.map((paper) => updates.get(paper.id) ?? paper);
      state.workspaceRevision += 1;
    },
    openWorkspace(
      papers: Paper[],
      workspaceSource: WorkspaceSource = state.workspaceSource
    ) {
      state.papers = [...papers];
      state.selectedPaperIds = [];
      state.selectionLocked = false;
      state.workspaceSource = { ...workspaceSource };
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
      state.workspaceSource = {
        rootPath: "本地文献库",
        type: "local_library"
      };
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
