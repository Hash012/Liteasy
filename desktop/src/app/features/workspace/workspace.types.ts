export type Paper = {
  id: string;
  title: string;
  sourcePath?: string;
};

export type WorkspaceSourceType = "local_library" | "organization_shared";

export type WorkspaceSource = {
  rootPath: string;
  type: WorkspaceSourceType;
};

export type WorkspaceState = {
  papers: Paper[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
  workspaceSource: WorkspaceSource;
  workspaceRevision: number;
};

export type SelectedDocumentSet = {
  documentIds: string[];
  locked: boolean;
};
