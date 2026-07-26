import type { SubmitAgentTurnRequest } from "../../features/agent-api/agentApi.types";
import type { RetrievalChunk } from "../../features/retrieval/retrieval.types";
import type { Paper } from "../../features/workspace/workspace.types";

export type AgentKnowledgeScopeInput = {
  allPapers: Paper[];
  fallbackImportedChunksByPaperId: Record<string, RetrievalChunk[]>;
  fallbackSelectedPapers: Paper[];
  getImportedChunksForPaperId?: (paperId: string) => RetrievalChunk[];
  request?: SubmitAgentTurnRequest;
};

export function getAgentRequestSelectionPaperIds(request?: SubmitAgentTurnRequest) {
  const selectionAttachment = request?.attachments?.find(
    (attachment) => attachment.source === "selection" && attachment.uri === "liteasy://selection/current"
  );
  const paperIds = selectionAttachment?.metadata?.paperIds;
  return Array.isArray(paperIds) && paperIds.every((paperId) => typeof paperId === "string")
    ? paperIds
    : null;
}

export function resolveAgentKnowledgeScope({
  allPapers,
  fallbackImportedChunksByPaperId,
  fallbackSelectedPapers,
  getImportedChunksForPaperId,
  request
}: AgentKnowledgeScopeInput) {
  const sourcePaperIds = getAgentRequestSelectionPaperIds(request);
  if (!sourcePaperIds) {
    return {
      importedChunksByPaperId: fallbackImportedChunksByPaperId,
      selectedPapers: fallbackSelectedPapers
    };
  }

  const sourcePaperIdSet = new Set(sourcePaperIds);
  return {
    importedChunksByPaperId: Object.fromEntries(
      sourcePaperIds.map((paperId) => [
        paperId,
        getImportedChunksForPaperId?.(paperId) ?? fallbackImportedChunksByPaperId[paperId] ?? []
      ])
    ),
    selectedPapers: allPapers.filter((paper) => sourcePaperIdSet.has(paper.id))
  };
}
