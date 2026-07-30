import { invoke } from "@tauri-apps/api/core";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useWorkspaceActions } from "../features/workspace/useWorkspaceActions";
import { useRegisteredWorkspaceActions } from "../features/workspace/useRegisteredWorkspaceActions";
import type { ImportJob } from "../features/import/import.types";
import { cloneSettingsState } from "../features/settings/settingsStateHelpers";
import type { SettingsState } from "../features/settings/settings.types";
import { resolvePdfReadingBackground } from "../features/settings/viewSettings";
import { useProfileActions } from "../features/profile/useProfileActions";
import {
  createAcademicProfileExport,
  downloadAcademicProfileExport
} from "../features/profile/profileExport";
import { toRecommendationResearchProfile } from "../features/profile/profile.types";
import type { ControlPlaneTransport } from "../features/models/controlPlaneClient";
import type { ModelTransport } from "../features/models/modelHttpClient";
import { usePolicySync } from "../features/models/usePolicySync";
import { useModelSettingsActions } from "../features/models/useModelSettingsActions";
import {
  resolveLocalDevCloudEndpoint,
  type DevCloudEnvLike
} from "../features/models/localDevCloudEndpoint";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import { FloatingModalityButton } from "../features/artifacts/FloatingModalityButton";
import type {
  ArtifactOutlineNode,
  ArtifactTaskStage,
  ArtifactType
} from "../features/artifacts/artifact.types";
import { createArtifactResultClient } from "../features/artifacts/artifactResultClient";
import type { AgentArtifactGenerationOptions } from "../features/artifacts/useArtifactActions";
import type { AgentRun } from "../features/agent-api/agentApi.types";
import type { AccountTransport } from "../features/account/accountSessionClient";
import type { RecommendationTransport } from "../features/recommendations/recommendationClient";
import type { DocumentMetadataTransport } from "../features/metadata/documentMetadataClient";
import { useLeftRailNavigation, type LeftRailView } from "./useLeftRailNavigation";
import type { OrganizationGovernanceTransport } from "../features/organization/organizationGovernanceClient";
import type { OrganizationListTransport } from "../features/organization/organizationListClient";
import type { OrganizationSummaryTransport } from "../features/organization/organizationSummaryClient";
import type { OrganizationSharedLibraryManifestTransport } from "../features/organization/organizationSharedLibraryManifestClient";
import { ActivityBar } from "./ActivityBar";
import { LeftPane, type LeftPaneProps } from "./LeftPane";
import { AppDialogs } from "./AppDialogs";
import { ReaderPane } from "./ReaderPane";
import { AssistantSidebar } from "./AssistantSidebar";
import { useAppShellStores } from "./useAppShellStores";
import { starterPapers } from "./starterPapers";
import { useConnectivity } from "../features/network/useConnectivity";
import { PaneResizer } from "./PaneResizer";
import { usePaneLayout } from "./usePaneLayout";
import { useLocalLibrary } from "../features/library/useLocalLibrary";
import type { LibraryPaperChildItem } from "../features/library/LibraryPane";
import type { LocalLibrarySnapshot } from "../features/library/localLibrary.types";
import {
  moveLocalLibraryResource,
  persistDroppedPdfFiles,
  readLocalLibraryPdf
} from "../features/library/libraryFileSystemClient";
import { useWorkspaceSelectionController } from "../controllers/useWorkspaceSelectionController";
import { useCloudAccountController } from "../controllers/useCloudAccountController";
import { useArtifactWorkflowController } from "../controllers/useArtifactWorkflowController";
import { useKnowledgeSyncController } from "../controllers/useKnowledgeSyncController";
import { useOrganizationShellController } from "../controllers/useOrganizationShellController";
import type {
  ActionContext,
  DockMoveItemId,
  DockMoveTargetRegion
} from "../features/skills/actionRegistry";
import type { ReaderConversationContext } from "../features/assistant/assistantContext.types";
import { executeUIDslActionRef } from "../features/agent-runtime/dynamicActionExecutor";
import { DynamicCanvas } from "../features/generative-ui/DynamicCanvas";
import type { PdfEvidenceTarget } from "../features/pdf/PdfReader";
import type { UIDslActionRef, UIDslDocument } from "../features/generative-ui/generativeUi.types";
import { generateWorkbenchOverlayUIDslDocument } from "../features/generative-ui/uiDslGenerator";
import { DockRegion } from "../features/dock/DockRegion";
import { useDockLayout } from "../features/dock/useDockLayout";
import type { DockItemId, DockRegionId } from "../features/dock/dock.types";
import { DockLayoutControls } from "./DockLayoutControls";
import { DocumentPdfRegular } from "@fluentui/react-icons";
import {
  createGeneratedThemeStyle,
  type GeneratedThemeInput
} from "../features/theme/generatedTheme";
import { useAssistantAgentController } from "../controllers/agent/useAssistantAgentController";
import { runAgentArtifactAnalysis } from "../controllers/agent/runAgentArtifactAnalysis";
import { getDefaultModelForProvider } from "../features/models/modelPolicy";
import type { AcademicProfileTransport } from "../features/profile/academicProfileClient";

type AppShellProps = {
  accountTransport?: AccountTransport;
  academicProfileTransport?: AcademicProfileTransport;
  controlPlaneTransport?: ControlPlaneTransport;
  documentMetadataTransport?: DocumentMetadataTransport;
  initialSettings?: Partial<SettingsState>;
  localDevCloudEnv?: DevCloudEnvLike;
  organizationGovernanceTransport?: OrganizationGovernanceTransport;
  organizationListTransport?: OrganizationListTransport;
  organizationSharedLibraryManifestTransport?: OrganizationSharedLibraryManifestTransport;
  organizationTransport?: OrganizationSummaryTransport;
  localLibraryLoader?: () => Promise<LocalLibrarySnapshot>;
  modelTransport?: ModelTransport;
  recommendationTransport?: RecommendationTransport;
};

type RuntimeTheme =
  | { kind: "default" }
  | { kind: "preset"; preset: "playful" }
  | { kind: "generated"; theme: GeneratedThemeInput };

