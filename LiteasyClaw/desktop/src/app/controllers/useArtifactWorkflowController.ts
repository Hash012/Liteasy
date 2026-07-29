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
import type { ThinReadingBranchSource, ThinReadingDocument } from "../features/thin-reading/thinReading.types";
import type { AgentArtifactGenerationOptions } from "../features/artifacts/useArtifactActions";
import type { DuplicateArtifactGenerationConfirmation } from "../features/artifacts/useArtifactActions";
import {
  createArtifactLocalRepository,
  type ArtifactLocalRepository
} from "../features/artifacts/artifactLocalRepository";
import {
  persistInterruptedArtifactTasks,
  takeInterruptedArtifactTasks,
  validateThinReadingBranchRecoverySnapshot
} from "../features/artifacts/artifactTaskRecovery";

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
  getImportedChunksForPaperId?: (paperId: string) => RetrievalChunk[];
  getIntuechoEndpoint?: () => string;
  getAssistantLanguage?: () => string;
  getActiveReaderPaper?: () => Paper | null;
  getModelDiagnosticContext?: () => {
    endpoint?: string;
    model?: string;
    provider?: string;
  };
  getPaperById?: (paperId: string) => Paper | undefined;
  getSelectedDocumentSet: () => SelectedDocumentSet;
  getSelectedPapers: () => Paper[];
  onAnalysisHint: (message: string) => void;
  queueImportForPapers: (
    papers: Paper[],
    onComplete?: () => void,
    onFailure?: (input: { error: Error; paper: Paper }) => void
  ) => ImportQueueStatus;
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
  generateThinReadingBranch: (input: {
    artifactId: string;
    document: ThinReadingDocument;
    source: ThinReadingBranchSource;
  }) => Promise<void>;
  handleAssistantArtifact: (artifactType: ArtifactType) => string;
  openSkillDocument: (entry: AgentCoreCatalogEntry) => void;
  openArtifact: (artifactId: string) => string;
  regenerateArtifact: (request: ArtifactRegenerationRequest) => string;
  retryInterruptedThinReadingBranch: (taskId: string) => Promise<void>;
  saveSkillDocument: (artifactId: string) => Promise<void>;
  startAnalysis: (artifactType: ArtifactType) => string;
  startAnalysisForPapers: (artifactType: ArtifactType, papers: Paper[]) => string;
  updateSkillDocument: (artifactId: string, markdown: string) => void;
  updateThinReadingDocument: (artifactId: string, nextDocument: ThinReadingDocument) => void;
  syncThinReadingAnnotations: (input: { artifactId: string; document: ThinReadingDocument }) => Promise<void>;
};

export function useArtifactWorkflowController({
  artifactStore,
  artifactResultClient,
  artifactResultScopeKey,
  artifactLocalRepository,
  confirmDuplicateGeneration,
  cancelAgentRun,
  getImportedChunksByPaperId,
  getImportedChunksForPaperId,
  getIntuechoEndpoint,
  getAssistantLanguage,
  getActiveReaderPaper,
  getModelDiagnosticContext,
  getPaperById,
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

  function handleArtifactTasksChanged(tasks: ArtifactTask[]) {
    persistInterruptedArtifactTasks(tasks);
    setArtifactTasks(tasks);
  }

  const artifactActions = useArtifactActions({
    artifactStore,
    artifactResultClient,
    confirmDuplicateGeneration,
    cancelAgentRun,
    getImportedChunksByPaperId,
    getImportedChunksForPaperId,
    getIntuechoEndpoint,
    getAssistantLanguage,
    getActiveReaderPaper,
    getModelDiagnosticContext,
    getPaperById,
    getSelectedDocumentSet,
    getSelectedPapers,
    onAnalysisHint,
    onArtifactCatalogChanged: handleArtifactCatalogChanged,
    onArtifactTabsChanged: setArtifactTabs,
    onArtifactTasksChanged: handleArtifactTasksChanged,
    queueImportForPapers,
    runAgentAnalysis
  });

  useEffect(() => {
    let active = true;

    async function restoreArtifacts() {
      let hydratedThisRun = false;
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
        localHydratedRef.current = true;
        persistenceReadyRef.current = true;
        hydratedThisRun = true;
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

      if (!active) {
        return;
      }
      const interruptedTasks = takeInterruptedArtifactTasks();
      let recoverableBranchCount = 0;
      interruptedTasks.forEach((task) => {
        const tab = task.artifactId
          ? artifactStore.getCatalog().find((candidate) => candidate.artifactId === task.artifactId)
          : undefined;
        const document = tab?.type === "thin_reading" ? tab.thinReadingDocument : undefined;
        const validation = task.thinReadingBranchRecovery && document
          ? validateThinReadingBranchRecoverySnapshot(task.thinReadingBranchRecovery, document)
          : undefined;
        if (validation?.valid) {
          recoverableBranchCount += 1;
          artifactStore.restoreInterruptedTask(task);
          return;
        }
        artifactStore.restoreInterruptedTask({
          ...task,
          thinReadingBranchRecovery: undefined
        });
      });
      if (interruptedTasks.length > 0) {
        onAnalysisHint(
          recoverableBranchCount > 0
            ? "检测到应用重启前未完成的生成任务，已标记为中断；可核验的薄读分支可重新提交同一输入。"
            : "检测到应用重启前未完成的生成任务，已标记为中断；请重新发起生成。"
        );
      }
      if (hydratedThisRun || interruptedTasks.length > 0) {
        artifactActions.syncArtifacts();
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
      generateThinReadingBranch: artifactActions.generateThinReadingBranch,
      handleAssistantArtifact: artifactActions.handleAssistantArtifact,
      openArtifact: artifactActions.openArtifact,
      openSkillDocument: artifactActions.openSkillDocument,
      regenerateArtifact: artifactActions.regenerateArtifact,
      retryInterruptedThinReadingBranch: artifactActions.retryInterruptedThinReadingBranch,
      saveSkillDocument: artifactActions.saveSkillDocument,
      startAnalysis: artifactActions.startAnalysis,
      startAnalysisForPapers: artifactActions.startAnalysisForPapers,
      updateSkillDocument: artifactActions.updateSkillDocument,
      updateThinReadingDocument: artifactActions.updateThinReadingDocument,
      syncThinReadingAnnotations: artifactActions.syncThinReadingAnnotations
    },
    model: {
      artifactCatalog,
      artifactTabs,
      artifactTasks
    }
  };
}
