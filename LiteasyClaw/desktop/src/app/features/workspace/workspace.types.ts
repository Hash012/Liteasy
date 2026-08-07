export type Paper = {
  contentHash?: string;
  forumTopicId?: string;
  forumWorkId?: string;
  arxivId?: string;
  authors?: readonly string[] | string;
  doi?: string;
  id: string;
  semanticScholarId?: string;
  title: string;
  sourcePath?: string;
  year?: number | string;
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