export function AppShell({
  accountTransport,
  academicProfileTransport,
  controlPlaneTransport,
  documentMetadataTransport,
  initialSettings,
  localDevCloudEnv,
  organizationGovernanceTransport,
  organizationListTransport,
  organizationSharedLibraryManifestTransport,
  organizationTransport,
  localLibraryLoader,
  modelTransport,
  recommendationTransport
}: AppShellProps = {}) {
  const { artifactStore, importStoreRef, settingsStoreRef, workspaceStoreRef } = useAppShellStores(initialSettings);
  const agentArtifactRunnerRef = useRef<(
    artifactType: ArtifactType,
    onProgress: (input: {
      agentRunId?: string;
      message: string;
      partialAnswer?: string;
      partialOutlineNodes?: ArtifactOutlineNode[];
      progress: number;
      stage: ArtifactTaskStage;
    }) => void,
    options?: AgentArtifactGenerationOptions
  ) => Promise<AgentRun>>(
    async () => {
      throw new Error("Agent artifact runner is not ready");
    }
  );
  const agentCancelRunnerRef = useRef<(runId: string, reason?: string) => Promise<void>>(
    async () => {
      throw new Error("Agent cancel runner is not ready");
    }
  );
  const artifactResultClientRef = useRef<ReturnType<typeof createArtifactResultClient> | null>(null);
  if (!artifactResultClientRef.current) {
    artifactResultClientRef.current = createArtifactResultClient({
      getBaseEndpoint() {
        const configured = settingsStoreRef.current.getState()["models.cloud_proxy_endpoint"];
        return configured.startsWith("http://") || configured.startsWith("https://")
          ? configured
          : resolveLocalDevCloudEndpoint();
      }
    });
  }
  const {
    refresh: refreshLocalLibrary,
    snapshot: localLibrarySnapshot
  } = useLocalLibrary(localLibraryLoader);
  const paneLayout = usePaneLayout();
  const dock = useDockLayout();
  const { isOnline } = useConnectivity();
  const [runtimeTheme, setRuntimeTheme] = useState<RuntimeTheme>({ kind: "default" });
  const [workbenchOverlay, setWorkbenchOverlay] = useState<UIDslDocument | null>(null);
  const [activeCenterArtifactId, setActiveCenterArtifactId] = useState<string | null>(null);
  const [activeSideArtifactIds, setActiveSideArtifactIds] = useState<
    Partial<Record<DockRegionId, string>>
  >({});
  const [openReaderPaperIds, setOpenReaderPaperIds] = useState<string[]>([]);
  const [activeReaderPaperId, setActiveReaderPaperId] = useState<string | null>(null);
  const [readerEvidenceTarget, setReaderEvidenceTarget] = useState<PdfEvidenceTarget | null>(null);
  const [registrationWelcomeMessageId, setRegistrationWelcomeMessageId] = useState(0);
  const readerEvidenceRequestRef = useRef(0);
  const [readerConversationContext, setReaderConversationContext] =
    useState<ReaderConversationContext | null>(null);
  const latestArtifactIdRef = useRef<string | null>(null);
  const latestArtifactTaskIdRef = useRef<string | null>(null);

  const workspaceSelection = useWorkspaceSelectionController({
    localLibrarySnapshot,
    workspaceStore: workspaceStoreRef.current
  });
  const workspaceState = workspaceSelection.model.workspaceState;
  const workspaceLabel = workspaceSelection.model.workspaceLabel;
  const setWorkspaceLabel = workspaceSelection.actions.setWorkspaceLabel;
  const setWorkspaceState = workspaceSelection.actions.setWorkspaceState;
  const [settingsState, setSettingsState] = useState<SettingsState>(() =>
    cloneSettingsState(settingsStoreRef.current.getState())
  );
  const [importJobsByDocumentId, setImportJobsByDocumentId] = useState<Record<string, ImportJob>>({});
  const [analysisHint, setAnalysisHint] = useState(
    "先勾选并锁定文献形成选中文献集，再用中栏 AI 按钮启动分析。"
  );
  const modelSettings = useModelSettingsActions({
    localDevCloudEnv,
    onSettingsChanged: (nextSettings) => setSettingsState(cloneSettingsState(nextSettings)),
    settingsStore: settingsStoreRef.current
  });
  const leftRail = useLeftRailNavigation();
  function openDockedLeftRailView(view: LeftRailView) {
    leftRail.setLeftRailView(view);
    const regionId = dock.findItemRegion(view) ?? "left";
    dock.openItem(view);
    if (regionId !== "main") {
      paneLayout.setCollapsed(regionId, false);
    }
  }
  const workspaceActions = useWorkspaceActions({
    importDocument: (sourcePath) => invoke("mock_import", { sourcePath }),
    importStore: importStoreRef.current,
    loadPdfSource: typeof window !== "undefined" &&
      typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function"
      ? readLocalLibraryPdf
      : undefined,
    moveLocalLibraryResource,
    persistDroppedPdfFiles: typeof window !== "undefined" &&
      typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function"
      ? persistDroppedPdfFiles
      : undefined,
    onAnalysisHint: setAnalysisHint,
    onImportJobsChanged: setImportJobsByDocumentId,
    onWorkspaceChanged: setWorkspaceState,
    ocrLanguage: settingsState["import.ocr_language"],
    workspaceStore: workspaceStoreRef.current
  });

  const artifactWorkflow = useArtifactWorkflowController({
    artifactStore,
    artifactResultClient: artifactResultClientRef.current,
    artifactResultScopeKey: settingsState["models.cloud_proxy_endpoint"],
    cancelAgentRun: (runId, reason) => agentCancelRunnerRef.current(runId, reason),
    getAssistantLanguage: () => settingsStoreRef.current.getState()["assistant.language"],
    getActiveReaderPaper: () => {
      const paperId = activeReaderPaperId;
      return paperId
        ? workspaceStoreRef.current.getState().papers.find((paper) => paper.id === paperId) ?? null
        : null;
    },
    getImportedChunksByPaperId: workspaceActions.getImportedChunksByPaperId,
    getImportedChunksForPaperId: (paperId) =>
      importStoreRef.current.getParsedChunksByDocumentId(paperId),
    getIntuechoEndpoint: () => settingsStoreRef.current.getState()["thin_reading.intuecho_endpoint"],
    getModelDiagnosticContext: () => {
      const provider = settingsStoreRef.current.getState()["models.default_provider"];
      return {
        endpoint: settingsStoreRef.current.getState()["models.cloud_proxy_endpoint"],
        model: getDefaultModelForProvider(provider),
        provider
      };
    },
    getPaperById: (paperId) =>
      workspaceStoreRef.current.getState().papers.find((paper) => paper.id === paperId),
    getSelectedDocumentSet: () => workspaceStoreRef.current.getSelectedDocumentSet(),
    getSelectedPapers: workspaceActions.getSelectedPapers,
    onAnalysisHint: setAnalysisHint,
    queueImportForPapers: workspaceActions.queueImportForPapers,
    runAgentAnalysis: (artifactType, onProgress, options) =>
      agentArtifactRunnerRef.current(artifactType, onProgress, options)
  });
  const { artifactCatalog, artifactTabs, artifactTasks } = artifactWorkflow.model;

  function getArtifactRegion(artifactId: string): DockRegionId {
    return dock.findDynamicItemRegion(artifactId) ?? "main";
  }

  function activateArtifactSurface(artifactId: string) {
    const regionId = getArtifactRegion(artifactId);
    if (regionId === "main") {
      setActiveCenterArtifactId(artifactId);
      return;
    }
    setActiveSideArtifactIds((current) => ({
      ...current,
      [regionId]: artifactId
    }));
    paneLayout.setCollapsed(regionId, false);
  }

  function selectFallbackArtifact(
    artifactId: string,
    remainingTabs: typeof artifactTabs
  ) {
    const regionId = getArtifactRegion(artifactId);
    const fallbackId = remainingTabs.find(
      (candidate) => getArtifactRegion(candidate.artifactId) === regionId
    )?.artifactId;
    if (regionId === "main") {
      if (activeCenterArtifactId === artifactId) {
        setActiveCenterArtifactId(fallbackId ?? null);
      }
      return;
    }
    setActiveSideArtifactIds((current) => {
      if (current[regionId] !== artifactId) {
        return current;
      }
      const next = { ...current };
      if (fallbackId) {
        next[regionId] = fallbackId;
      } else {
        delete next[regionId];
      }
      return next;
    });
  }

  function moveArtifactSurface(artifactId: string, targetRegionId: DockRegionId) {
    if (!artifactTabs.some((tab) => tab.artifactId === artifactId)) {
      return;
    }
    const sourceRegionId = getArtifactRegion(artifactId);
    dock.moveDynamicItem(artifactId, targetRegionId);
    if (sourceRegionId === "main" && activeCenterArtifactId === artifactId) {
      setActiveCenterArtifactId(null);
    } else if (sourceRegionId !== "main") {
      setActiveSideArtifactIds((current) => {
        if (current[sourceRegionId] !== artifactId) {
          return current;
        }
        const next = { ...current };
        delete next[sourceRegionId];
        return next;
      });
    }
    if (targetRegionId === "main") {
      setActiveCenterArtifactId(artifactId);
    } else {
      setActiveSideArtifactIds((current) => ({
        ...current,
        [targetRegionId]: artifactId
      }));
      paneLayout.setCollapsed(targetRegionId, false);
    }
  }

  useEffect(() => {
    const latestTask = artifactTasks[0];
    if (!latestTask || latestArtifactTaskIdRef.current === latestTask.id) {
      return;
    }
    latestArtifactTaskIdRef.current = latestTask.id;
    const assistantRegionId = dock.findItemRegion("assistant") ?? "right";
    dock.openItem("assistant");
    if (assistantRegionId !== "main") {
      paneLayout.setCollapsed(assistantRegionId, false);
    }
  }, [artifactTasks]);

  useEffect(() => {
    const latestArtifactId = artifactTabs[0]?.artifactId ?? null;
    if (latestArtifactId && latestArtifactId !== latestArtifactIdRef.current) {
      latestArtifactIdRef.current = latestArtifactId;
      activateArtifactSurface(latestArtifactId);
      return;
    }

    if (
      activeCenterArtifactId &&
      !artifactTabs.some((tab) => tab.artifactId === activeCenterArtifactId)
    ) {
      setActiveCenterArtifactId(
        artifactTabs.find((tab) => getArtifactRegion(tab.artifactId) === "main")?.artifactId ?? null
      );
    }
  }, [activeCenterArtifactId, artifactTabs, dock.dynamicItemRegions]);

  const registeredWorkspaceActions = useRegisteredWorkspaceActions({
    importSelectedSet: workspaceActions.importSelectedSet,
    onAnalysisHint: setAnalysisHint,
    startArtifactAnalysis: artifactWorkflow.actions.startAnalysis
  });

  useEffect(() => {
    modelSettings.applyInjectedLocalDevCloudDefaults();
  }, []);

  usePolicySync({
    applyModelPolicySnapshot: modelSettings.applyModelPolicySnapshot,
    controlPlaneTransport,
    getSettings: () => settingsStoreRef.current.getState()
  });
  const cloudAccount = useCloudAccountController({
    accountTransport,
    getSettings: () => settingsStoreRef.current.getState(),
    applyLocalDevCloudDefaults: modelSettings.applyLocalDevCloudDefaults,
    isOnline,
    onRegistered: () => {
      openDockedLeftRailView("profile");
      setRegistrationWelcomeMessageId((current) => current + 1);
    }
  });
  const {
    accountSession,
    loginDialogOpen
  } = cloudAccount.model;
  const profileActions = useProfileActions({
    accountSession,
    controlPlaneEndpoint: settingsState["models.control_plane_endpoint"],
    onProfileSamplingChanged: (enabled) => {
      settingsStoreRef.current.apply({
        intent: "update_setting",
        target: "profile.enabled",
        value: enabled
      });
      setSettingsState(cloneSettingsState(settingsStoreRef.current.getState()));
    },
    profileSamplingEnabled: settingsState["profile.enabled"],
    transport: academicProfileTransport
  });
  function handleProfileExport() {
    downloadAcademicProfileExport(
      createAcademicProfileExport({ academicProfile: profileActions.academicProfile })
    );
    profileActions.markProfileExported();
  }
  const organizationShell = useOrganizationShellController({
    accountSession,
    controlPlaneEndpoint: settingsState["models.control_plane_endpoint"],
    onAnalysisHint: setAnalysisHint,
    onLeftRailView: openDockedLeftRailView,
    onWorkspaceLabel: setWorkspaceLabel,
    onWorkspaceSync: workspaceActions.syncWorkspace,
    organizationGovernanceTransport,
    organizationListTransport,
    organizationSharedLibraryManifestTransport,
    organizationTransport,
    starterPapers,
    workspaceStoreRef
  });
  function logoutAndClearOrganizationState() {
    cloudAccount.actions.logoutFromCloudAccount();
    organizationShell.actions.resetOrganizationState();
  }
  const selectedPapers = workspaceActions.getSelectedPapers();
  const openReaderPapers = openReaderPaperIds.flatMap((paperId) => {
    const paper = workspaceState.papers.find((candidate) => candidate.id === paperId);
    return paper ? [paper] : [];
  });
  const activeReaderPaper =
    openReaderPapers.find((paper) => paper.id === activeReaderPaperId) ?? null;
  useEffect(() => {
    const availablePaperIds = new Set(workspaceState.papers.map((paper) => paper.id));
    setOpenReaderPaperIds((current) => {
      const next = current.filter((paperId) => availablePaperIds.has(paperId));
      return next.length === current.length ? current : next;
    });
    setActiveReaderPaperId((current) =>
      current && availablePaperIds.has(current) ? current : null
    );
  }, [workspaceState.papers]);
  const importedChunksByPaperId = workspaceActions.getImportedChunksByPaperId();
  const importedSelectedCount = workspaceActions.getImportedSelectedCount();
  const applyRuntimeLayoutPreset: ActionContext["applyLayoutPreset"] = (input) => {
    let message: string;
    if (input.preset === "two_column") {
      paneLayout.setCollapsed("left", true);
      message = "已切换为双栏布局。";
    } else {
      paneLayout.resetLayout();
      message = "已恢复默认布局。";
    }

    setWorkbenchOverlay(
      generateWorkbenchOverlayUIDslDocument({
        action: {
          actionId: input.preset === "two_column" ? "layout.split_two" : "layout.reset",
          input
        },
        message
      })
    );
    return message;
  };
  const applyRuntimeThemePreset: ActionContext["applyThemePreset"] = (input) => {
    let message: string;
    if (input.preset === "playful" || input.tone === "cartoon") {
      setRuntimeTheme({
        kind: "preset",
        preset: "playful"
      });
      message = "已应用卡通风格。";
    } else {
      setRuntimeTheme({
        kind: "default"
      });
      message = "已恢复默认风格。";
    }

    setWorkbenchOverlay(
      generateWorkbenchOverlayUIDslDocument({
        action: {
          actionId:
            input.preset === "playful" || input.tone === "cartoon"
              ? "theme.apply_preset"
              : "theme.reset",
          input
        },
        message
      })
    );
    return message;
  };
  const applyRuntimeGeneratedTheme: ActionContext["applyGeneratedTheme"] = (input) => {
    setRuntimeTheme({
      kind: "generated",
      theme: input
    });
    const scopeLabel = input.scope.join(" / ");
    const message = `已根据命令生成${input.name}主题。`;

    setWorkbenchOverlay(
      generateWorkbenchOverlayUIDslDocument({
        action: {
          actionId: "theme.apply_generated",
          input
        },
        message: input.rationale ? `${message}影响范围：${scopeLabel}。${input.rationale}` : message
      })
    );
    return message;
  };
  const applyRuntimePanelAction: ActionContext["applyPanelAction"] = (input) => {
    const setPaneOpen = (pane: "bottom" | "left" | "right") => {
      if (input.operation === "toggle") {
        paneLayout.setCollapsed(pane, !paneLayout.collapsed[pane]);
        return;
      }

      paneLayout.setCollapsed(pane, input.operation === "close");
    };

    if (input.panel === "left" || input.panel === "right" || input.panel === "bottom") {
      setPaneOpen(input.panel);
      const paneLabel = input.panel === "left" ? "左栏" : input.panel === "right" ? "右栏" : "下栏";
      const actionLabel =
        input.operation === "close" ? "关闭" : input.operation === "toggle" ? "切换" : "打开";
      const message = `已${actionLabel}${paneLabel}。`;
      setWorkbenchOverlay(
        generateWorkbenchOverlayUIDslDocument({
          action: {
            actionId:
              input.operation === "close"
                ? "panel.close"
                : input.operation === "toggle"
                  ? "panel.toggle"
                  : "panel.open",
            input: {
              panel: input.panel
            }
          },
          message
        })
      );
      return message;
    }

    openDockedLeftRailView(input.panel);

    let message = "已打开文献库面板。";
    if (input.panel === "settings") {
      message = "已打开设置面板。";
    } else if (input.panel === "organization") {
      message = "已打开组织面板。";
    } else if (input.panel === "profile") {
      message = "已打开个人中心。";
    }

    setWorkbenchOverlay(
      generateWorkbenchOverlayUIDslDocument({
        action: {
          actionId:
            input.operation === "close"
              ? "panel.close"
              : input.operation === "toggle"
                ? "panel.toggle"
                : "panel.open",
          input: {
            panel: input.panel
          }
        },
        message
      })
    );
    return message;
  };
  const dockMoveItemLabels: Record<DockMoveItemId, string> = {
    assistant: "Liteasy Chat",
    library: "文献库",
    organization: "组织",
    profile: "个人中心",
    settings: "设置"
  };
  const dockMoveRegionLabels: Record<DockMoveTargetRegion, string> = {
    bottom: "下栏",
    left: "左栏",
    right: "右栏"
  };
  const moveRuntimeDockItem: ActionContext["moveDockItem"] = (input) => {
    moveDockItem(input.itemId, input.targetRegion);
    const message = `已将 ${dockMoveItemLabels[input.itemId]} 移到${dockMoveRegionLabels[input.targetRegion]}。`;
    setWorkbenchOverlay(
      generateWorkbenchOverlayUIDslDocument({
        action: {
          actionId: "dock.move_item",
          input
        },
        message
      })
    );
    return message;
  };
  const runtimeActionContext: ActionContext = {
    applyGeneratedTheme: applyRuntimeGeneratedTheme,
    applyLayoutPreset: applyRuntimeLayoutPreset,
    applyPanelAction: applyRuntimePanelAction,
    applyThemePreset: applyRuntimeThemePreset,
    importSelectedSet: registeredWorkspaceActions.handleImportSelectedSet,
    moveDockItem: moveRuntimeDockItem,
    openAcademicArchive: () => {
      profileActions.openAcademicArchive();
      return "已打开学术档案。";
    },
    openArtifactTab: (input) => {
      if (input.artifactId) {
        activateArtifactSurface(input.artifactId);
      }
      const message = input.artifactType
        ? `已定位到中心产物：${input.artifactType}。`
        : "已定位到中心产物。";
      setAnalysisHint(message);
      return message;
    },
    openOrganizationSharedLibrary: organizationShell.actions.openOrganizationSharedLibrary,
    profileUnlocked: accountSession !== null,
    settingsStore: settingsStoreRef.current,
    startArtifactAnalysis: artifactWorkflow.actions.handleAssistantArtifact
  };
  const generatedAgentRecentState = [
    `用户正在“${workspaceLabel}”中工作。`,
    `当前打开 ${openReaderPaperIds.length} 篇 PDF。`,
    `当前选中 ${workspaceState.selectedPaperIds.length} 篇文献${workspaceState.selectionLocked ? "，且已锁定为任务上下文" : ""}。`,
    profileActions.academicProfile.researchTopics
      ? `研究主题偏好：${profileActions.academicProfile.researchTopics}。`
      : ""
  ].filter(Boolean).join(" ");
  const agentRecentState = profileActions.agentRecentStateOverride.trim() || generatedAgentRecentState;
  const assistantAgent = useAssistantAgentController({
    academicProfile: profileActions.academicProfile,
    getAgentMemories: () => profileActions.agentMemories,
    getAllPapers: () => workspaceStoreRef.current.getState().papers,
    getImportedChunksByPaperId: workspaceActions.getImportedChunksByPaperId,
    getImportedChunksForPaperId: (paperId) =>
      importStoreRef.current.getParsedChunksByDocumentId(paperId),
    getSelectedPapers: workspaceActions.getSelectedPapers,
    getUserStateSummary: () => agentRecentState,
    importedChunksByPaperId,
    importedSelectedCount,
    modelTransport,
    onApplyGeneratedTheme: runtimeActionContext.applyGeneratedTheme,
    onApplyLayoutPreset: runtimeActionContext.applyLayoutPreset,
    onApplyPanelAction: runtimeActionContext.applyPanelAction,
    onApplyThemePreset: runtimeActionContext.applyThemePreset,
    onGenerateArtifact: artifactWorkflow.actions.handleAssistantArtifact,
    onImportSelectedSet: runtimeActionContext.importSelectedSet,
    onMoveDockItem: runtimeActionContext.moveDockItem,
    onOpenAcademicArchive: runtimeActionContext.openAcademicArchive,
    onOpenOrganizationSharedLibrary: organizationShell.actions.openOrganizationSharedLibrary,
    onSettingsChanged: (nextSettings) =>
      setSettingsState(cloneSettingsState(nextSettings)),
    profilePersonalizationSummary: profileActions.assistantProfileSummary,
    profileUnlocked: accountSession !== null,
    runtimeOrganizationName: organizationShell.model.organizationSummary?.name,
    runtimeWorkspace: workspaceState.workspaceSource,
    selectedPaperCount: workspaceState.selectedPaperIds.length,
    selectedPapers,
    selectionLocked: workspaceState.selectionLocked,
    settingsStore: settingsStoreRef.current
  });
  agentArtifactRunnerRef.current = async (artifactType, onProgress, options) => {
    return runAgentArtifactAnalysis(
      assistantAgent.agentClient,
      artifactType,
      onProgress,
      options
    );
  };
  agentCancelRunnerRef.current = async (runId, reason) => {
    const result = await assistantAgent.agentClient.cancel(runId, reason);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  };
  async function handleWorkbenchOverlayAction(action: UIDslActionRef) {
    await executeUIDslActionRef(action, runtimeActionContext, {
      traceId: workbenchOverlay?.audit.traceId
    });
  }
  async function handleArtifactCanvasAction(action: UIDslActionRef) {
    await executeUIDslActionRef(action, runtimeActionContext);
  }
  const knowledgeSync = useKnowledgeSyncController({
    accountSession,
    controlPlaneEndpoint: settingsState["models.control_plane_endpoint"],
    documentMetadataTransport,
    documents: workspaceState.papers,
    openAlexApiKey: settingsState["thin_reading.openalex_api_key"],
    recommendationTransport,
    recommendationsEnabled: settingsState["network.recommendation.enabled"],
    recommendationSortMode: settingsState["network.recommendation.sort_mode"],
    personalizationVersion: profileActions.personalizationVersion,
    researchProfile: settingsState["profile.enabled"]
      ? toRecommendationResearchProfile(profileActions.academicProfile)
      : undefined,
    selectedPapers,
    workspaceRevision: workspaceState.workspaceRevision,
    workspaceSourceKey: `${workspaceState.workspaceSource.type}:${workspaceState.workspaceSource.rootPath}`
  });
  const {
    collectionItems,
    collectionMessage,
    collectionStatus,
    documentMetadataSyncMessage,
    documentMetadataSyncResult,
    documentMetadataSyncStatus,
    recommendationItems,
    recommendationMessage,
    recommendationPending,
    recommendationStatus
  } = knowledgeSync.model;
  const {
    actionMessage: organizationActionMessage,
    createOpen: createOrganizationOpen,
    inviteSummary,
    joinOpen: joinOrganizationOpen,
    leaveSummary,
    organizationDialogOpen,
    organizationGovernanceMessage,
    organizationGovernanceStatus,
    organizationGovernanceSummary,
    organizationList,
    organizationListMessage,
    organizationListStatus,
    organizationSummary,
    organizationSummaryMessage,
    organizationSummaryStatus,
    readNotificationIds
  } = organizationShell.model;
  const leftPaneSize = paneLayout.collapsed.left
    ? "0px"
    : `minmax(220px, ${paneLayout.layout.left}fr)`;
  const leftPaneUtilitySize = paneLayout.collapsed.left ? "0px" : "18px";
  const rightPaneSize = paneLayout.collapsed.right
    ? "0px"
    : `minmax(220px, ${paneLayout.layout.right}fr)`;
  const rightPaneUtilitySize = paneLayout.collapsed.right ? "0px" : "18px";
  const bottomPaneVisible =
    !paneLayout.collapsed.bottom && dock.layout.regions.bottom.itemIds.length > 0;
  const readerArtifactRowSize = "0px";
  const bottomPaneSize = bottomPaneVisible
    ? `minmax(180px, ${paneLayout.layout.bottom}fr)`
    : "0px";
  const bottomPaneUtilitySize = bottomPaneVisible ? "12px" : "0px";
  const topPaneSize = bottomPaneVisible
    ? `minmax(0, ${100 - paneLayout.layout.bottom}fr)`
    : "minmax(0, 1fr)";
  const libraryPaperChildren = workspaceState.papers.reduce<
    Record<string, LibraryPaperChildItem[]>
  >((entries, paper) => {
    entries[paper.id] = artifactCatalog
      .filter(
        (tab) =>
          tab.papers?.some((sourcePaper) => sourcePaper.id === paper.id) ||
          tab.analysis?.run.coverage.selectedPaperIds.includes(paper.id)
      )
      .map((tab) => ({
        id: tab.artifactId,
        kind: "artifact" as const,
        label: tab.title,
        meta: tab.createdAt ? new Date(tab.createdAt).toLocaleString() : undefined
      }));
    return entries;
  }, {});

  function openPaperInReader(paperId: string) {
    const paper = workspaceState.papers.find((candidate) => candidate.id === paperId);
    if (!paper) {
      return;
    }

    void profileActions.recordPersonalizationSignal({
      kind: "paper_opened",
      title: paper.title
    });
    setOpenReaderPaperIds((current) =>
      current.includes(paperId) ? current : [...current, paperId]
    );
    setActiveReaderPaperId(paperId);
    setActiveCenterArtifactId(null);
  }

  function closeReaderPaper(paperId: string) {
    setOpenReaderPaperIds((current) => {
      const closingIndex = current.indexOf(paperId);
      const next = current.filter((currentPaperId) => currentPaperId !== paperId);
      setActiveReaderPaperId((activePaperId) => {
        if (activePaperId !== paperId) {
          return activePaperId;
        }
        return next[Math.min(closingIndex, next.length - 1)] ?? null;
      });
      return next;
    });
    setActiveCenterArtifactId(null);
  }

  function openEvidenceInReader(request: Omit<PdfEvidenceTarget, "requestId">) {
    const paper = workspaceState.papers.find((candidate) => candidate.id === request.paperId);
    if (!paper) {
      setAnalysisHint("这条证据对应的论文当前不在文献库中，无法打开 PDF 原文。");
      return;
    }

    readerEvidenceRequestRef.current += 1;
    setReaderEvidenceTarget({
      ...request,
      requestId: readerEvidenceRequestRef.current
    });
    openPaperInReader(request.paperId);
    setAnalysisHint(`正在打开《${paper.title}》第 ${request.page} 页的引用证据。`);
  }

  const leftPaneProps: Omit<LeftPaneProps, "leftRailView"> = {
    activePaperId: activeReaderPaper?.id ?? null,
    academicProfile: profileActions.academicProfile,
    agentMemories: profileActions.agentMemories,
    agentRecentState,
    accountSession,
    collectionItems,
    collectionMessage,
    collectionStatus,
    documentMetadataSyncMessage,
    documentMetadataSyncResult: documentMetadataSyncResult ?? null,
    documentMetadataSyncStatus,
    governanceMessage: organizationGovernanceMessage,
    governanceStatus: organizationGovernanceStatus,
    governanceSummary: organizationGovernanceSummary,
    importJobs: importJobsByDocumentId,
    libraryPaperChildren,
    list: organizationList,
    listMessage: organizationListMessage,
    listStatus: organizationListStatus,
    onAddDroppedPdfFiles: workspaceActions.addDroppedPdfFiles,
    onAddExternalPaper: workspaceActions.addExternalPaperToLibrary,
    onClearProfile: profileActions.openClearProfileConfirm,
    onClearRecommendations: knowledgeSync.actions.clearRecommendationCache,
    onCollectRecommendation: async (recommendation) => {
      await knowledgeSync.actions.collectRecommendation(recommendation);
      await profileActions.recordPersonalizationSignal({
        kind: "recommendation_saved",
        title: recommendation.title
      });
    },
    onDismissRecommendation: async (recommendation) => {
      await knowledgeSync.actions.dismissRecommendation(recommendation);
      await profileActions.recordPersonalizationSignal({
        kind: "recommendation_dismissed",
        recommendationId: recommendation.id
      });
    },
    onCreateOrganization: organizationShell.actions.openCreateDialog,
    onImportSelectedSet: () => {
      void registeredWorkspaceActions.handleImportSelectedSet();
    },
    onInviteMember: organizationShell.actions.openInviteDialog,
    onJoinOrganization: organizationShell.actions.openJoinDialog,
    onLeaveOrganization: organizationShell.actions.openLeaveDialog,
    onLoginRequired: cloudAccount.actions.openLoginDialog,
    onLogout: logoutAndClearOrganizationState,
    onMarkNotificationsRead: organizationShell.actions.markOrganizationNotificationsRead,
    onOpenAcademicArchive: profileActions.openAcademicArchive,
    onOpenOrganizationDialog: organizationShell.actions.openOrganizationDialog,
    onOpenPaper: openPaperInReader,
    onRefreshLocalLibrary: async () => {
      await refreshLocalLibrary();
      setAnalysisHint("本地文献库已从磁盘重新扫描。");
    },
    onMoveLibraryFolder: workspaceActions.moveFolder,
    onMoveLibraryPaper: workspaceActions.movePaper,
    onOpenPaperChild: (item) => {
      if (item.kind === "artifact") {
        artifactWorkflow.actions.openArtifact(item.id);
        activateArtifactSurface(item.id);
      }
    },
    onOpenSharedLibrary: (summary) => {
      void organizationShell.actions.openOrganizationSharedLibrary(summary);
    },
    onOpenSkillDocument: (entry) => {
      artifactWorkflow.actions.openSkillDocument(entry);
      activateArtifactSurface(`skill-doc-${entry.id}`);
    },
    onRetryCollectionSync: knowledgeSync.actions.retryCollectionSync,
    onRenameLibraryFolder: workspaceActions.renameFolder,
    onRenameLibraryPaper: workspaceActions.renamePaper,
    onRetryDocumentMetadataSync: knowledgeSync.actions.retryDocumentMetadataSync,
    onReturnToLocalWorkspace: organizationShell.actions.openLocalLibraryWorkspace,
    onSelectOrganization: organizationShell.actions.selectOrganization,
    onToggleLock: workspaceActions.toggleSelectionLock,
    onToggleProfileSampling: profileActions.toggleProfileSampling,
    onToggleSelection: workspaceActions.toggleSelection,
    onUpdateSetting: (command) => {
      settingsStoreRef.current.apply(command);
      setSettingsState(cloneSettingsState(settingsStoreRef.current.getState()));
    },
    onUpdateAcademicProfile: profileActions.updateAcademicProfile,
    onUpdateAgentMemories: profileActions.updateAgentMemories,
    onUpdateAgentRecentState: profileActions.updateAgentRecentStateOverride,
    organizationActionMessage,
    organizationSummary,
    organizationSummaryMessage,
    organizationSummaryStatus,
    papers: workspaceState.papers,
    profileClearMessage: profileActions.profileClearMessage,
    profileReadPaperCount: workspaceState.papers.length,
    profileSamplingEnabled: settingsState["profile.enabled"],
    recommendationItems,
    recommendationMessage,
    recommendationPending,
    recommendationStatus,
    readNotificationIds,
    selectedPaperIds: workspaceState.selectedPaperIds,
    selectionLocked: workspaceState.selectionLocked,
    settings: settingsState,
    summary: organizationSummary,
    workspaceLabel,
    workspaceSourceType: workspaceState.workspaceSource.type
  };

  function isLeftRailDockItem(itemId: DockItemId): itemId is LeftRailView {
    return (
      itemId === "library" ||
      itemId === "organization" ||
      itemId === "profile" ||
      itemId === "settings"
    );
  }

  function activateDockItem(regionId: DockRegionId, itemId: DockItemId) {
    if (regionId === "main") {
      setActiveCenterArtifactId(null);
    } else {
      setActiveSideArtifactIds((current) => {
        if (!current[regionId]) {
          return current;
        }
        const next = { ...current };
        delete next[regionId];
        return next;
      });
    }
    if (isLeftRailDockItem(itemId)) {
      leftRail.setLeftRailView(itemId);
    }
    dock.activateItem(regionId, itemId);
  }

  function moveDockItem(itemId: DockItemId, targetRegionId: DockRegionId) {
    if (isLeftRailDockItem(itemId)) {
      leftRail.setLeftRailView(itemId);
    }
    dock.moveItem(itemId, targetRegionId);
    if (targetRegionId === "main") {
      setActiveCenterArtifactId(null);
    } else {
      setActiveSideArtifactIds((current) => {
        if (!current[targetRegionId]) {
          return current;
        }
        const next = { ...current };
        delete next[targetRegionId];
        return next;
      });
      paneLayout.setCollapsed(targetRegionId, false);
    }
  }

  function startReaderScopedAnalysis(artifactType: ArtifactType, papers?: typeof selectedPapers) {
    if (papers && papers.length > 0) {
      artifactWorkflow.actions.startAnalysisForPapers(artifactType, papers);
      return;
    }
    void registeredWorkspaceActions.handleDirectAnalysis(artifactType);
  }

  function getActiveReaderAnalysisPapers() {
    if (!activeReaderPaper || !workspaceState.selectedPaperIds.includes(activeReaderPaper.id)) {
      return selectedPapers;
    }
    return [
      activeReaderPaper,
      ...selectedPapers.filter((paper) => paper.id !== activeReaderPaper.id)
    ];
  }

  function renderArtifactSurface(
    tabs = artifactTabs,
    activeArtifactId: string | null = activeCenterArtifactId
  ) {
    return (
      <section aria-label="多模态产物区域" className="dock-artifact-surface">
        <ArtifactTabs
          activeArtifactId={activeArtifactId}
          analysisHint={analysisHint}
          canStartAnalysis={
            workspaceState.selectedPaperIds.length > 0 && workspaceState.selectionLocked
          }
          intuechoEndpoint={settingsState["thin_reading.intuecho_endpoint"]}
          onDynamicAction={(action) => {
            void handleArtifactCanvasAction(action);
          }}
          onOpenEvidence={openEvidenceInReader}
          onDeleteArtifact={async (artifactId) => {
            const message = await artifactWorkflow.actions.deleteArtifact(artifactId);
            const remainingTabs = artifactTabs.filter(
              (candidate) => candidate.artifactId !== artifactId
            );
            selectFallbackArtifact(artifactId, remainingTabs);
            return message;
          }}
          onActivateArtifact={activateArtifactSurface}
          onRegenerateArtifact={(request) => {
            artifactWorkflow.actions.regenerateArtifact(request);
          }}
          onGenerateThinReadingBranch={artifactWorkflow.actions.generateThinReadingBranch}
          onRetryInterruptedThinReadingBranch={artifactWorkflow.actions.retryInterruptedThinReadingBranch}
          onSyncThinReadingAnnotations={artifactWorkflow.actions.syncThinReadingAnnotations}
          onSaveMarkdownTab={(artifactId) => {
            void artifactWorkflow.actions.saveSkillDocument(artifactId);
          }}
          onStartAnalysis={(artifactType) => {
            void registeredWorkspaceActions.handleDirectAnalysis(artifactType);
          }}
          onUpdateMarkdownTab={artifactWorkflow.actions.updateSkillDocument}
          onUpdateThinReadingDocument={artifactWorkflow.actions.updateThinReadingDocument}
          selectedCount={workspaceState.selectedPaperIds.length}
          selectionLocked={workspaceState.selectionLocked}
          tabs={tabs}
          tasks={artifactTasks}
        />
      </section>
    );
  }

  function addReaderContextToConversation(context: ReaderConversationContext) {
    setReaderConversationContext(context);
    const assistantRegionId = dock.findItemRegion("assistant") ?? "right";
    dock.openItem("assistant");
    if (assistantRegionId !== "main") {
      paneLayout.setCollapsed(assistantRegionId, false);
    }
  }

  function renderDockItem(itemId: DockItemId, regionId: DockRegionId) {
    if (isLeftRailDockItem(itemId)) {
      return <LeftPane {...leftPaneProps} leftRailView={itemId} />;
    }

    if (itemId === "assistant") {
      return (
        <AssistantSidebar
          agentClient={assistantAgent.agentClient}
          academicProfile={profileActions.academicProfile}
          artifactTasks={artifactTasks}
          executionJournal={assistantAgent.executionJournal}
          importedChunksByPaperId={importedChunksByPaperId}
          importedSelectedCount={importedSelectedCount}
          modelTransport={modelTransport}
          readerConversationContext={readerConversationContext}
          onApplyLayoutPreset={runtimeActionContext.applyLayoutPreset}
          onApplyGeneratedTheme={runtimeActionContext.applyGeneratedTheme}
          onApplyPanelAction={runtimeActionContext.applyPanelAction}
          onApplyThemePreset={runtimeActionContext.applyThemePreset}
          onCancelArtifactTask={artifactWorkflow.actions.cancelArtifactTask}
          onGenerateArtifact={(artifactType, paperIds) => {
            if (paperIds && paperIds.length > 0) {
              workspaceStoreRef.current.setSelectedDocumentSet(paperIds, true);
              workspaceActions.syncWorkspace();
              return artifactWorkflow.actions.startAnalysis(artifactType);
            }
            return artifactWorkflow.actions.handleAssistantArtifact(artifactType);
          }}
          onImportSelectedSet={runtimeActionContext.importSelectedSet}
          onLockPapersForTask={(paperIds) => {
            workspaceStoreRef.current.setSelectedDocumentSet(paperIds, true);
            workspaceActions.syncWorkspace();
          }}
          onMoveDockItem={runtimeActionContext.moveDockItem}
          onOpenAcademicArchive={runtimeActionContext.openAcademicArchive}
          onOpenArtifact={(artifactId) => {
            artifactWorkflow.actions.openArtifact(artifactId);
            activateArtifactSurface(artifactId);
          }}
          onOpenOrganizationSharedLibrary={
            organizationShell.actions.openOrganizationSharedLibrary
          }
          onSettingsChanged={(nextSettings) =>
            setSettingsState(cloneSettingsState(nextSettings))
          }
          profilePersonalizationSummary={profileActions.assistantProfileSummary}
          profileUnlocked={accountSession !== null}
          registrationWelcomeMessage={
            registrationWelcomeMessageId > 0
              ? {
                  content: "欢迎来到 Liteasy，请完善学术档案。",
                  id: registrationWelcomeMessageId
                }
              : undefined
          }
          regionId={regionId === "main" ? "right" : regionId}
          runtimeOrganizationName={organizationSummary?.name}
          runtimeWorkspace={workspaceState.workspaceSource}
          availablePapers={workspaceState.papers}
          selectedPaperCount={workspaceState.selectedPaperIds.length}
          selectedPapers={selectedPapers}
          selectionLocked={workspaceState.selectionLocked}
          settingsStore={settingsStoreRef.current}
        />
      );
    }

    return renderArtifactSurface();
  }

  function renderReaderPaper(paperId: string) {
    const paper = workspaceState.papers.find((candidate) => candidate.id === paperId);
    if (!paper) {
      return null;
    }
    const paperSelection = [
      paper,
      ...selectedPapers.filter((selectedPaper) => selectedPaper.id !== paper.id)
    ];
    return (
      <ReaderPane
        analysisHint={analysisHint}
        artifactTabs={artifactTabs}
        artifactTasks={artifactTasks}
        layoutCollapsed={paneLayout.collapsed}
        loadPdfSource={readLocalLibraryPdf}
        onArtifactDynamicAction={(action) => {
          void handleArtifactCanvasAction(action);
        }}
        onOpenEvidence={openEvidenceInReader}
        onGenerateThinReadingBranch={artifactWorkflow.actions.generateThinReadingBranch}
        onSyncThinReadingAnnotations={artifactWorkflow.actions.syncThinReadingAnnotations}
        intuechoEndpoint={settingsState["thin_reading.intuecho_endpoint"]}
        pdfBackground={resolvePdfReadingBackground(settingsState)}
        onStartAnalysis={startReaderScopedAnalysis}
        onAddReaderContextToConversation={addReaderContextToConversation}
        onSaveMarkdownTab={(artifactId) => {
          void artifactWorkflow.actions.saveSkillDocument(artifactId);
        }}
        onUpdateMarkdownTab={artifactWorkflow.actions.updateSkillDocument}
        onUpdateThinReadingDocument={artifactWorkflow.actions.updateThinReadingDocument}
        onToggleBottomPane={() =>
          paneLayout.setCollapsed("bottom", !paneLayout.collapsed.bottom)
        }
        onToggleLeftPane={() =>
          paneLayout.setCollapsed("left", !paneLayout.collapsed.left)
        }
        onToggleRightPane={() =>
          paneLayout.setCollapsed("right", !paneLayout.collapsed.right)
        }
        selectedPapers={paperSelection}
        selectedPaperIds={workspaceState.selectedPaperIds}
        selectionLocked={workspaceState.selectionLocked}
        showArtifactRegion={false}
        targetEvidence={readerEvidenceTarget?.paperId === paper.id ? readerEvidenceTarget : null}
      />
    );
  }

  function renderDockRegion(regionId: DockRegionId) {
    const showDetachedLayoutControls =
      regionId === "main" &&
      activeCenterArtifactId !== null;
    const dynamicReaderTabs = regionId === "main"
      ? openReaderPapers.map((paper) => ({
          icon: <DocumentPdfRegular />,
          id: `pdf-${paper.id}`,
          kind: "document" as const,
          onActivate: () => {
            setActiveReaderPaperId(paper.id);
            setActiveCenterArtifactId(null);
          },
          onClose: () => closeReaderPaper(paper.id),
          render: () => renderReaderPaper(paper.id),
          selected: activeCenterArtifactId === null && activeReaderPaperId === paper.id,
          title: paper.title
        }))
      : [];
    const dynamicArtifactTabs = artifactTabs
      .filter((tab) => getArtifactRegion(tab.artifactId) === regionId)
      .map((tab) => {
        const selected =
          regionId === "main"
            ? activeCenterArtifactId === tab.artifactId
            : activeSideArtifactIds[regionId] === tab.artifactId;
        return {
          draggable: true,
          id: tab.artifactId,
          onActivate: () => activateArtifactSurface(tab.artifactId),
          onClose: () => {
            const remainingTabs = artifactTabs.filter(
              (candidate) => candidate.artifactId !== tab.artifactId
            );
            artifactWorkflow.actions.closeArtifactTab(tab.artifactId);
            selectFallbackArtifact(tab.artifactId, remainingTabs);
          },
          render: () => renderArtifactSurface([tab], tab.artifactId),
          selected,
          title: tab.title
        };
      });
    const dynamicTabs = [...dynamicReaderTabs, ...dynamicArtifactTabs];
    return (
      <DockRegion
        dynamicTabs={dynamicTabs}
        layout={dock.layout.regions[regionId]}
        onActivateItem={(itemId) => activateDockItem(regionId, itemId)}
        onCloseItem={dock.closeItem}
        onMoveDynamicTab={moveArtifactSurface}
        onMoveItem={moveDockItem}
        overlay={
          regionId === "main" ? (
            <FloatingModalityButton
              analysisHint={analysisHint}
              canStartAnalysis={
                workspaceState.selectedPaperIds.length > 0 && workspaceState.selectionLocked
              }
              onStartAnalysis={(artifactType) => {
                startReaderScopedAnalysis(artifactType, getActiveReaderAnalysisPapers());
              }}
            />
          ) : undefined
        }
        regionId={regionId}
        regionActions={
          showDetachedLayoutControls ? (
            <DockLayoutControls
              collapsed={paneLayout.collapsed}
              onToggleBottom={() =>
                paneLayout.setCollapsed("bottom", !paneLayout.collapsed.bottom)
              }
              onToggleLeft={() =>
                paneLayout.setCollapsed("left", !paneLayout.collapsed.left)
              }
              onToggleRight={() =>
                paneLayout.setCollapsed("right", !paneLayout.collapsed.right)
              }
            />
          ) : undefined
        }
        renderItem={renderDockItem}
      />
    );
  }

  const appFrameStyle = {
    ...(runtimeTheme.kind === "generated"
      ? (createGeneratedThemeStyle(runtimeTheme.theme) as CSSProperties)
      : {}),
    fontFamily: settingsState["view.font_family"],
    fontSize: `${settingsState["view.font_size"]}px`
  } as CSSProperties;
  const appFrameClassName = `app-frame${
    runtimeTheme.kind === "preset" && runtimeTheme.preset === "playful" ? " theme-playful" : ""
  }${runtimeTheme.kind === "generated" ? " theme-generated" : ""}`;
  const appFrameScope =
    runtimeTheme.kind === "generated" ? runtimeTheme.theme.scope.join(" ") : undefined;

  return (
    <div className={appFrameClassName} data-theme-scope={appFrameScope} style={appFrameStyle}>
      <div
        className="app-shell"
        data-testid="workbench-layout"
        style={
          {
            "--bottom-pane-size": bottomPaneSize,
            "--bottom-pane-utility-size": bottomPaneUtilitySize,
            "--left-pane-size": leftPaneSize,
            "--left-pane-utility-size": leftPaneUtilitySize,
            "--reader-artifact-row-size": readerArtifactRowSize,
            "--right-pane-utility-size": rightPaneUtilitySize,
            "--right-pane-size": rightPaneSize,
            "--top-pane-size": topPaneSize
          } as CSSProperties
        }
      >
        <ActivityBar
          activeView={leftRail.leftRailView}
          accountSessionAvailable={accountSession !== null}
          onSelectView={(view) => {
            openDockedLeftRailView(view);
          }}
          onToggleActiveView={(view) => {
            const regionId = dock.findItemRegion(view) ?? "left";
            const region = dock.layout.regions[regionId];
            if (region.activeItemId !== view) {
              activateDockItem(regionId, view);
              if (regionId !== "main") {
                paneLayout.setCollapsed(regionId, false);
              }
              return;
            }
            if (regionId !== "main") {
              paneLayout.setCollapsed(regionId, !paneLayout.collapsed[regionId]);
            }
          }}
        />
        {!paneLayout.collapsed.left ? renderDockRegion("left") : null}
        <div className="pane-utility-column left">
          {!paneLayout.collapsed.left ? (
            <PaneResizer
              ariaLabel="调整左栏宽度"
              onResize={(deltaPixels) => {
                const shellWidth = window.innerWidth - 64 - 8 - 8;
                paneLayout.adjustLeft((deltaPixels / shellWidth) * 100);
              }}
            />
          ) : null}
        </div>
        <AppDialogs
          academicProfile={profileActions.academicProfile}
          accountMessage={cloudAccount.model.accountMessage}
          accountPending={cloudAccount.model.accountPending}
          accountSession={accountSession}
          academicArchiveOpen={profileActions.academicArchiveOpen}
          clearProfileConfirmOpen={profileActions.clearProfileConfirmOpen}
          createOrganizationOpen={createOrganizationOpen}
          inviteSummary={inviteSummary}
          joinOrganizationOpen={joinOrganizationOpen}
          leaveSummary={leaveSummary}
          list={organizationList}
          listMessage={organizationListMessage}
          onCancelClearProfile={profileActions.closeClearProfileConfirm}
          onClearProfile={profileActions.clearUserProfile}
          onCloseAcademicArchive={profileActions.closeAcademicArchive}
          onCloseCreateOrganization={organizationShell.actions.closeCreateDialog}
          onCloseInviteMember={organizationShell.actions.closeInviteDialog}
          onCloseJoinOrganization={organizationShell.actions.closeJoinOrganizationDialog}
          onCloseLeaveOrganization={organizationShell.actions.closeLeaveDialog}
          onCloseOrganizationDialog={organizationShell.actions.closeOrganizationDialog}
          onCreateOrganization={organizationShell.actions.createDemoOrganizationRequest}
          onInviteMember={organizationShell.actions.sendDemoOrganizationInvite}
          onJoinOrganization={organizationShell.actions.createDemoOrganizationJoinRequest}
          onLeaveOrganization={organizationShell.actions.createDemoOrganizationLeaveRequest}
          onExportProfile={handleProfileExport}
          onSkipLogin={cloudAccount.actions.skipLogin}
          onSubmitAccountLogin={(login) => {
            void cloudAccount.actions.submitAccountLogin(login);
          }}
          onSubmitAccountRegistration={(registration) => {
            void cloudAccount.actions.submitAccountRegistration(registration);
          }}
          onSubmitDemoLogin={() => {
            void cloudAccount.actions.submitDemoLogin();
          }}
          onToggleSuppressLoginReminder={cloudAccount.actions.setSuppressLoginReminder}
          onOpenSharedLibrary={(summary) => {
            void organizationShell.actions.openOrganizationSharedLibrary(summary);
          }}
          onSelectOrganization={organizationShell.actions.selectOrganization}
          organizationDialogOpen={organizationDialogOpen}
          loginDialogOpen={loginDialogOpen}
          summary={organizationSummary}
        />
        {renderDockRegion("main")}
        <div className="pane-utility-column right">
          {!paneLayout.collapsed.right ? (
            <PaneResizer
              ariaLabel="调整右栏宽度"
              onResize={(deltaPixels) => {
                const shellWidth = window.innerWidth - 64 - 8 - 8;
                paneLayout.adjustRight((deltaPixels / shellWidth) * 100);
              }}
            />
          ) : null}
        </div>
        {!paneLayout.collapsed.right ? renderDockRegion("right") : null}
        <div className="pane-utility-row bottom">
          {bottomPaneVisible ? (
            <PaneResizer
              ariaLabel="调整下栏高度"
              axis="vertical"
              onResize={(deltaPixels) => {
                paneLayout.adjustBottom((-deltaPixels / window.innerHeight) * 100);
              }}
            />
          ) : null}
        </div>
        {bottomPaneVisible ? renderDockRegion("bottom") : null}
        {workbenchOverlay ? (
          <section aria-label="工作台状态投影" className="workbench-overlay">
            <DynamicCanvas
              document={workbenchOverlay}
              onAction={(action) => {
                void handleWorkbenchOverlayAction(action);
              }}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
