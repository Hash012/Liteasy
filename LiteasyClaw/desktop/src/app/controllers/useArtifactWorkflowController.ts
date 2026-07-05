import { useState } from "react";
import { useArtifactActions } from "../features/artifacts/useArtifactActions";
import type { ArtifactTask, ArtifactTab, ArtifactType } from "../features/artifacts/artifact.types";
import type { createArtifactStore } from "../features/artifacts/artifact.store";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { Paper, SelectedDocumentSet } from "../features/workspace/workspace.types";
import type { ImportQueueStatus } from "../features/workspace/useWorkspaceActions";

type ArtifactStore = ReturnType<typeof createArtifactStore>;

type UseArtifactWorkflowControllerInput = {
  artifactStore: ArtifactStore;
  getImportedChunksByPaperId: () => Record<string, RetrievalChunk[]>;
  getSelectedDocumentSet: () => SelectedDocumentSet;
  getSelectedPapers: () => Paper[];
  onAnalysisHint: (message: string) => void;
  queueImportForPapers: (papers: Paper[], onComplete?: () => void) => ImportQueueStatus;
};

type ArtifactWorkflowModel = {
  artifactTabs: ArtifactTab[];
  artifactTasks: ArtifactTask[];
};

type ArtifactWorkflowActions = {
  closeArtifactTab: (artifactId: string) => void;
  handleAssistantArtifact: (artifactType: ArtifactType) => string;
  startAnalysis: (artifactType: ArtifactType) => string;
};

export function useArtifactWorkflowController({
  artifactStore,
  getImportedChunksByPaperId,
  getSelectedDocumentSet,
  getSelectedPapers,
  onAnalysisHint,
  queueImportForPapers
}: UseArtifactWorkflowControllerInput): {
  actions: ArtifactWorkflowActions;
  model: ArtifactWorkflowModel;
} {
  const [artifactTasks, setArtifactTasks] = useState<ArtifactTask[]>([]);
  const [artifactTabs, setArtifactTabs] = useState<ArtifactTab[]>([]);
  const artifactActions = useArtifactActions({
    artifactStore,
    getImportedChunksByPaperId,
    getSelectedDocumentSet,
    getSelectedPapers,
    onAnalysisHint,
    onArtifactTabsChanged: setArtifactTabs,
    onArtifactTasksChanged: setArtifactTasks,
    queueImportForPapers
  });

  return {
    actions: {
      closeArtifactTab: artifactActions.closeArtifactTab,
      handleAssistantArtifact: artifactActions.handleAssistantArtifact,
      startAnalysis: artifactActions.startAnalysis
    },
    model: {
      artifactTabs,
      artifactTasks
    }
  };
}
