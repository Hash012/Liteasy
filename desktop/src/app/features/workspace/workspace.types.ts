export type PaperContent = {
  fullText: string;
  pageCount: number;
  importedAt: string;
};

export type Paper = {
  id: string;
  title: string;
  filePath: string;
  content?: PaperContent;
};

export type WorkspaceState = {
  papers: Paper[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
  activePaperId?: string;
};
