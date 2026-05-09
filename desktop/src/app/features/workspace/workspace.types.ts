export type Paper = {
  id: string;
  title: string;
};

export type WorkspaceState = {
  papers: Paper[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
};
