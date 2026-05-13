import { invoke } from "@tauri-apps/api/core";
import { useMemo, useRef, useState } from "react";
import type { CollectionItem } from "../features/collection/collection.types";
import {
  loadStoredCollectionItems,
  storeCollectionItems
} from "../features/collection/collectionStorage";
import { LibraryPane } from "../features/library/LibraryPane";
import { AssistantPane } from "../features/assistant/AssistantPane";
import liteasyClawLogo from "../../assets/liteasyclaw-logo.jpg";
import { AccountStatusPanel } from "../features/account/AccountStatusPanel";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import { createArtifactStore } from "../features/artifacts/artifact.store";
import type { ArtifactTask, ArtifactTab, ArtifactType } from "../features/artifacts/artifact.types";
import { createWorkspaceStore } from "../features/workspace/workspace.store";
import { createImportStore } from "../features/import/import.store";
import type { ImportJob } from "../features/import/import.types";
import type { Paper, WorkspaceState } from "../features/workspace/workspace.types";
import { executeAction } from "../features/skills/actionRegistry";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
import { buildImportedChunksForPaper } from "../features/import/importFixtures";
import { buildArtifactPreview } from "../features/artifacts/artifactPreview";
import { createSettingsStore } from "../features/settings/settings.store";
import type { SettingsState } from "../features/settings/settings.types";
import { ModelAccessPanel } from "../features/models/ModelAccessPanel";
import type { ControlPlaneTransport } from "../features/models/controlPlaneClient";
import { formatModelExecutionLabel, type ModelExecutionTrace } from "../features/models/modelExecution";
import { usePolicySync } from "../features/models/usePolicySync";
import type { AccountTransport } from "../features/account/accountSessionClient";
import { useAccountSession } from "../features/account/useAccountSession";
import type { RecommendationTransport } from "../features/recommendations/recommendationClient";
import { useRecommendations } from "../features/recommendations/useRecommendations";

const starterPapers: Paper[] = [
  {
    id: "demo-1",
    title: "Attention Is All You Need",
    sourcePath: "fixtures/attention-is-all-you-need.pdf"
  },
  {
    id: "demo-2",
    title: "BERT: Pre-training of Deep Bidirectional Transformers",
    sourcePath: "fixtures/bert-pretraining.pdf"
  }
];

function cloneWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    papers: [...state.papers],
    selectedPaperIds: [...state.selectedPaperIds],
    selectionLocked: state.selectionLocked
  };
}

function cloneSettingsState(state: SettingsState): SettingsState {
  return { ...state };
}

function createSeededSettingsStore(initialSettings?: Partial<SettingsState>) {
  const store = createSettingsStore();

  if (!initialSettings) {
    return store;
  }

  Object.entries(initialSettings).forEach(([target, value]) => {
    store.apply({
      intent: "update_setting",
      target: target as keyof SettingsState,
      value: value as boolean | string
    });
  });

  return store;
}

function getArtifactTitle(type: ArtifactType) {
  if (type === "tree") {
    return "Transformer Tree Analysis";
  }

  if (type === "ppt") {
    return "Transformer PPT Outline";
  }

  return "Transformer Mind Map";
}

type AppShellProps = {
  accountTransport?: AccountTransport;
  controlPlaneTransport?: ControlPlaneTransport;
  initialSettings?: Partial<SettingsState>;
  recommendationTransport?: RecommendationTransport;
};

