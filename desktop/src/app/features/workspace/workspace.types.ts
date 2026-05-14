export type Paper = {
  id: string;
  title: string;
  sourcePath?: string;
};

export type WorkspaceState = {
  papers: Paper[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
  workspaceRevision: number;
};

export type SelectedDocumentSet = {
  documentIds: string[];
  locked: boolean;
};
