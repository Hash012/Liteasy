import { useEffect, useRef, useState } from "react";
import { useArtifactActions } from "../features/artifacts/useArtifactActions";
import type {
  ArtifactCatalogLoadState,
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
import type { MineruFigure } from "../features/import/import.types";
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
  getMineruFiguresForPaperId?: (paperId: string) => MineruFigure[];
  getIntuechoEndpoint?: () => string;
  getIntuechoSessionId?: () => string | undefined;
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
  isAgentModelAccessAvailable?: () => boolean;
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
  artifactCatalogLoadState: ArtifactCatalogLoadState;
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
  reloadArtifactCatalog: () => Promise<void>;
  renameArtifact: (artifactId: string, requestedName: string) => Promise<string>;
  regenerateArtifact: (request: ArtifactRegenerationRequest) => string;
  retryInterruptedThinReadingBranch: (taskId: string) => Promise<void>;
  startAnalysis: (artifactType: ArtifactType) => string;
  startAnalysisForPapers: (artifactType: ArtifactType, papers: Paper[]) => string;
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
  getMineruFiguresForPaperId,
  getIntuechoEndpoint,
  getIntuechoSessionId,
  getAssistantLanguage,
  getActiveReaderPaper,
  getModelDiagnosticContext,
  getPaperById,
  getSelectedDocumentSet,
  getSelectedPapers,
  isAgentModelAccessAvailable,
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
  const [artifactCatalogLoadState, setArtifactCatalogLoadState] =
    useState<ArtifactCatalogLoadState>({ status: "idle" });
  const artifactResultClientRef = useRef(artifactResultClient);
  const catalogRequestRef = useRef(0);
  const localRepositoryRef = useRef<ArtifactLocalRepository | null>(null);
  const persistenceReadyRef = useRef(false);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  if (!localRepositoryRef.current) {
    localRepositoryRef.current = artifactLocalRepository ?? createArtifactLocalRepository();
  }
  artifactResultClientRef.current = artifactResultClient;

  function persistCatalog(catalog: ArtifactTab[]) {
    const repository = localRepositoryRef.current;
    if (artifactResultScopeKey || !repository || !persistenceReadyRef.current) {
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
    persistInterruptedArtifactTasks(tasks, artifactResultScopeKey);
    setArtifactTasks(tasks);
  }

  const artifactActions = useArtifactActions({
    artifactStore,
    artifactResultClient,
    confirmDuplicateGeneration,
    cancelAgentRun,
    getImportedChunksByPaperId,
    getImportedChunksForPaperId,
    getMineruFiguresForPaperId,
    getIntuechoEndpoint,
    getIntuechoSessionId,
    getAssistantLanguage,
    getActiveReaderPaper,
    getModelDiagnosticContext,
    getPaperById,
    getSelectedDocumentSet,
    getSelectedPapers,
    isAgentModelAccessAvailable,
    onAnalysisHint,
    onArtifactCatalogChanged: handleArtifactCatalogChanged,
    onArtifactTabsChanged: setArtifactTabs,
    onArtifactTasksChanged: handleArtifactTasksChanged,
    queueImportForPapers,
    runAgentAnalysis
  });

  async function reloadArtifactCatalog() {
    const requestId = ++catalogRequestRef.current;
    setArtifactCatalogLoadState({ status: "loading" });
    persistenceReadyRef.current = false;
    artifactStore.clearAccountArtifacts();
    artifactActions.syncArtifacts();

    try {
      if (artifactResultScopeKey) {
        const results = await artifactResultClientRef.current.list();
        if (requestId !== catalogRequestRef.current) {
          return;
        }
        results.forEach(artifactActions.restoreArtifactResult);
      } else {
        const cachedArtifacts = await localRepositoryRef.current?.list() ?? [];
        if (requestId !== catalogRequestRef.current) {
          return;
        }
        cachedArtifacts.forEach(artifactStore.upsertCatalogEntry);
        persistenceReadyRef.current = true;
      }
      artifactActions.syncArtifacts();
      setArtifactCatalogLoadState({ status: "ready" });
    } catch (error) {
      if (requestId !== catalogRequestRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setArtifactCatalogLoadState({ message, status: "error" });
      onAnalysisHint(
        artifactResultScopeKey
          ? `同步 Agent 产物服务失败：${message}`
          : `加载本地产物记录失败：${message}`
      );
    }
  }

  useEffect(() => {
    let active = true;

    async function restoreArtifacts() {
      await reloadArtifactCatalog();
      if (!active) {
        return;
      }
      const interruptedTasks = takeInterruptedArtifactTasks(artifactResultScopeKey);
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
      if (interruptedTasks.length > 0) {
        artifactActions.syncArtifacts();
      }
    }

    void restoreArtifacts();
    return () => {
      active = false;
      catalogRequestRef.current += 1;
    };
  }, [artifactResultScopeKey]);

  return {
    actions: {
      cancelArtifactTask: artifactActions.cancelArtifactTask,
      closeArtifactTab: artifactActions.closeArtifactTab,
      deleteArtifact: artifactActions.deleteArtifact,
      generateThinReadingBranch: artifactActions.generateThinReadingBranch,
      handleAssistantArtifact: artifactActions.handleAssistantArtifact,
      openArtifact: artifactActions.openArtifact,
      reloadArtifactCatalog,
      renameArtifact: async (artifactId, requestedName) => {
        const current = artifactStore.getCatalog().find((tab) => tab.artifactId === artifactId);
        if (!current || current.type === "skill_doc") {
          return "找不到可重命名的已保存多模态产物。";
        }
        try {
          const renamed = await artifactResultClient.rename(artifactId, requestedName);
          if (!artifactStore.renameCatalogEntry(artifactId, renamed.title)) {
            return "产物已改名，但当前列表未找到对应条目；刷新文献库后即可看到。";
          }
          artifactActions.syncArtifacts();
          const message = `已重命名多模态产物：${renamed.title}`;
          onAnalysisHint(message);
          return message;
        } catch (error) {
          const message = `重命名多模态产物失败：${error instanceof Error ? error.message : String(error)}`;
          onAnalysisHint(message);
          return message;
        }
      },
      openSkillDocument: artifactActions.openSkillDocument,
      regenerateArtifact: artifactActions.regenerateArtifact,
      retryInterruptedThinReadingBranch: artifactActions.retryInterruptedThinReadingBranch,
      startAnalysis: artifactActions.startAnalysis,
      startAnalysisForPapers: artifactActions.startAnalysisForPapers,
      updateThinReadingDocument: artifactActions.updateThinReadingDocument,
      syncThinReadingAnnotations: artifactActions.syncThinReadingAnnotations
    },
    model: {
      artifactCatalog,
      artifactCatalogLoadState,
      artifactTabs,
      artifactTasks
    }
  };
}
