import { useEffect, useRef, useState } from "react";
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
import type { DuplicateArtifactGenerationConfirmation } from "../features/artifacts/useArtifactActions";
import {
  createArtifactLocalRepository,
  type ArtifactLocalRepository
} from "../features/artifacts/artifactLocalRepository";

type ArtifactStore = ReturnType<typeof createArtifactStore>;

type UseArtifactWorkflowControllerInput = {
  artifactStore: ArtifactStore;
  artifactResultClient: ArtifactResultClient;
  artifactResultScopeKey?: string;
  artifactLocalRepository?: ArtifactLocalRepository;
  confirmDuplicateGeneration?: (
    input: DuplicateArtifactGenerationConfirmation
  ) => boolean;
  cancelAgentRun?: (runId: string, reason?: string) => Promise<void>;
  getImportedChunksByPaperId: () => Record<string, RetrievalChunk[]>;
  getModelDiagnosticContext?: () => {
    endpoint?: string;
    model?: string;
    provider?: string;
  };
  getSelectedDocumentSet: () => SelectedDocumentSet;
  getSelectedPapers: () => Paper[];
  onAnalysisHint: (message: string) => void;
  queueImportForPapers: (papers: Paper[], onComplete?: () => void) => ImportQueueStatus;
  runAgentAnalysis: (
    artifactType: ArtifactType,
    onProgress: (input: {
      agentRunId?: string;
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
  artifactCatalog: ArtifactTab[];
  artifactTabs: ArtifactTab[];
  artifactTasks: ArtifactTask[];
};

type ArtifactWorkflowActions = {
  cancelArtifactTask: (taskId: string) => Promise<string>;
  closeArtifactTab: (artifactId: string) => void;
  deleteArtifact: (artifactId: string) => Promise<string>;
  handleAssistantArtifact: (artifactType: ArtifactType) => string;
  openSkillDocument: (entry: AgentCoreCatalogEntry) => void;
  openArtifact: (artifactId: string) => string;
  regenerateArtifact: (request: ArtifactRegenerationRequest) => string;
  saveSkillDocument: (artifactId: string) => Promise<void>;
  startAnalysis: (artifactType: ArtifactType) => string;
  updateSkillDocument: (artifactId: string, markdown: string) => void;
};

export function useArtifactWorkflowController({
  artifactStore,
  artifactResultClient,
  artifactResultScopeKey,
  artifactLocalRepository,
  confirmDuplicateGeneration,
  cancelAgentRun,
  getImportedChunksByPaperId,
  getModelDiagnosticContext,
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
  const [artifactCatalog, setArtifactCatalog] = useState<ArtifactTab[]>([]);
  const localRepositoryRef = useRef<ArtifactLocalRepository | null>(null);
  const localHydratedRef = useRef(false);
  const persistenceReadyRef = useRef(false);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  if (!localRepositoryRef.current) {
    localRepositoryRef.current = artifactLocalRepository ?? createArtifactLocalRepository();
  }

  function persistCatalog(catalog: ArtifactTab[]) {
    const repository = localRepositoryRef.current;
    if (!repository || !persistenceReadyRef.current) {
      return;
    }
    persistenceQueueRef.current = persistenceQueueRef.current
      .then(() => repository.replace(catalog))
      .catch((error) => {
        onAnalysisHint(
          `本地产物记录保存失败：${error instanceof Error ? error.message : String(error)}`
        );
      });
  }

  function handleArtifactCatalogChanged(catalog: ArtifactTab[]) {
    setArtifactCatalog(catalog);
    persistCatalog(catalog);
  }

  const artifactActions = useArtifactActions({
    artifactStore,
    artifactResultClient,
    confirmDuplicateGeneration,
    cancelAgentRun,
    getImportedChunksByPaperId,
    getModelDiagnosticContext,
    getSelectedDocumentSet,
    getSelectedPapers,
    onAnalysisHint,
    onArtifactCatalogChanged: handleArtifactCatalogChanged,
    onArtifactTabsChanged: setArtifactTabs,
    onArtifactTasksChanged: setArtifactTasks,
    queueImportForPapers,
    runAgentAnalysis
  });

  useEffect(() => {
    let active = true;

    async function restoreArtifacts() {
      if (!localHydratedRef.current) {
        try {
          const cachedArtifacts = await localRepositoryRef.current?.list();
          if (!active) {
            return;
          }
          cachedArtifacts?.forEach(artifactStore.upsertCatalogEntry);
        } catch (error) {
          if (active) {
            onAnalysisHint(
              `加载本地产物记录失败：${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        if (!active) {
          return;
        }
        localHydratedRef.current = true;
        persistenceReadyRef.current = true;
        artifactActions.syncArtifacts();
      }

      try {
        const results = await artifactResultClient.list();
        if (!active) {
          return;
        }
        results.forEach(artifactActions.restoreArtifactResult);
      } catch (error) {
        if (active) {
          onAnalysisHint(
            `同步 Agent 产物服务失败，已保留本地记录：${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    void restoreArtifacts();
    return () => {
      active = false;
    };
  }, [artifactResultClient, artifactResultScopeKey]);

  return {
    actions: {
      cancelArtifactTask: artifactActions.cancelArtifactTask,
      closeArtifactTab: artifactActions.closeArtifactTab,
      deleteArtifact: artifactActions.deleteArtifact,
      handleAssistantArtifact: artifactActions.handleAssistantArtifact,
      openArtifact: artifactActions.openArtifact,
      openSkillDocument: artifactActions.openSkillDocument,
      regenerateArtifact: artifactActions.regenerateArtifact,
      saveSkillDocument: artifactActions.saveSkillDocument,
      startAnalysis: artifactActions.startAnalysis,
      updateSkillDocument: artifactActions.updateSkillDocument
    },
    model: {
      artifactCatalog,
      artifactTabs,
      artifactTasks
    }
  };
}
