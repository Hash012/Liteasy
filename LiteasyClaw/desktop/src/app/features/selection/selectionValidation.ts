import type {
  SelectedDocumentSetSnapshot,
  SelectionReadiness,
  SelectionReadinessIssue
} from "./selection.types";

export function validateSelectedDocumentSet(snapshot: SelectedDocumentSetSnapshot): SelectionReadiness {
  const issues: SelectionReadinessIssue[] = [];

  if (snapshot.documentIds.length === 0) {
    issues.push("selection_empty");
  }

  if (!snapshot.locked) {
    issues.push("selection_unlocked");
  }

  if (snapshot.documentIds.length !== snapshot.documents.length) {
    issues.push("documents_missing");
  }

  if (issues.length > 0) {
    return {
      issues,
      ok: false
    };
  }

  return { ok: true };
}