export function AppShell({
  accountTransport,
  controlPlaneTransport,
  initialSettings,
  recommendationTransport
}: AppShellProps = {}) {
  const workspaceStoreRef = useRef(createWorkspaceStore());
  const importStoreRef = useRef(createImportStore());
  const settingsStoreRef = useRef(createSeededSettingsStore(initialSettings));
  const artifactStore = useMemo(() => createArtifactStore(), []);
  if (workspaceStoreRef.current.getState().papers.length === 0) {
    starterPapers.forEach((paper) => workspaceStoreRef.current.addPaper(paper));
  }

  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(() =>
    cloneWorkspaceState(workspaceStoreRef.current.getState())
  );
  const [settingsState, setSettingsState] = useState<SettingsState>(() =>
    cloneSettingsState(settingsStoreRef.current.getState())
  );
  const [importJobsByDocumentId, setImportJobsByDocumentId] = useState<Record<string, ImportJob>>({});
  const [collectionItems, setCollectionItems] = useState<CollectionItem[]>(() =>
    loadStoredCollectionItems()
  );
  const [artifactTasks, setArtifactTasks] = useState<ArtifactTask[]>([]);
  const [artifactTabs, setArtifactTabs] = useState<ArtifactTab[]>([]);
  const [analysisHint, setAnalysisHint] = useState(
    "先勾选并锁定文献形成选中文献集，再用中栏模态按钮启动分析。"
  );
  const [lastModelExecution, setLastModelExecution] = useState<ModelExecutionTrace | undefined>();

  function syncWorkspace() {
    setWorkspaceState(cloneWorkspaceState(workspaceStoreRef.current.getState()));
  }

  function syncImportJobs() {
    const nextJobs = Object.fromEntries(
      workspaceStoreRef.current.getState().papers.flatMap((paper) => {
        const latestJob = importStoreRef.current.getLatestJobByDocumentId(paper.id);
        return latestJob ? [[paper.id, latestJob]] : [];
      })
    );
    setImportJobsByDocumentId(nextJobs);
  }

  function syncSettings() {
    setSettingsState(cloneSettingsState(settingsStoreRef.current.getState()));
  }

  function collectRecommendation(recommendation: {
    id: string;
    reason: string;
    source: string;
    title: string;
  }) {
    const nextItems = [
      {
        ...recommendation,
        savedAt: new Date().toISOString()
      },
      ...collectionItems.filter((item) => item.id !== recommendation.id)
    ];
    setCollectionItems(nextItems);
    storeCollectionItems(nextItems);
  }

  function syncArtifacts(taskId?: string) {
    const nextTasks = taskId ? [artifactStore.getTask(taskId)!].filter(Boolean) : [];
    setArtifactTasks(nextTasks);
    setArtifactTabs([...artifactStore.getOpenTabs()]);
  }

  function startArtifactTask(
    artifactType: ArtifactType,
    selectedPapers: Paper[],
    importedChunksByPaperId: Record<string, RetrievalChunk[]>
  ) {
    const taskId = artifactStore.createTask(artifactType);
    syncArtifacts(taskId);

    window.setTimeout(() => {
      artifactStore.startTask(taskId);
      syncArtifacts(taskId);
    }, 300);

    window.setTimeout(() => {
      artifactStore.completeTask(taskId, {
        artifactId: "artifact-demo-1",
        preview: buildArtifactPreview(selectedPapers, importedChunksByPaperId),
        title: getArtifactTitle(artifactType),
        type: artifactType
      });
      syncArtifacts(taskId);
    }, 1200);
  }

  function toggleSelection(paperId: string) {
    workspaceStoreRef.current.toggleSelection(paperId);
    syncWorkspace();
  }

  function toggleSelectionLock() {
    const state = workspaceStoreRef.current.getState();
    if (state.selectionLocked) {
      workspaceStoreRef.current.unlockSelection();
      setAnalysisHint("已解除锁定。请调整选中文献集后，再选择模态按钮启动分析。");
    } else {
      workspaceStoreRef.current.lockSelection();
      setAnalysisHint("选中文献集已锁定。可以先交给AI流程，或直接用模态按钮开始分析。");
    }
    syncWorkspace();
  }

  function getSelectedPapers() {
    const selectedIds = new Set(workspaceStoreRef.current.getSelectedDocumentSet().documentIds);
    return workspaceStoreRef.current.getState().papers.filter((paper) => selectedIds.has(paper.id));
  }

  function getImportedSelectedCount() {
    return getSelectedPapers().filter((paper) => {
      const latestJob = importStoreRef.current.getLatestJobByDocumentId(paper.id);
      return latestJob?.status === "parsed";
    }).length;
  }

  function getImportedChunksByPaperId() {
    return Object.fromEntries(
      getSelectedPapers().map((paper) => [
        paper.id,
        importStoreRef.current.getParsedChunksByDocumentId(paper.id)
      ])
    );
  }

  function queueImportForPapers(papers: Paper[], onComplete?: () => void) {
    if (papers.length === 0) {
      return false;
    }

    let pending = 0;

    papers.forEach((paper) => {
      const latestJob = importStoreRef.current.getLatestJobByDocumentId(paper.id);
      if (latestJob?.status === "parsed") {
        return;
      }

      pending += 1;
      const sourcePath = paper.sourcePath ?? `fixtures/${paper.id}.pdf`;
      const jobId = importStoreRef.current.startImport({
        documentId: paper.id,
        sourcePath
      });
      syncImportJobs();

      void invoke("mock_import", { sourcePath }).catch(() => {
        // Keeps browser-only preview usable outside the Tauri shell.
      });

      window.setTimeout(() => {
        importStoreRef.current.markParsing(jobId);
        syncImportJobs();
      }, 400);

      window.setTimeout(() => {
        importStoreRef.current.markParsed(jobId, {
          paperId: paper.id,
          chunks: buildImportedChunksForPaper(paper)
        });
        syncImportJobs();
        pending -= 1;
        if (pending === 0) {
          onComplete?.();
        }
      }, 1200);
    });

    if (pending === 0) {
      onComplete?.();
      return false;
    }

    return true;
  }

  function importSelectedSet() {
    const selectedPapers = getSelectedPapers();

    if (selectedPapers.length === 0) {
      const message = "请先在工作区勾选文件，形成选中文献集。";
      setAnalysisHint(message);
      return message;
    }

    const startedImport = queueImportForPapers(selectedPapers, () => {
      setAnalysisHint("选中文献集已完成导入，现在可以通过中栏模态按钮启动分析。");
    });

    if (startedImport) {
      const message = "已将当前选中文献集交给 AI 流程，正在执行解析与索引。";
      setAnalysisHint(message);
      return message;
    } else {
      const message = "当前选中文献集已经导入完成，可以直接开始分析。";
      setAnalysisHint(message);
      return message;
    }
  }

  function startAnalysis(artifactType: ArtifactType) {
    const selectedSet = workspaceStoreRef.current.getSelectedDocumentSet();
    if (selectedSet.documentIds.length === 0) {
      const message = "请先在工作区勾选文件，形成选中文献集。";
      setAnalysisHint(message);
      return message;
    }

    if (!selectedSet.locked) {
      const message = "请先锁定选中文献集，再启动模态分析。";
      setAnalysisHint(message);
      return message;
    }

    const selectedPapers = getSelectedPapers();
    const importedChunksByPaperId = getImportedChunksByPaperId();
    const startedImport = queueImportForPapers(selectedPapers, () => {
      startArtifactTask(artifactType, selectedPapers, getImportedChunksByPaperId());
      setAnalysisHint("导入完成，已按指定模态启动主工作流。");
    });

    if (!startedImport) {
      startArtifactTask(artifactType, selectedPapers, importedChunksByPaperId);
      const message = "当前选中文献集已导入，正在按指定模态启动分析。";
      setAnalysisHint(message);
      return message;
    }

    const message = "当前选中文献集尚未全部导入，系统会先导入，再自动启动该模态分析。";
    setAnalysisHint(message);
    return message;
  }

  function handleAssistantArtifact(artifactType: ArtifactType) {
    const selectedSet = workspaceStoreRef.current.getSelectedDocumentSet();
    if (selectedSet.documentIds.length === 0) {
      const message = "当前没有可用的选中文献集。请先在左栏勾选并锁定文献。";
      setAnalysisHint(message);
      return message;
    }

    startAnalysis(artifactType);
    return "已根据当前选中文献集触发分支 skill；如尚未导入，系统会先导入再开始生成产物。";
  }

  async function handleImportSelectedSet() {
    const result = await executeAction(
      {
        actionId: "selected_set.import",
        input: {
          source: "selected_document_set"
        }
      },
      {
        importSelectedSet
      }
    );
    setAnalysisHint(result.message);
  }

  async function handleDirectAnalysis(artifactType: ArtifactType) {
    const result = await executeAction(
      {
        actionId: "artifact.start_analysis",
        input: {
          artifactType,
          source: "selected_document_set"
        }
      },
      {
        startArtifactAnalysis: (type) => {
          return startAnalysis(type);
        }
      }
    );
    setAnalysisHint(result.message);
  }

  function setModelAccessMode(mode: SettingsState["models.access_mode"]) {
    settingsStoreRef.current.apply({
      intent: "update_setting",
      target: "models.access_mode",
      value: mode
    });
    syncSettings();
  }

  function handleSettingsChanged(nextSettings: SettingsState) {
    setSettingsState(cloneSettingsState(nextSettings));
  }

  function applyModelPolicySnapshot(nextSettings: Partial<SettingsState>) {
    Object.entries(nextSettings).forEach(([target, value]) => {
      settingsStoreRef.current.apply({
        intent: "update_setting",
        target: target as keyof SettingsState,
        value: value as boolean | string
      });
    });
    syncSettings();
  }

  function setLocalDirectEnabled(enabled: boolean) {
    settingsStoreRef.current.apply({
      intent: "update_setting",
      target: "models.local_direct_enabled",
      value: enabled
    });

    if (!enabled && settingsStoreRef.current.getState()["models.access_mode"] === "local_direct") {
      settingsStoreRef.current.apply({
        intent: "update_setting",
        target: "models.access_mode",
        value: "cloud_proxy"
      });
    }

    syncSettings();
  }

  const {
    lastSyncedAt,
    policySyncMessage,
    policySyncPending,
    policySyncStatus,
    policyVersion,
    syncCloudPolicy
  } = usePolicySync({
    applyModelPolicySnapshot,
    controlPlaneTransport,
    getSettings: () => settingsStoreRef.current.getState()
  });
  const {
    accountMessage,
    accountPending,
    accountSession,
    loginToCloudAccount,
    logoutFromCloudAccount
  } = useAccountSession({
    accountTransport,
    getSettings: () => settingsStoreRef.current.getState()
  });
  const selectedPapers = getSelectedPapers();
  const importedChunksByPaperId = getImportedChunksByPaperId();
  const importedSelectedCount = getImportedSelectedCount();
  const {
    recommendationItems,
    recommendationMessage,
    recommendationPending,
    recommendationStatus
  } = useRecommendations({
    accountSession,
    controlPlaneEndpoint: settingsState["models.control_plane_endpoint"],
    recommendationTransport,
    recommendationsEnabled: settingsState["network.recommendation.enabled"],
    recommendationSortMode: settingsState["network.recommendation.sort_mode"],
    selectedPapers
  });

  return (
    <div className="app-frame">
      <header className="app-topbar">
        <div className="brand">
          <img alt="LiteasyClaw Logo" className="brand-logo" src={liteasyClawLogo} />
          <div className="brand-meta">
            <div className="brand-name">LiteasyClaw</div>
            <div className="brand-tagline">AI-driven paper-assisted reading platform</div>
          </div>
        </div>
        <AccountStatusPanel
          message={accountMessage}
          onLogin={() => {
            void loginToCloudAccount();
          }}
          onLogout={logoutFromCloudAccount}
          pending={accountPending}
          session={accountSession}
        />
      </header>

      <div className="app-shell">
        <aside className="pane left">
          <div className="pane-header">Library</div>
          <div className="pane-body">
            <LibraryPane
              collectionItems={collectionItems}
              importJobs={importJobsByDocumentId}
              onCollectRecommendation={collectRecommendation}
              onImportSelectedSet={() => {
                void handleImportSelectedSet();
              }}
              onToggleLock={toggleSelectionLock}
              onToggleSelection={toggleSelection}
              papers={workspaceState.papers}
              recommendationItems={recommendationItems}
              recommendationMessage={recommendationMessage}
              recommendationPending={recommendationPending}
              recommendationStatus={recommendationStatus}
              selectedPaperIds={workspaceState.selectedPaperIds}
              selectionLocked={workspaceState.selectionLocked}
            />
          </div>
        </aside>
        <main className="pane center">
          <div className="pane-header">Reader</div>
          <div className="pane-body">
            <ArtifactTabs
              analysisHint={analysisHint}
              canStartAnalysis={
                workspaceState.selectedPaperIds.length > 0 && workspaceState.selectionLocked
              }
              onStartAnalysis={(artifactType) => {
                void handleDirectAnalysis(artifactType);
              }}
              selectedCount={workspaceState.selectedPaperIds.length}
              selectionLocked={workspaceState.selectionLocked}
              tabs={artifactTabs}
              tasks={artifactTasks}
            />
          </div>
        </main>
        <section className="pane right">
          <div className="pane-header">Assistant</div>
          <div className="pane-body">
            <div className="right-pane-stack">
              <ModelAccessPanel
                latestExecutionLabel={
                  lastModelExecution ? formatModelExecutionLabel(lastModelExecution) : undefined
                }
                onSyncCloudPolicy={() => {
                  void syncCloudPolicy();
                }}
                onSetAccessMode={setModelAccessMode}
                onToggleLocalDirectEnabled={setLocalDirectEnabled}
                policyVersion={policyVersion}
                settings={settingsState}
                syncedAt={lastSyncedAt}
                syncMessage={policySyncMessage}
                syncPending={policySyncPending}
                syncStatus={policySyncStatus}
              />
              <AssistantPane
                importedChunksByPaperId={importedChunksByPaperId}
                onGenerateArtifact={handleAssistantArtifact}
                onModelExecution={setLastModelExecution}
                onSettingsChanged={handleSettingsChanged}
                onSyncCloudPolicy={syncCloudPolicy}
                selectedPapers={selectedPapers}
                selectedSetStatus={{
                  importedCount: importedSelectedCount,
                  selectedCount: workspaceState.selectedPaperIds.length,
                  selectionLocked: workspaceState.selectionLocked
                }}
                settingsStore={settingsStoreRef.current}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
