import type { WorkspaceSource } from "../workspace/workspace.types";

export type SelectedDocumentSummary = {
  id: string;
  sourcePath: string;
  title: string;
};

export type SelectedDocumentSetSnapshot = {
  documentIds: string[];
  documents: SelectedDocumentSummary[];
  locked: boolean;
  workspaceRevision: number;
  workspaceSource: WorkspaceSource;
};

export type SelectionReadinessIssue = "selection_empty" | "selection_unlocked" | "documents_missing";

export type SelectionReadiness = { ok: true } | { ok: false; issues: SelectionReadinessIssue[] };
