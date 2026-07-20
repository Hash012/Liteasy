import { useEffect, useState } from "react";
import { useArtifactActions } from "../features/artifacts/useArtifactActions";
import type {
  ArtifactRegenerationRequest,
  ArtifactTask,
  ArtifactTab,
  ArtifactTaskStage,
  ArtifactType
} from "../features/artifacts/artifact.types";
import type { AgentCoreCatalogEntry } from "../features/agent-core/agentCoreConfig";
import type { createArtifactStore } from "../features/artifacts/artifact.store";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import type { Paper, SelectedDocumentSet } from "../features/workspace/workspace.types";
import type { ImportQueueStatus } from "../features/workspace/useWorkspaceActions";
import type { AgentRun } from "../features/agent-api/agentApi.types";
import type { ArtifactResultClient } from "../features/artifacts/artifactResultClient";
import type { AgentArtifactGenerationOptions } from "../features/artifacts/useArtifactActions";

type ArtifactStore = ReturnType<typeof createArtifactStore>;

type UseArtifactWorkflowControllerInput = {
  artifactStore: ArtifactStore;
  artifactResultClient: ArtifactResultClient;
  getImportedChunksByPaperId: () => Record<string, RetrievalChunk[]>;
  getSelectedDocumentSet: () => SelectedDocumentSet;
  getSelectedPapers: () => Paper[];
  onAnalysisHint: (message: string) => void;
  queueImportForPapers: (papers: Paper[], onComplete?: () => void) => ImportQueueStatus;
  runAgentAnalysis: (
    artifactType: ArtifactType,
    onProgress: (input: {
      message: string;
      partialAnswer?: string;
      partialOutlineNodes?: ArtifactTask["partialOutlineNodes"];
      progress: number;
      stage: ArtifactTaskStage;
    }) => void,
    options?: AgentArtifactGenerationOptions
  ) => Promise<AgentRun>;
};

type ArtifactWorkflowModel = {
  artifactTabs: ArtifactTab[];
  artifactTasks: ArtifactTask[];
};

type ArtifactWorkflowActions = {
  closeArtifactTab: (artifactId: string) => void;
  handleAssistantArtifact: (artifactType: ArtifactType) => string;
  openSkillDocument: (entry: AgentCoreCatalogEntry) => void;
  regenerateArtifact: (request: ArtifactRegenerationRequest) => string;
  saveSkillDocument: (artifactId: string) => Promise<void>;
  startAnalysis: (artifactType: ArtifactType) => string;
  updateSkillDocument: (artifactId: string, markdown: string) => void;
};

export function useArtifactWorkflowController({
  artifactStore,
  artifactResultClient,
  getImportedChunksByPaperId,
  getSelectedDocumentSet,
  getSelectedPapers,
  onAnalysisHint,
  queueImportForPapers,
  runAgentAnalysis
}: UseArtifactWorkflowControllerInput): {
  actions: ArtifactWorkflowActions;
  model: ArtifactWorkflowModel;
} {
  const [artifactTasks, setArtifactTasks] = useState<ArtifactTask[]>([]);
  const [artifactTabs, setArtifactTabs] = useState<ArtifactTab[]>([]);
  const artifactActions = useArtifactActions({
    artifactStore,
    artifactResultClient,
    getImportedChunksByPaperId,
    getSelectedDocumentSet,
    getSelectedPapers,
    onAnalysisHint,
    onArtifactTabsChanged: setArtifactTabs,
    onArtifactTasksChanged: setArtifactTasks,
    queueImportForPapers,
    runAgentAnalysis
  });

  useEffect(() => {
    let active = true;
    void artifactResultClient
      .list()
      .then((results) => {
        if (!active) {
          return;
        }
        results.forEach(artifactActions.restoreArtifactResult);
      })
      .catch((error) => {
        if (active) {
          onAnalysisHint(
            `加载已保存 Agent 产物失败：${error instanceof Error ? error.message : String(error)}`
          );
        }
      });
    return () => {
      active = false;
    };
  }, [artifactResultClient]);

  return {
    actions: {
      closeArtifactTab: artifactActions.closeArtifactTab,
      handleAssistantArtifact: artifactActions.handleAssistantArtifact,
      openSkillDocument: artifactActions.openSkillDocument,
      regenerateArtifact: artifactActions.regenerateArtifact,
      saveSkillDocument: artifactActions.saveSkillDocument,
      startAnalysis: artifactActions.startAnalysis,
      updateSkillDocument: artifactActions.updateSkillDocument
    },
    model: {
      artifactTabs,
      artifactTasks
    }
  };
}
