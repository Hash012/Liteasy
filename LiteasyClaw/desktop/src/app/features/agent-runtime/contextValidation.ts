import { validateSelectedDocumentSet } from "../selection/selectionValidation";
import type { AgentContextSnapshot, AgentContextValidation } from "./agentRuntime.types";

export function validateAgentContextForDocumentWork(context: AgentContextSnapshot): AgentContextValidation {
  const missing: string[] = [];
  const selectionReadiness = validateSelectedDocumentSet(context.selection);

  if (!selectionReadiness.ok) {
    missing.push("selected_document_set");
  }

  const allSelectedDocumentsReady = context.selection.documentIds.every(
    (documentId) => context.ingestion.byDocumentId[documentId] === "ready"
  );

  if (context.selection.documentIds.length > 0 && !allSelectedDocumentsReady) {
    missing.push("ingested_documents");
  }

  if (missing.length > 0) {
    return {
      missing,
      ok: false
    };
  }

  return { ok: true };
}
