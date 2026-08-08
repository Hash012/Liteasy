import type { WorkspaceState } from "../workspace/workspace.types";
import type { SelectedDocumentSetSnapshot, SelectedDocumentSummary } from "./selection.types";

export function buildSelectedDocumentSetSnapshot(workspaceState: WorkspaceState): SelectedDocumentSetSnapshot {
  const papersById = new Map(workspaceState.papers.map((paper) => [paper.id, paper]));
  const documents: SelectedDocumentSummary[] = [];

  for (const paperId of workspaceState.selectedPaperIds) {
    const paper = papersById.get(paperId);

    if (!paper) {
      continue;
    }

    documents.push({
      id: paper.id,
      sourcePath: paper.sourcePath ?? "",
      title: paper.title
    });
  }

  return {
    documentIds: [...workspaceState.selectedPaperIds],
    documents,
    locked: workspaceState.selectionLocked,
    workspaceRevision: workspaceState.workspaceRevision,
    workspaceSource: workspaceState.workspaceSource
  };
}
