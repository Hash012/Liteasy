import { artifactResourceScope } from "../features/resource-filesystem/artifactResourceProvider";
import { paperCitationOpenRequest } from "../features/paper-anchors/paperAnchorEntity";
import { useAssistantContextCatalog } from "../controllers/useAssistantContextCatalog";
import { useArtifactSessionNavigationController } from "../controllers/useArtifactSessionNavigationController";
import { usePdfMetadataImportController } from "../controllers/usePdfMetadataImportController";
import { extractPdfRecognitionEvidence } from "../features/import/pdfTextExtractor";
import { createPortal } from "react-dom";
import { createDockSurfaceHost, DockSurfaceSlot } from "../features/dock/DockSurfaceSlot";
import { Button, Tooltip } from "@fluentui/react-components";
import { WhiteboardRegular } from "@fluentui/react-icons";
import { useObjectWorkbenchController } from "../controllers/useObjectWorkbenchController";
import { useApplicationViewController } from "../controllers/useApplicationViewController";
import { useWorkbenchNavigationController } from "../controllers/useWorkbenchNavigationController";
import { useNotesController } from "../controllers/useNotesController";
import { NotesPanel } from "../features/notes/NotesPanel";
import { NotesContext } from "../features/notes/notesPort";
import { refOf, objectLink } from "../features/objects/object.types";
import { makeObjectTransfer, writeObjectTransfer } from "../features/object-transfer/objectTransfer";
import { PAPER_CONTEXT_MIME } from "../features/object-transfer/contextTransfer";
import { isBaseDockRegionId } from "../features/dock/dockRegistry";
import { useHelpController } from "../controllers/useHelpController";
import { HelpPanel } from "../features/help/HelpPanel";
import { HelpContext } from "../features/help/helpContext";
import { builtinHelpProviders } from "../features/help/builtinHelpProvider";
import type { HelpContentProvider } from "../features/help/help.types";
import { ObjectWorkbenchContext } from "../features/objects/objectWorkbenchPort";
import { ObjectWorkbench } from "../features/boards/ObjectWorkbench";
import { usePdfQuickAskController } from "../controllers/usePdfQuickAskController";
import { usePaperServicesController } from "../controllers/usePaperServicesController";
import type { CSSProperties } from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceActions } from "../features/workspace/useWorkspaceActions";
import { useRegisteredWorkspaceActions } from "../features/workspace/useRegisteredWorkspaceActions";
import type { ImportJob, MineruFigure } from "../features/import/import.types";
import { extractPdfResourcesWithMineruFallback } from "../features/import/mineruPdfClient";
import { extractImportedChunksForPaper } from "../features/import/importedPaperExtraction";
import { loadPdfBytesForImport } from "../features/import/pdfSourceClient";
import { PaperResourceTab } from "../features/import/PaperResourceTab";
import type { PaperResourceKind } from "../features/import/paperResource.types";
import { VisualizationTab } from "../features/visualization/VisualizationTab";
import type { VisualizationTabData } from "../features/visualization/visualization.types";
import type { RetrievalChunk } from "../features/retrieval/retrieval.types";
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
import {
  createBearerModelTransport,
  type ModelTransport
} from "../features/models/modelHttpClient";
import { usePolicySync } from "../features/models/usePolicySync";
import { useModelSettingsActions } from "../features/models/useModelSettingsActions";
import {
  resolveLocalDevCloudEndpoint,
  shouldApplyLocalDevCloudDefaults,
  type DevCloudEnvLike
} from "../features/models/localDevCloudEndpoint";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import { FloatingModalityButton } from "../features/artifacts/FloatingModalityButton";
import type {
  ArtifactOutlineNode,
  ArtifactTaskStage,
  ArtifactType,
  ThinReadingVisualizationGenerationRequest
} from "../features/artifacts/artifact.types";
import type { PendingVisualizationRequest } from "../features/visualization/visualizationPendingRequestStore";
import type { VisualizationArtifactV1 } from "../features/visualization/visualizationArtifact.types";
import { createAssistantHistoryPersistence, createScopedAssistantHistoryPersistence } from "../features/assistant/assistantHistoryPersistence";
import { createLocalArtifactResultClient } from "../features/artifacts/localArtifactResultClient";
import { createArtifactResultClient } from "../features/artifacts/artifactResultClient";
import { createArtifactExportClient } from "../features/artifacts/artifactExportClient";
import type { AgentArtifactGenerationOptions } from "../features/artifacts/useArtifactActions";
import type { AgentRun } from "../features/agent-api/agentApi.types";
import type { AccountTransport } from "../features/account/accountSessionClient";
import {
  unavailableMultimodalVisualizationCapability,
  type AccountCapabilitiesTransport,
  type MultimodalVisualizationCapability
} from "../features/account/accountCapabilitiesClient";
import { setMultimodalVisualizationPreference } from "../features/visualization/visualizationControlPlaneClient";
import { loadStoredAccountSession } from "../features/account/accountSessionStorage";
import type { RecommendationTransport } from "../features/recommendations/recommendationClient";
import type { DocumentMetadataTransport } from "../features/metadata/documentMetadataClient";
import { useLeftRailNavigation, type LeftRailView } from "./useLeftRailNavigation";
import type { OrganizationListTransport } from "../features/organization/organizationListClient";
import type { OrganizationSummaryTransport } from "../features/organization/organizationSummaryClient";
import type { OrganizationSharedLibraryManifestTransport } from "../features/organization/organizationSharedLibraryManifestClient";
import { ActivityBar } from "./ActivityBar";
import { LeftPane, type LeftPaneProps } from "./LeftPane";
import { AppDialogs } from "./AppDialogs";
import { ReaderPane } from "./ReaderPane";
import { AssistantSidebar } from "./AssistantSidebar";
import { useAppShellStores } from "./useAppShellStores";
import { useConnectivity } from "../features/network/useConnectivity";
import { PaneResizer } from "./PaneResizer";
import { usePaneLayout } from "./usePaneLayout";
import { useLocalLibrary } from "../features/library/useLocalLibrary";
import type { LibraryPaperChildItem } from "../features/library/LibraryPane";
import type { LocalLibrarySnapshot } from "../features/library/localLibrary.types";
import {
  backupLocalLibrary,
  moveLocalLibraryResource,
  listLegacyLocalLibraryRoots,
  openLocalLibraryInFileManager,
  persistDroppedPdfFiles,
  persistZoteroPdfDirectory,
  readLocalLibraryPdf,
  selectLegacyLocalLibraryRoot,
  setLocalLibraryRoot
} from "../features/library/libraryFileSystemClient";
import { isPaperCacheAvailable } from "../features/library/paperCacheClient";
import { resolveReaderPaper } from "../features/library/cachedReaderPapers";
import { createCloudLibraryStorageClient } from "../features/library/cloudLibraryStorageClient";
import { useWorkspaceSelectionController } from "../controllers/useWorkspaceSelectionController";
import { useCloudAccountController } from "../controllers/useCloudAccountController";
import { useArtifactWorkflowController } from "../controllers/useArtifactWorkflowController";
import { useArtifactExportController } from "../controllers/useArtifactExportController";
import { useKnowledgeSyncController } from "../controllers/useKnowledgeSyncController";
import { useOrganizationShellController } from "../controllers/useOrganizationShellController";
import { useExternalPaperController } from "../controllers/useExternalPaperController";
import { useLibraryResourceTransferController } from "../controllers/useLibraryResourceTransferController";
import { useTeamAnnotationController } from "../controllers/useTeamAnnotationController";
import {
  createPersistPaperLiterature,
  usePdfAnnotationPublicationController
} from "../controllers/usePdfAnnotationPublicationController";
import type {
  ActionContext,
  DockMoveItemId,
  DockMoveTargetRegion
} from "../features/skills/actionRegistry";
import type { ReaderConversationContext } from "../features/assistant/assistantContext.types";
import { executeUIDslActionRef } from "../features/agent-runtime/dynamicActionExecutor";
import { DynamicCanvas } from "../features/generative-ui/DynamicCanvas";
import type { PdfEvidenceTarget } from "../features/pdf/PdfReader";
import type { Paper } from "../features/workspace/workspace.types";
import { cloneWorkspaceState } from "../features/workspace/workspaceStateHelpers";
import { literatureMetadataRepository } from "../features/paper-identity/literatureMetadataRepository";
import { createLiteratureAuthorityClient } from "../features/paper-identity/literatureAuthorityClient";
import { createPdfLiteratureHints } from "../features/paper-identity/literatureRecord";
import type { LiteratureRecord, LiteratureRelation } from "../features/paper-identity/literature.types";
import { literatureVersionOpenTarget } from "../features/forum/literatureVersioning";
import { canManageOrganizationLibrary } from "../features/organization/organizationStoragePolicy";
import { useForumController } from "../features/forum/useForumController";
import type { UIDslActionRef, UIDslDocument } from "../features/generative-ui/generativeUi.types";
import { generateWorkbenchOverlayUIDslDocument } from "../features/generative-ui/uiDslGenerator";
import { DockRegion, dockItemMimeType } from "../features/dock/DockRegion";
import { useDockLayout } from "../features/dock/useDockLayout";
import type { DockItemId, DockRegionId } from "../features/dock/dock.types";
import { DockLayoutControls } from "./DockLayoutControls";
import { DocumentPdfRegular, DocumentTextRegular, ImageMultipleRegular } from "@fluentui/react-icons";
import {
  createGeneratedThemeStyle,
  type GeneratedThemeInput
} from "../features/theme/generatedTheme";
import { useAssistantAgentController } from "../controllers/agent/useAssistantAgentController";
import { runAgentArtifactAnalysis } from "../controllers/agent/runAgentArtifactAnalysis";
import { usePaperTranslationController } from "../controllers/usePaperTranslationController";
import { useExtensionRuntimeController } from "../controllers/useExtensionRuntimeController";
import type { PluginSandboxTransport } from "../features/extensions/pluginBuilder";
import { getActiveModelEndpoint, getActiveModelProvider, getModelForSettings } from "../features/models/modelPolicy";
import type { AcademicProfileTransport } from "../features/profile/academicProfileClient";

type AppShellProps = {
  helpProviders?: readonly HelpContentProvider[];
  accountCapabilitiesTransport?: AccountCapabilitiesTransport;
  accountTransport?: AccountTransport;
  academicProfileTransport?: AcademicProfileTransport;
  controlPlaneTransport?: ControlPlaneTransport;
  documentMetadataTransport?: DocumentMetadataTransport;
  initialOpenReaderPaperIds?: string[];
  initialSettings?: Partial<SettingsState>;
  initialPapers?: Paper[];
  localDevCloudEnv?: DevCloudEnvLike;
  organizationListTransport?: OrganizationListTransport;
  organizationSharedLibraryManifestTransport?: OrganizationSharedLibraryManifestTransport;
  organizationTransport?: OrganizationSummaryTransport;
  localLibraryLoader?: () => Promise<LocalLibrarySnapshot>;
  modelTransport?: ModelTransport;
  pluginSandboxTransport?: PluginSandboxTransport;
  recommendationTransport?: RecommendationTransport;
};

type RuntimeTheme =
  | { kind: "default" }
  | { kind: "preset"; preset: "playful" }
  | { kind: "generated"; theme: GeneratedThemeInput };

type OpenPaperResource = {
  kind: PaperResourceKind;
  paperId: string;
};

type PaperMineruResources = {
  figures: MineruFigure[];
  textChunks: RetrievalChunk[];
};

function paperResourceTabId(resource: OpenPaperResource) {
  return `paper-resource-${resource.kind}-${resource.paperId}`;
}

export function AppShell({
  helpProviders = builtinHelpProviders,
  accountCapabilitiesTransport,
  accountTransport,
  academicProfileTransport,
  controlPlaneTransport,
  documentMetadataTransport,
  initialOpenReaderPaperIds = [],
  initialPapers,
  initialSettings,
  localDevCloudEnv,
  organizationListTransport,
  organizationSharedLibraryManifestTransport,
  organizationTransport,
  localLibraryLoader,
  modelTransport,
  pluginSandboxTransport,
  recommendationTransport
}: AppShellProps = {}) {
  const { artifactStore, importStoreRef, settingsStoreRef, workspaceStoreRef } = useAppShellStores(
    initialSettings,
    initialPapers
  );
  const extensionRuntime = useExtensionRuntimeController(pluginSandboxTransport
    ? {
        invokeHandler: (request) => pluginSandboxTransport.invokeHandler(request)
      }
    : undefined);
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
  const assistantHistoryRef = useRef(createAssistantHistoryPersistence());
  const assistantHistoryScopeRef = useRef<string>();
  const localArtifactResultClientRef = useRef(createLocalArtifactResultClient());
  const artifactResultClientRef = useRef<ReturnType<typeof createArtifactResultClient> | null>(null);
  if (!artifactResultClientRef.current) {
    const cloud = createArtifactResultClient({
      getBaseEndpoint() {
        const configured = settingsStoreRef.current.getState()["models.cloud_proxy_endpoint"];
        return configured.startsWith("http://") || configured.startsWith("https://")
          ? configured
          : resolveLocalDevCloudEndpoint();
      }
    });
    const local = localArtifactResultClientRef.current;
    const client = () => settingsStoreRef.current.getState()["models.connection_mode"] === "direct" || !loadStoredAccountSession()?.sessionId ? local : cloud;
    artifactResultClientRef.current = {
      list: (signal) => client().list(signal), save: (document, signal) => client().save(document, signal),
      delete: (id) => client().delete(id), rename: (id, title) => client().rename(id, title)
    };
  }
  const artifactExportClientRef = useRef<ReturnType<typeof createArtifactExportClient> | null>(null);
  if (!artifactExportClientRef.current) {
    artifactExportClientRef.current = createArtifactExportClient();
  }
  const {
    error: localLibraryError,
    notice: localLibraryNotice,
    refresh: refreshLocalLibrary,
    snapshot: localLibrarySnapshot
  } = useLocalLibrary(localLibraryLoader);
  const paneLayout = usePaneLayout();
  const dock = useDockLayout();
  const assistantSurfaceHost = useMemo(createDockSurfaceHost, []);
  const { isOnline } = useConnectivity();
  const [runtimeTheme, setRuntimeTheme] = useState<RuntimeTheme>({ kind: "default" });
  const [workbenchOverlay, setWorkbenchOverlay] = useState<UIDslDocument | null>(null);
  const [activeCenterArtifactId, setActiveCenterArtifactId] = useState<string | null>(null);
  const [activeSideArtifactIds, setActiveSideArtifactIds] = useState<
    Partial<Record<DockRegionId, string>>
  >({});
  const [openReaderPaperIds, setOpenReaderPaperIds] = useState<string[]>(initialOpenReaderPaperIds);
  const [activeReaderPaperId, setActiveReaderPaperId] = useState<string | null>(
    initialOpenReaderPaperIds[0] ?? null
  );
  const [openPaperResources, setOpenPaperResources] = useState<OpenPaperResource[]>([]);
  const [activePaperResourceId, setActivePaperResourceId] = useState<string | null>(null);
  const [openVisualizations, setOpenVisualizations] = useState<VisualizationTabData[]>([]);
  const [activeVisualizationId, setActiveVisualizationId] = useState<string | null>(null);
  const [readerEvidenceTarget, setReaderEvidenceTarget] = useState<PdfEvidenceTarget | null>(null);
  const [registrationWelcomeMessageId, setRegistrationWelcomeMessageId] = useState(0);
  const readerEvidenceRequestRef = useRef(0);
  const [readerConversationContext, setReaderConversationContext] =
    useState<ReaderConversationContext | null>(null);
  const latestArtifactIdRef = useRef<string | null>(null);
  const latestArtifactTaskIdRef = useRef<string | null>(null);
  const cloudAccessTokenRef = useRef<string | undefined>(undefined);
  const forum = useForumController({ getSessionId: () => cloudAccessTokenRef.current });
  const allowUnauthenticatedLocalDevModel = import.meta.env.DEV &&
    shouldApplyLocalDevCloudDefaults(undefined, localDevCloudEnv);
  const effectiveModelTransport = useMemo(() => modelTransport ?? createBearerModelTransport({
    allowUnauthenticatedLocalDev: allowUnauthenticatedLocalDevModel,
    getAccessToken: () => cloudAccessTokenRef.current
  }), [allowUnauthenticatedLocalDevModel, modelTransport]);
  const resolveIntuechoEndpoint = () =>
    settingsStoreRef.current.getState()["thin_reading.intuecho_endpoint"].trim() ||
    (import.meta.env.VITE_FORUM_API_URL ?? "http://127.0.0.1:4040");

  const workspaceSelection = useWorkspaceSelectionController({
    localLibrarySnapshot,
    workspaceStore: workspaceStoreRef.current
  });
  const workspaceState = workspaceSelection.model.workspaceState;
  const workspaceLabel = workspaceSelection.model.workspaceLabel;
  const workspacePaperIdentityKey = workspaceState.papers.map((paper) => paper.id).join("\u0000");
  const setWorkspaceLabel = workspaceSelection.actions.setWorkspaceLabel;
  const setWorkspaceState = workspaceSelection.actions.setWorkspaceState;
  const [settingsState, setSettingsState] = useState<SettingsState>(() =>
    cloneSettingsState(settingsStoreRef.current.getState())
  );
  useApplicationViewController({
    settings: settingsState,
    onUpdateSetting: (command) => {
      settingsStoreRef.current.apply(command);
      setSettingsState(cloneSettingsState(settingsStoreRef.current.getState()));
    }
  });
  const externalKnowledgeEndpoint =
    settingsState["models.cloud_proxy_endpoint"].startsWith("http://") ||
    settingsState["models.cloud_proxy_endpoint"].startsWith("https://")
      ? settingsState["models.cloud_proxy_endpoint"]
      : resolveLocalDevCloudEndpoint();
  const [importJobsByDocumentId, setImportJobsByDocumentId] = useState<Record<string, ImportJob>>({});
  const [cloudTreeRevision, setCloudTreeRevision] = useState(0);
  const savedMineruResourcesRef = useRef<Record<string, PaperMineruResources>>({});
  const [analysisHint, setAnalysisHint] = useState(
    "先勾选并锁定文献形成选中文献集，再用中栏 AI 按钮启动分析。"
  );
  useEffect(() => {
    if (localLibraryNotice) setAnalysisHint(localLibraryNotice);
  }, [localLibraryNotice]);
  const modelSettings = useModelSettingsActions({
    localDevCloudEnv,
    onSettingsChanged: (nextSettings) => setSettingsState(cloneSettingsState(nextSettings)),
    settingsStore: settingsStoreRef.current
  });
  const loadPaperPdfBytes = useCallback(async (sourcePath: string) => {
    const hasTauriInvoke = typeof window !== "undefined" &&
      typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function";
    const configuredEndpoint = settingsState["models.cloud_proxy_endpoint"];
    const endpoint = configuredEndpoint.startsWith("http")
      ? configuredEndpoint
      : resolveLocalDevCloudEndpoint(undefined, localDevCloudEnv);
    return loadPdfBytesForImport({
      devCloudEndpoint: endpoint,
      readTauriPdf: readLocalLibraryPdf,
      sourcePath,
      tauriAvailable: hasTauriInvoke
    });
  }, [localDevCloudEnv, settingsState]);
  const paperServices = usePaperServicesController({
    settings: settingsState, papers: workspaceState.papers, cloudEndpoint: externalKnowledgeEndpoint,
    getSessionId: () => cloudAccessTokenRef.current ?? null,
    loadPdfSource: loadPaperPdfBytes, onProgress: setAnalysisHint
  });
  const leftRail = useLeftRailNavigation();
  const stageImportedPaperIdentityRef = useRef<((input: {
    firstPageText: string;
    paper: Paper;
  }) => Promise<void>) | null>(null);
  function revealDockRegion(regionId: DockRegionId) {
    if (dock.layout.bottomOrder.includes(regionId)) paneLayout.setCollapsed("bottom", false);
    else if (isBaseDockRegionId(regionId) && regionId !== "main") paneLayout.setCollapsed(regionId, false);
  }

  function openDockedLeftRailView(view: LeftRailView) {
    leftRail.setLeftRailView(view);
    const regionId = dock.findItemRegion(view) ?? "left";
    dock.openItem(view);
    activateDockItem(regionId, view);
    if (regionId !== "main") {
      revealDockRegion(regionId);
    }
  }
  const workspaceActions = useWorkspaceActions({
    extractPaperResources: (paper) => {
      const savedMaterial = savedMineruResourcesRef.current[paper.id];
      if (savedMaterial) {
        return Promise.resolve({
          chunks: savedMaterial.textChunks,
          figures: savedMaterial.figures
        });
      }
      if (settingsState["papers.mineru_mode"] !== "local") return paperServices.extract(paper);
      return extractPdfResourcesWithMineruFallback({
        preferLocal: settingsState["models.connection_mode"] === "direct" || !loadStoredAccountSession()?.sessionId,
        endpoint: settingsState["models.cloud_proxy_endpoint"].startsWith("http")
          ? settingsState["models.cloud_proxy_endpoint"]
          : resolveLocalDevCloudEndpoint(undefined, localDevCloudEnv),
        extractFallback: () => extractImportedChunksForPaper(paper, {
          loadPdfSource: loadPaperPdfBytes,
          ocrLanguage: settingsState["import.ocr_language"]
        }),
        loadPdfSource: loadPaperPdfBytes,
        paper
      });
    },
    importStore: importStoreRef.current,
    loadPdfSource: loadPaperPdfBytes,
    moveLocalLibraryResource,
    persistDroppedPdfFiles: typeof window !== "undefined" &&
      typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__?.invoke === "function"
      ? persistDroppedPdfFiles
      : undefined,
    onAnalysisHint: setAnalysisHint,
    onImportJobsChanged: setImportJobsByDocumentId,
    onPaperIdentityReady: (input) => stageImportedPaperIdentityRef.current?.(input),
    onWorkspaceChanged: setWorkspaceState,
    ocrLanguage: settingsState["import.ocr_language"],
    workspaceStore: workspaceStoreRef.current
  });
  const mineruFiguresByPaperId = Object.fromEntries(
    Object.entries(importJobsByDocumentId).map(([paperId, job]) => [paperId, job.mineruFigures ?? []])
  ) as Record<string, MineruFigure[]>;
  const externalPapers = useExternalPaperController({
    addExternalPdfToLibrary: workspaceActions.addExternalPdfToLibrary,
    endpoint: externalKnowledgeEndpoint,
    refreshLocalLibrary,
    setActiveCenterArtifactId,
    setActiveReaderPaperId,
    setOpenReaderPaperIds,
    transport: effectiveModelTransport
  });
  const { cachedReaderPapers } = externalPapers;
  const artifactAccountId = loadStoredAccountSession()?.userId;
  const multimodalVisualizationCapabilityRef = useRef<MultimodalVisualizationCapability>(
    unavailableMultimodalVisualizationCapability
  );
  const updateMultimodalVisualizationCapabilityRef = useRef<(value: unknown) => void>(() => undefined);
  const cancelVisualizationGenerationRef = useRef<(input: {
    artifactId: string;
    nodeId: string;
    reason: "preference_disabled" | "user_cancelled" | "workflow_disposed";
    requestId: string;
  }) => Promise<void>>(async () => undefined);
  const generateVisualizationRef = useRef<(
    request: ThinReadingVisualizationGenerationRequest
  ) => Promise<readonly VisualizationArtifactV1[]>>(async () => {
    throw new Error("visualization_account_session_required");
  });
  const pendingVisualizationRequestsRef = useRef<() => readonly PendingVisualizationRequest[]>(() => []);
  const resumeVisualizationGenerationRef = useRef<(
    request: PendingVisualizationRequest,
    signal: AbortSignal
  ) => Promise<readonly VisualizationArtifactV1[]>>(async () => {
    throw new Error("visualization_account_session_required");
  });

  const artifactWorkflow = useArtifactWorkflowController({
    artifactStore,
    artifactResultClient: artifactResultClientRef.current,
    loadLocalArtifactResults: () => localArtifactResultClientRef.current.list(),
    artifactResultScopeKey: artifactAccountId && settingsState["models.connection_mode"] !== "direct"
      ? `${settingsState["models.cloud_proxy_endpoint"]}:${artifactAccountId}`
      : undefined,
    cancelAgentRun: (runId, reason) => agentCancelRunnerRef.current(runId, reason),
    cancelThinReadingVisualization: (input) => cancelVisualizationGenerationRef.current(input),
    generateThinReadingVisualization: (request) => generateVisualizationRef.current(request),
    getGenerationSettings: () => settingsStoreRef.current.getState(),
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
    getMineruFiguresForPaperId: (paperId) => mineruFiguresByPaperId[paperId] ?? [],
    getMultimodalVisualizationCapability: () => multimodalVisualizationCapabilityRef.current,
    getIntuechoEndpoint: resolveIntuechoEndpoint,
    getIntuechoSessionId: () => cloudAccessTokenRef.current,
    getModelDiagnosticContext: () => {
      const settings = settingsStoreRef.current.getState();
      const provider = getActiveModelProvider(settings);
      return {
        endpoint: getActiveModelEndpoint(settings),
        model: getModelForSettings(settings),
        provider
      };
    },
    getPaperById: (paperId) =>
      workspaceStoreRef.current.getState().papers.find((paper) => paper.id === paperId),
    getSelectedDocumentSet: () => workspaceStoreRef.current.getSelectedDocumentSet(),
    getSelectedPapers: workspaceActions.getSelectedPapers,
    isAgentModelAccessAvailable: () => Boolean(settingsStoreRef.current.getState()["models.connection_mode"] === "direct" || modelTransport || cloudAccessTokenRef.current),
    onAnalysisHint: setAnalysisHint,
    pendingThinReadingVisualizations: () => pendingVisualizationRequestsRef.current(),
    queueImportForPapers: workspaceActions.queueImportForPapers,
    runAgentAnalysis: (artifactType, onProgress, options) =>
      agentArtifactRunnerRef.current(artifactType, onProgress, options),
    resumeThinReadingVisualization: (request, signal) => (
      resumeVisualizationGenerationRef.current(request, signal)
    ),
    setMultimodalVisualizationPreference: (enabled) => {
      const sessionId = cloudAccessTokenRef.current;
      if (!sessionId) {
        return Promise.reject(new Error("multimodal_visualization_preference_unavailable"));
      }
      return setMultimodalVisualizationPreference({
        enabled,
        endpoint: settingsState["models.control_plane_endpoint"],
        sessionId
      }).then((capability) => {
        updateMultimodalVisualizationCapabilityRef.current(capability);
        return capability;
      });
    }
  });
  const artifactExports = useArtifactExportController({
    client: artifactExportClientRef.current
  });
  const {
    artifactCatalog,
    artifactCatalogLoadState,
    artifactTabs,
    artifactTasks,
    thinReadingVisualizationReadyArtifacts,
    thinReadingVisualizationStatuses
  } = artifactWorkflow.model;
  const activeThinReadingTask = artifactTasks.find((task) => (
    task.type === "thin_reading" &&
    (task.status === "queued" || task.status === "running")
  ));
  const savedMineruResourcesByPaperId = workspaceState.papers.reduce<Record<string, PaperMineruResources>>(
    (resources, paper) => {
      const artifact = artifactCatalog.find((candidate) => {
        const hasMineruMaterial = (candidate.figures?.length ?? 0) > 0 ||
          (candidate.mineruTextChunks?.length ?? 0) > 0;
        return hasMineruMaterial && candidate.papers?.some((sourcePaper) => (
          sourcePaper.id === paper.id
        ));
      });
      if (artifact && !resources[paper.id]) {
        resources[paper.id] = {
          figures: artifact.figures ?? [],
          textChunks: artifact.mineruTextChunks ?? []
        };
      }
      return resources;
    },
    { ...paperServices.resources }
  );
  savedMineruResourcesRef.current = savedMineruResourcesByPaperId;

  function getPaperMineruResources(paperId: string): PaperMineruResources | null {
    const imported = importJobsByDocumentId[paperId];
    const saved = savedMineruResourcesByPaperId[paperId];
    if (imported?.status !== "parsed" && !saved) return null;
    // The offline PDF.js import may finish before a saved MinerU artifact is
    // rehydrated. Do not let that empty figure array hide high-resolution assets.
    const figureById = new Map<string, MineruFigure>();
    [...(saved?.figures ?? []), ...(imported?.mineruFigures ?? [])].forEach((figure) => {
      figureById.set(figure.id, figure);
    });
    const importedChunks = imported?.parsedChunks ?? [];
    const savedChunks = saved?.textChunks ?? [];
    // Prefer the persisted MinerU text over an earlier PDF.js fallback import;
    // mixing both creates duplicate paragraphs in the ordered reading view.
    const textChunks = importedChunks.some((chunk) => chunk.textExtraction === "mineru") || savedChunks.length === 0
      ? importedChunks
      : savedChunks;
    return {
      figures: [...figureById.values()],
      textChunks
    };
  }

  const savedMineruResourceSignature = Object.keys(paperServices.resources).sort().join("|") + artifactCatalog
    .map((artifact) => `${artifact.artifactId}:${artifact.figures?.length ?? 0}:${artifact.mineruTextChunks?.length ?? 0}`)
    .sort()
    .join("|");

  useEffect(() => {
    const restored: Record<string, ImportJob> = {};
    for (const paper of workspaceState.papers) {
      const material = savedMineruResourcesByPaperId[paper.id];
      const latestJob = importStoreRef.current.getLatestJobByDocumentId(paper.id);
      if (!material || latestJob?.parsedChunks?.some((chunk) => chunk.textExtraction === "mineru") || !paper.sourcePath) {
        continue;
      }
      // A persisted artifact is an authoritative MinerU result. Rehydrate it into
      // the import store so re-opening or regenerating a thin reading never submits
      // the same PDF to MinerU again.
      const jobId = importStoreRef.current.startImport({
        documentId: paper.id,
        sourcePath: paper.sourcePath
      });
      importStoreRef.current.markParsed(jobId, {
        chunks: material.textChunks,
        mineruFigures: material.figures,
        paperId: paper.id
      });
      const job = importStoreRef.current.getJob(jobId);
      if (job) {
        restored[paper.id] = job;
      }
    }
    if (Object.keys(restored).length > 0) {
      setImportJobsByDocumentId((current) => ({ ...current, ...restored }));
    }
  }, [artifactCatalog, savedMineruResourceSignature, workspacePaperIdentityKey]);

  function getArtifactRegion(artifactId: string): DockRegionId {
    return dock.findDynamicItemRegion(artifactId) ?? "main";
  }

  function activateArtifactSurface(artifactId: string) {
    const regionId = getArtifactRegion(artifactId);
    if (regionId === "main") {
      setActiveCenterArtifactId(artifactId);
      setActivePaperResourceId(null);
      setActiveReaderPaperId(null);
      setActiveVisualizationId(null);
      return;
    }
    setActiveSideArtifactIds((current) => ({
      ...current,
      [regionId]: artifactId
    }));
    revealDockRegion(regionId);
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

  async function deleteArtifact(artifactId: string) {
    const outcome = await artifactWorkflow.actions.deleteArtifact(artifactId);
    if (outcome.status === "error") {
      return outcome;
    }
    const remainingTabs = artifactTabs.filter(
      (candidate) => candidate.artifactId !== artifactId
    );
    selectFallbackArtifact(artifactId, remainingTabs);
    return outcome;
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
      revealDockRegion(targetRegionId);
    }
  }

  useEffect(() => {
    const latestTask = artifactTasks[0];
    if (!latestTask || latestArtifactTaskIdRef.current === latestTask.id) {
      return;
    }
    latestArtifactTaskIdRef.current = latestTask.id;
    if (latestTask.type === "thin_reading") return;
    const assistantRegionId = dock.findItemRegion("assistant") ?? "right";
    dock.openItem("assistant");
    if (assistantRegionId !== "main") {
      revealDockRegion(assistantRegionId);
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

  const cloudAccount = useCloudAccountController({
    accountCapabilitiesTransport,
    accountTransport,
    getSettings: () => settingsStoreRef.current.getState(),
    applyLocalDevCloudDefaults: modelSettings.applyLocalDevCloudDefaults,
    isOnline,
    suppressAutomaticLoginPrompt: allowUnauthenticatedLocalDevModel || settingsState["models.connection_mode"] === "direct",
    onRegistered: () => {
      openDockedLeftRailView("profile");
      setRegistrationWelcomeMessageId((current) => current + 1);
    }
  });
  const {
    accountSession,
    loginDialogOpen
  } = cloudAccount.model;
  multimodalVisualizationCapabilityRef.current = cloudAccount.model.multimodalVisualization;
  updateMultimodalVisualizationCapabilityRef.current =
    cloudAccount.actions.setMultimodalVisualizationCapability;
  cancelVisualizationGenerationRef.current = cloudAccount.actions.cancelVisualizationGeneration;
  generateVisualizationRef.current = cloudAccount.actions.generateVisualization;
  pendingVisualizationRequestsRef.current = cloudAccount.actions.pendingVisualizationRequests;
  resumeVisualizationGenerationRef.current = cloudAccount.actions.resumeVisualizationGeneration;
  const assistantScopeId = accountSession?.userId ? `user:${accountSession.userId}` : "local";
  if (assistantHistoryScopeRef.current !== assistantScopeId) {
    assistantHistoryScopeRef.current = assistantScopeId;
    assistantHistoryRef.current = createScopedAssistantHistoryPersistence(
      assistantScopeId, () => assistantHistoryScopeRef.current ?? "local"
    );
  }
  cloudAccessTokenRef.current = accountSession?.sessionId;
  usePolicySync({
    applyModelPolicySnapshot: modelSettings.applyModelPolicySnapshot,
    controlPlaneTransport,
    getSettings: () => settingsStoreRef.current.getState(),
    sessionId: accountSession?.sessionId
  });
  const paperTranslation = usePaperTranslationController({
    modelTransport: effectiveModelTransport,
    settingsStore: settingsStoreRef.current
  });
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
    organizationListTransport,
    organizationSharedLibraryManifestTransport,
    organizationTransport,
    workspaceStoreRef
  });
  function logoutAndClearOrganizationState() {
    artifactWorkflow.actions.disposeThinReadingVisualizations();
    cloudAccount.actions.logoutFromCloudAccount();
    organizationShell.actions.resetOrganizationState();
  }
  const selectedPapers = workspaceActions.getSelectedPapers();
  const openReaderPapers = openReaderPaperIds.flatMap((paperId) => {
    const paper = resolveReaderPaper({
      cachedPapers: cachedReaderPapers,
      libraryPapers: workspaceState.papers,
      paperId
    });
    return paper ? [paper] : [];
  });
  const activeReaderPaper =
    openReaderPapers.find((paper) => paper.id === activeReaderPaperId) ?? null;
  useEffect(() => {
    const availablePaperIds = new Set([
      ...workspaceState.papers.map((paper) => paper.id),
      ...cachedReaderPapers.map((paper) => paper.id)
    ]);
    setOpenReaderPaperIds((current) => {
      const next = current.filter((paperId) => availablePaperIds.has(paperId));
      return next.length === current.length ? current : next;
    });
    setActiveReaderPaperId((current) =>
      current && availablePaperIds.has(current) ? current : null
    );
  }, [cachedReaderPapers, workspaceState.papers]);
  const importedChunksByPaperId = Object.fromEntries(
    workspaceState.papers.map((paper) => [
      paper.id,
      importStoreRef.current.getParsedChunksByDocumentId(paper.id)
    ])
  );
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
  const objectAgentApiRef = useRef<import("../features/agent-api/agentApi.types").AgentPublicApi>();
  const objectWorkbench = useObjectWorkbenchController({
    artifactScopeId: artifactResourceScope(artifactAccountId && settingsState["models.connection_mode"] !== "direct"
      ? `${settingsState["models.cloud_proxy_endpoint"]}:${artifactAccountId}` : undefined).id,
    scopeId: accountSession?.userId ? `user:${accountSession.userId}` : "local",
    getApi: () => objectAgentApiRef.current!,
    readPaperBytes: loadPaperPdfBytes,
    listLegacyArtifacts: () => artifactResultClientRef.current!.list(),
    openLegacyArtifact: (id) => artifactWorkflow.actions.openArtifact(id),
    getPapers: () => workspaceStoreRef.current.getState().papers,
    getSettings: () => settingsStoreRef.current.getState(),
    openEvidence: openEvidenceInReader
  });
  const workbenchNavigation = useWorkbenchNavigationController({
    dock,
    collapsed: paneLayout.collapsed,
    setCollapsed: paneLayout.setCollapsed,
    boardVisible: objectWorkbench.visible,
    closeBoard: () => objectWorkbench.setVisible(false),
    activate: activateDockItem,
    activeDynamicItems: {
      ...activeSideArtifactIds,
      main: activeCenterArtifactId ?? activeReaderPaperId ?? activeVisualizationId ?? activePaperResourceId
    }
  });
  const help = useHelpController({
    providers: helpProviders,
    visible: workbenchNavigation.isVisible("help"),
    onOpen: () => workbenchNavigation.open("help")
  });
  const notes = useNotesController({
    scopeId: objectWorkbench.repository.scopeId,
    repository: objectWorkbench.repository,
    visible: workbenchNavigation.isVisible("notes"),
    getPapers: () => workspaceState.papers,
    onOpen: () => workbenchNavigation.open("notes"),
    openObject: (ref) => objectWorkbench.openLink(objectLink(ref)),
    openAnnotation: (paper, annotation) => openEvidenceInReader({ evidenceId: annotation.id, paperId: paper.id, page: annotation.page, quote: annotation.excerpt }),
    dragAnnotation: (paper, annotation, data) => objectWorkbench.port.dragAnnotation?.({ paper, annotation }, data),
    receiveContextDrop: (data) => objectWorkbench.port.receiveContextDrop!(data),
    openExternalFile: (file) => objectWorkbench.port.openBoardFile!(file),
    exportBoardFile: (ref) => objectWorkbench.port.serializeBoardFile!(ref),
    dragExternalFile: (file, data) => objectWorkbench.port.dragBoardFile?.(file, data),
    listArtifacts: () => artifactResultClientRef.current!.list(),
    openArtifact: (id) => { artifactWorkflow.actions.openArtifact(id); activateArtifactSurface(id); }
  });
  const assistantContextSuggestions = useAssistantContextCatalog({
    artifacts: artifactCatalog,
    objects: objectWorkbench.objects,
    port: objectWorkbench.port,
    repository: objectWorkbench.repository
  });
  const artifactSessionNavigation = useArtifactSessionNavigationController({
    tasks: artifactTasks, scopeId: assistantScopeId,
    openAssistant: () => workbenchNavigation.open("assistant")
  });
  const previousBoardVisibility = useRef<boolean>();
  useEffect(() => {
    const existing = dock.findItemRegion("board");
    if (previousBoardVisibility.current === undefined && existing && !objectWorkbench.visible) {
      objectWorkbench.setVisible(true);
      previousBoardVisibility.current = false;
      return;
    }
    if (objectWorkbench.visible && !existing) {
      const region = dock.layout.regions["bar-board"] ? "bar-board" : dock.splitRegion("main", "right", "bar-board");
      dock.moveItem("board", region);
      activateDockItem(region, "board");
    } else if (!objectWorkbench.visible && previousBoardVisibility.current) {
      dock.closeItem("board");
    }
    previousBoardVisibility.current = objectWorkbench.visible;
  }, [objectWorkbench.visible, dock.layout]);

  useEffect(() => {
    if (objectWorkbench.visible && dock.findItemRegion("board")) workbenchNavigation.open("board");
  }, [objectWorkbench.board?.objectId, objectWorkbench.placements.length]);

  const assistantAgent = useAssistantAgentController({
    principalId: objectWorkbench.repository.scopeId,
    resolveObjectContext: objectWorkbench.resolveContext,
    academicProfile: profileActions.academicProfile,
    getAgentMemories: () => profileActions.agentMemories,
    getAllPapers: () => workspaceStoreRef.current.getState().papers,
    getArtifactTasks: () => artifactTasks,
    getImportedChunksByPaperId: workspaceActions.getImportedChunksByPaperId,
    getImportedChunksForPaperId: (paperId) =>
      importStoreRef.current.getParsedChunksByDocumentId(paperId),
    getSelectedPapers: workspaceActions.getSelectedPapers,
    getUserStateSummary: () => agentRecentState,
    extensionRuntime: extensionRuntime.runtime,
    importedChunksByPaperId,
    importedSelectedCount,
    modelTransport: effectiveModelTransport,
    pluginSandboxTransport,
    thinReadingExternalKnowledgeTransport: effectiveModelTransport,
    thinReadingExternalPdfTransport: effectiveModelTransport,
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
  objectAgentApiRef.current = assistantAgent.publicApi;
  const askPdfQuestion = usePdfQuickAskController({
    capture: objectWorkbench.captureQuickAsk,
    ask: objectWorkbench.ask
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
    recommendationTransport,
    recommendationsEnabled: settingsState["network.recommendation.enabled"],
    recommendationSortMode: settingsState["network.recommendation.sort_mode"],
    personalizationEnabled: settingsState["profile.enabled"],
    personalizationVersion: profileActions.personalizationVersion,
    researchProfile: settingsState["profile.enabled"]
      ? toRecommendationResearchProfile(profileActions.academicProfile)
      : undefined,
    selectedPapers,
    workspaceRevision: workspaceState.workspaceRevision,
    workspaceSourceKey: `${workspaceState.workspaceSource.type}:${workspaceState.workspaceSource.rootPath}`
  });
  const {
    documentMetadataSyncMessage,
    documentMetadataSyncResult,
    documentMetadataSyncStatus,
    recommendationItems,
    recommendationMessage,
    recommendationPending,
    recommendationStatus
  } = knowledgeSync.model;
  const transferLibraryResource = useLibraryResourceTransferController({
    endpoint: externalKnowledgeEndpoint,
    onRecommendationSaved: async (recommendation) => {
      const results = await Promise.allSettled([
        knowledgeSync.actions.recordRecommendationSaved(recommendation),
        profileActions.recordPersonalizationSignal({
          kind: "recommendation_saved",
          title: recommendation.title
        })
      ]);
      if (results.some((result) => result.status === "rejected")) {
        setAnalysisHint("文献已保存到收藏；偏好反馈暂未同步，可稍后继续使用。");
      }
    },
    refreshCloudTrees: () => setCloudTreeRevision((current) => current + 1),
    refreshLocalLibrary,
    transport: modelTransport
  });
  const {
    actionMessage: organizationActionMessage,
    actionPending: organizationActionPending,
    createOpen: createOrganizationOpen,
    inviteSummary,
    joinOpen: joinOrganizationOpen,
    leaveSummary,
    organizationDialogOpen,
    organizationList,
    organizationListMessage,
    organizationListStatus,
    organizationSummary,
    organizationSummaryMessage,
    organizationSummaryStatus,
    readNotificationIds
  } = organizationShell.model;
  const teamAnnotations = useTeamAnnotationController({
    accountSession,
    endpoint: externalKnowledgeEndpoint,
    organizationSummary
  });
  const pdfPublicationCloudClient = useMemo(
    () => createCloudLibraryStorageClient({ endpoint: externalKnowledgeEndpoint }),
    [externalKnowledgeEndpoint]
  );
  const persistPdfPaperLiterature = useMemo(() => createPersistPaperLiterature({
    canManageLibraryReference: (reference) => reference.scopeType === "organization" &&
      organizationSummary?.organizationId === reference.scopeId &&
      canManageOrganizationLibrary(organizationSummary.myRole),
    cloudLibraryClient: pdfPublicationCloudClient,
    literatureMetadataRepository
  }), [organizationSummary?.myRole, organizationSummary?.organizationId, pdfPublicationCloudClient]);
  const literatureAuthorityClient = paperServices.literatureClient;
  const pdfAnnotationPublication = usePdfAnnotationPublicationController({
    forumClient: forum.client,
    literatureClient: literatureAuthorityClient,
    literatureMetadataRepository,
    onPaperUpdated: (paper) => {
      const current = cloneWorkspaceState(workspaceStoreRef.current.getState());
      setWorkspaceState({
        ...current,
        papers: current.papers.map((item) => item.id === paper.id ? paper : item)
      });
    },
    persistPaperLiterature: persistPdfPaperLiterature,
    workspaceStore: workspaceStoreRef.current
  });
  const retrievePdfMetadata = usePdfMetadataImportController({
    workspaceStore: workspaceStoreRef.current,
    importStore: importStoreRef.current,
    literatureClient: literatureAuthorityClient,
    readEvidence: async (paper) => extractPdfRecognitionEvidence(await loadPaperPdfBytes(paper.sourcePath!)),
    persistLiterature: persistPdfPaperLiterature,
    moveResource: moveLocalLibraryResource,
    onChanged: workspaceActions.syncWorkspace,
    onHint: setAnalysisHint,
    stageIdentity: (paper, request) => pdfAnnotationPublication.actions.stagePaperIdentity(paper, request.hints)
  });
  stageImportedPaperIdentityRef.current = async (input) => { await retrievePdfMetadata(input); };
  useEffect(() => {
    void pdfAnnotationPublication.actions.hydrateResolutionStates(workspaceStoreRef.current.getState().papers);
  }, [workspacePaperIdentityKey]);
  const leftPaneSize = paneLayout.collapsed.left
    ? "0px"
    : `minmax(220px, ${paneLayout.layout.left}fr)`;
  const leftPaneUtilitySize = paneLayout.collapsed.left ? "0px" : "4px";
  const rightPaneSize = paneLayout.collapsed.right ? "0px" : `minmax(0, ${paneLayout.layout.right}fr)`;
  const rightPaneUtilitySize = paneLayout.collapsed.right ? "0px" : "4px";
  const bottomPaneVisible = !paneLayout.collapsed.bottom;
  const visibleHorizontalRegions = dock.layout.horizontalOrder.filter((region) => !isBaseDockRegionId(region) || region === "main" || !paneLayout.collapsed[region]);
  function regionWeight(region: DockRegionId) {
    return dock.layout.regionWidths[region] ?? (region === "main" ? paneLayout.layout.center : region === "left" ? paneLayout.layout.left : region === "right" ? paneLayout.layout.right : 32);
  }
  const readerArtifactRowSize = "0px";
  const bottomPaneSize = bottomPaneVisible
    ? `minmax(180px, ${paneLayout.layout.bottom}fr)`
    : "0px";
  const bottomPaneUtilitySize = bottomPaneVisible ? "4px" : "0px";
  const topPaneSize = bottomPaneVisible
    ? `minmax(0, ${100 - paneLayout.layout.bottom}fr)`
    : "minmax(0, 1fr)";
  const libraryPaperChildren = workspaceState.papers.reduce<
    Record<string, LibraryPaperChildItem[]>
  >((entries, paper) => {
    const resources = getPaperMineruResources(paper.id);
    const extractedResources: LibraryPaperChildItem[] = resources
      ? [
          ...(resources.textChunks.length > 0 ? [{
            id: `text-${paper.id}`,
            kind: "extracted_text" as const,
            label: "论文提取文本",
            meta: `MinerU · ${resources.textChunks.length} 个文本片段`
          }] : []),
          ...(resources.figures.length > 0 ? [{
            id: `figures-${paper.id}`,
            kind: "figures" as const,
            label: "论文插图",
            meta: `MinerU · ${resources.figures.length} 张高清图表`
          }] : []),
          ...(resources.textChunks.length > 0 || resources.figures.length > 0 ? [{
            id: `multimodal-${paper.id}`,
            kind: "multimodal" as const,
            label: "论文提取图文版",
            meta: `MinerU · 按原文顺序组合文本与 ${resources.figures.length} 张图表`
          }] : [])
        ]
      : [];
    const savedArtifacts = artifactCatalog
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
    entries[paper.id] = [...extractedResources, ...savedArtifacts];
    return entries;
  }, {});

  function openPaperInReader(paperId: string) {
    const paper = resolveReaderPaper({
      cachedPapers: cachedReaderPapers,
      libraryPapers: workspaceState.papers,
      paperId
    });
    if (!paper) {
      return;
    }

    const organizationSource = paper.sourcePath?.match(/^org:\/\/([^/]+)\//);
    if (organizationSource) {
      void externalPapers.openCloudDocumentInReader({
        documentId: paper.id,
        scopeId: organizationSource[1],
        scopeType: "organization",
        title: paper.title
      }).then(() => {
        void profileActions.recordPersonalizationSignal({
          kind: "paper_opened",
          title: paper.title
        });
      }).catch((error) => {
        setAnalysisHint(error instanceof Error ? error.message : "组织文献打开失败。");
      });
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
    setActivePaperResourceId(null);
    setActiveCenterArtifactId(null);
    setActiveVisualizationId(null);
  }

  function openLiteratureVersion(literature: LiteratureRecord, relation: LiteratureRelation) {
    const target = literatureVersionOpenTarget(literature, workspaceState.papers, relation.evidence);
    if (target.kind === "local") {
      openPaperInReader(target.paperId);
      return;
    }
    if (target.kind === "unavailable") {
      throw new Error("该关联版本尚无可打开的本地文件或来源链接。");
    }
    const sourceWindow = window.open("about:blank", "_blank");
    if (!sourceWindow) throw new Error("浏览器阻止了来源页面，请允许打开新窗口后重试。");
    sourceWindow.opener = null;
    sourceWindow.location.replace(target.url);
  }

  function openPaperResource(paperId: string, kind: PaperResourceKind) {
    const resources = getPaperMineruResources(paperId);
    if (!resources || (kind === "figures" ? resources.figures.length === 0 : kind === "multimodal" ? resources.textChunks.length === 0 && resources.figures.length === 0 : resources.textChunks.length === 0)) {
      setAnalysisHint("该论文尚未完成 MinerU 解析，完成后会在这里提供提取文本和论文插图。");
      return;
    }
    const resource = { kind, paperId } as const;
    const resourceId = paperResourceTabId(resource);
    setOpenPaperResources((current) => current.some((item) => paperResourceTabId(item) === resourceId)
      ? current
      : [...current, resource]);
    setActivePaperResourceId(resourceId);
    setActiveReaderPaperId(null);
    setActiveCenterArtifactId(null);
    setActiveVisualizationId(null);
  }

  function openVisualization(data: VisualizationTabData) {
    setOpenVisualizations((current) => current.some((item) => item.id === data.id) ? current : [...current, data]);
    setActiveVisualizationId(data.id);
    setActiveReaderPaperId(null);
    setActivePaperResourceId(null);
    setActiveCenterArtifactId(null);
  }

  function closeVisualization(visualizationId: string) {
    setOpenVisualizations((current) => {
      const next = current.filter((item) => item.id !== visualizationId);
      setActiveVisualizationId((active) => active === visualizationId ? next[0]?.id ?? null : active);
      return next;
    });
  }

  function closePaperResource(resourceId: string) {
    setOpenPaperResources((current) => {
      const closingIndex = current.findIndex((resource) => paperResourceTabId(resource) === resourceId);
      const next = current.filter((resource) => paperResourceTabId(resource) !== resourceId);
      setActivePaperResourceId((active) => {
        if (active !== resourceId) return active;
        return next[Math.min(closingIndex, next.length - 1)]
          ? paperResourceTabId(next[Math.min(closingIndex, next.length - 1)])
          : null;
      });
      return next;
    });
  }

  function addPaperResourceToConversation(resource: OpenPaperResource) {
    const paper = workspaceState.papers.find((candidate) => candidate.id === resource.paperId);
    const materials = getPaperMineruResources(resource.paperId);
    if (!paper || !materials) return;
    const excerpt = resource.kind === "figures"
      ? materials.figures.map((figure) => (
        `第 ${figure.page} 页图表：${figure.analysis?.title ?? figure.alt}\n${figure.analysis?.description ?? "原文高清插图"}`
      )).join("\n\n")
      : resource.kind === "multimodal"
        ? materials.textChunks.slice(0, 12).map((chunk) => `第 ${chunk.page} 页：${chunk.snippet}`).join("\n\n")
      : materials.textChunks.slice(0, 12).map((chunk) => (
        `第 ${chunk.page} 页：${chunk.snippet}`
      )).join("\n\n");
    if (!excerpt) return;
    addReaderContextToConversation({
      excerpt: excerpt.slice(0, 12_000),
      page: resource.kind === "figures"
        ? materials.figures[0]?.page ?? 1
        : materials.textChunks[0]?.page ?? 1,
      paperId: paper.id,
      paperTitle: paper.title,
      source: resource.kind === "figures" ? "figures" : "extracted_text"
    });
    setAnalysisHint(`已将《${paper.title}》的${resource.kind === "figures" ? "插图说明" : resource.kind === "multimodal" ? "图文素材" : "提取文本"}加入对话。`);
  }

  function renderPaperResource(resource: OpenPaperResource) {
    const paper = workspaceState.papers.find((candidate) => candidate.id === resource.paperId);
    const materials = getPaperMineruResources(resource.paperId);
    if (!paper || !materials) return null;
    return (
      <PaperResourceTab
        figures={materials.figures}
        kind={resource.kind}
        onLoadTranslations={(markedSource) => paperTranslation.actions.loadPaperResourceTranslations(paper, markedSource)}
        onCreatePresentation={() => {
          artifactWorkflow.actions.startAnalysisForPapers("ppt", [paper]);
          setAnalysisHint(`正在使用《${paper.title}》的 MinerU 素材制作展示内容。`);
        }}
        onTranslate={(sourceLanguage, targetLanguage, markedSource, options) => paperTranslation.actions.translatePaperResource(paper, sourceLanguage, targetLanguage, markedSource, options)}
        onUseInConversation={() => addPaperResourceToConversation(resource)}
        paper={paper}
        textChunks={materials.textChunks}
      />
    );
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
    accountScopeId: accountSession?.userId,
    activePaperId: activeReaderPaper?.id ?? null,
    academicProfile: profileActions.academicProfile,
    agentMemories: profileActions.agentMemories,
    agentRecentState,
    artifactCatalog,
    artifactCatalogLoadState,
    accountSession,
    cloudEndpoint: externalKnowledgeEndpoint,
    cloudTreeRevision,
    documentMetadataSyncMessage,
    documentMetadataSyncResult: documentMetadataSyncResult ?? null,
    documentMetadataSyncStatus,
    exportError: artifactExports.model.error,
    exportRecords: artifactExports.model.records,
    exportStatus: artifactExports.model.status,
    importJobs: importJobsByDocumentId,
    libraryPaperChildren,
    localLibraryError,
    localLibrarySnapshot,
    literatureHydration: workspaceSelection.model.literatureHydration,
    libraryRootPath: localLibrarySnapshot?.rootPath ?? null,
    loadLegacyLibraryRoots: isPaperCacheAvailable()
      ? listLegacyLocalLibraryRoots
      : undefined,
    onBackupLibrary: isPaperCacheAvailable()
      ? backupLocalLibrary
      : undefined,
    onChangeLibraryRoot: isPaperCacheAvailable()
      ? async (nextRootPath: string) => {
          await setLocalLibraryRoot(nextRootPath);
          await refreshLocalLibrary();
        }
      : undefined,
    onOpenLibraryInFileManager: isPaperCacheAvailable()
      ? openLocalLibraryInFileManager
      : undefined,
    onSelectLegacyLibraryRoot: isPaperCacheAvailable()
      ? async (legacyRootPath: string) => {
          await selectLegacyLocalLibraryRoot(legacyRootPath);
          await refreshLocalLibrary();
        }
      : undefined,
    list: organizationList,
    listMessage: organizationListMessage,
    listStatus: organizationListStatus,
    onAddDroppedPdfFiles: async (files, targetFolderPath) => {
      const organizationId = workspaceState.workspaceSource.type === "organization_shared"
        ? workspaceState.workspaceSource.rootPath.match(/^org:([^:]+):/)?.[1]
        : undefined;
      if (!organizationId) {
        await workspaceActions.addDroppedPdfFiles(files, targetFolderPath);
        return;
      }
      const cloudLibrary = createCloudLibraryStorageClient({ endpoint: externalKnowledgeEndpoint });
      const organizationTree = await cloudLibrary.getTree({
        scopeId: organizationId,
        scopeType: "organization"
      });
      let expectedRevision = organizationTree.tree.revision;
      const organizationRoot = `org://${organizationId}/shared-library/`;
      const relativeTarget = targetFolderPath?.startsWith(organizationRoot)
        ? targetFolderPath.slice(organizationRoot.length)
        : "";
      const folderId = relativeTarget && !relativeTarget.includes("/")
        ? relativeTarget
        : undefined;
      for (const file of files) {
        const result = await cloudLibrary.uploadDocument({
          expectedRevision,
          file,
          folderId,
          onDuplicate: () => window.confirm(
            "当前内容已存在。选择“确定”另存副本，选择“取消”停止本次上传。"
          ),
          scope: { scopeId: organizationId, scopeType: "organization" }
        });
        expectedRevision = result.revision ?? expectedRevision;
        if (result.document) {
          workspaceStoreRef.current.addPaper({
            id: result.document.documentId,
            sourcePath: `org://${organizationId}/shared-library/${
              result.document.folderId ? `${result.document.folderId}/` : ""
            }${result.document.documentId}.pdf`,
            title: result.document.fileName.replace(/\.pdf$/i, "")
          });
        }
      }
      workspaceActions.syncWorkspace();
      setAnalysisHint("组织文献已上传并同步到共享文献库。");
    },
    onImportZoteroDirectory: async (files) => {
      if (!localLibrarySnapshot) {
        throw new Error("本地文献库尚未准备完成。");
      }
      const result = await persistZoteroPdfDirectory({
        files,
        snapshot: localLibrarySnapshot
      });
      await refreshLocalLibrary();
      return result.status === "cancelled"
        ? "已取消 Zotero PDF 导入，本地文献库未更改。"
        : `已从 Zotero 导出目录导入 ${result.importedCount} 个 PDF，保留原有目录层级。`;
    },
    onAddExternalPdf: externalPapers.promoteExternalPaperToLibrary,
    onClearProfile: profileActions.openClearProfileConfirm,
    onClearRecommendations: knowledgeSync.actions.clearRecommendationCache,
    onDeleteArtifact: deleteArtifact,
    onDismissRecommendation: async (recommendation) => {
      await knowledgeSync.actions.dismissRecommendation(recommendation);
      await profileActions.recordPersonalizationSignal({
        kind: "recommendation_dismissed",
        recommendationId: recommendation.id
      });
    },
    onCreateOrganization: organizationShell.actions.openCreateDialog,
    onInviteMember: organizationShell.actions.openInviteDialog,
    onJoinOrganization: organizationShell.actions.openJoinDialog,
    onLeaveOrganization: organizationShell.actions.openLeaveDialog,
    onLoginRequired: cloudAccount.actions.openLoginDialog,
    onLogout: logoutAndClearOrganizationState,
    onMarkNotificationsRead: organizationShell.actions.markOrganizationNotificationsRead,
    onOrganizationChanged: organizationShell.actions.refreshOrganizationData,
    onOpenAcademicArchive: profileActions.openAcademicArchive,
    onOpenArtifact: (artifactId) => {
      artifactWorkflow.actions.openArtifact(artifactId);
      activateArtifactSurface(artifactId);
    },
    onOpenExport: artifactExports.actions.openExport,
    onOpenOrganizationDialog: organizationShell.actions.openOrganizationDialog,
    onOpenCloudEntry: async (scope, entry) => {
      if (entry.entryKind !== "pdf") return;
      await externalPapers.openCloudDocumentInReader({
        documentId: entry.documentId,
        scopeId: scope.scopeId,
        scopeType: scope.scopeType,
        title: entry.title
      });
      await profileActions.recordPersonalizationSignal({
        kind: "paper_opened",
        title: entry.title
      });
    },
    onOpenPaper: openPaperInReader,
    onRefreshLocalLibrary: async () => {
      await refreshLocalLibrary();
      setAnalysisHint("本地文献库已从磁盘重新扫描。");
    },
    onMoveLibraryFolder: workspaceActions.moveFolder,
    onMoveLibraryPaper: workspaceActions.movePaper,
    onRetrievePaperMetadata: async (paper: Paper) => await retrievePdfMetadata({ paper, firstPageText: "", manual: true })
      ?? "文献已发生变化，本次获取已取消，请重试。",
    onResolvePaperIdentity: (paper: Paper) => {
      void pdfAnnotationPublication.actions.resolvePaperIdentity(paper, createPdfLiteratureHints(paper, {}));
    },
    onOpenPaperChild: (item, paper) => {
      if (item.kind === "artifact") {
        artifactWorkflow.actions.openArtifact(item.id);
        activateArtifactSurface(item.id);
        return;
      }
      if (item.kind === "extracted_text" || item.kind === "figures" || item.kind === "multimodal") {
        openPaperResource(paper.id, item.kind);
      }
    },
    onRenamePaperChild: async (item, _paper, requestedName) => {
      if (item.kind !== "artifact") {
        return "仅支持重命名已保存的多模态产物。";
      }
      const outcome = await artifactWorkflow.actions.renameArtifact(item.id, requestedName);
      return outcome.message;
    },
    onOpenSharedLibrary: (summary) => {
      void organizationShell.actions.openOrganizationSharedLibrary(summary);
    },
    onOpenSkillDocument: (entry) => {
      artifactWorkflow.actions.openSkillDocument(entry);
      activateArtifactSurface(`skill-doc-${entry.id}`);
    },
    onReloadArtifactCatalog: artifactWorkflow.actions.reloadArtifactCatalog,
    onRemoveExport: artifactExports.actions.removeExport,
    onRenameArtifact: artifactWorkflow.actions.renameArtifact,
    onRefreshExports: artifactExports.actions.refresh,
    onRevealExport: artifactExports.actions.revealExport,
    onRenameLibraryFolder: workspaceActions.renameFolder,
    onRenameLibraryPaper: workspaceActions.renamePaper,
    onResourceTransfer: transferLibraryResource,
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
    organizationId: organizationSummary?.organizationId,
    papers: workspaceState.papers,
    profileClearMessage: profileActions.profileClearMessage,
    profileReadPaperCount: workspaceState.papers.length,
    profileSamplingEnabled: settingsState["profile.enabled"],
    profileTags: profileActions.profileTags,
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
      itemId === "artifact-library" ||
      itemId === "library" ||
      itemId === "organization" ||
      itemId === "profile" ||
      itemId === "settings"
    );
  }

  function activateDockItem(regionId: DockRegionId, itemId: DockItemId) {
    if (regionId === "main") {
      setActiveCenterArtifactId(null);
      setActiveReaderPaperId(null);
      setActiveVisualizationId(null);
      setActivePaperResourceId(null);
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
    if (itemId === "board") objectWorkbench.setVisible(true);
    if (targetRegionId === "main") {
      setActiveCenterArtifactId(null);
      setActiveReaderPaperId(null);
      setActiveVisualizationId(null);
      setActivePaperResourceId(null);
    } else {
      setActiveSideArtifactIds((current) => {
        if (!current[targetRegionId]) {
          return current;
        }
        const next = { ...current };
        delete next[targetRegionId];
        return next;
      });
      revealDockRegion(targetRegionId);
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
          developerDiagnostics={cloudAccount.model.developerDiagnostics}
          intuechoEndpoint={resolveIntuechoEndpoint()}
          onOpenTaskDetails={artifactSessionNavigation.openTaskDetails}
          canOpenTaskDetails={artifactSessionNavigation.canOpenTaskDetails}
          intuechoSessionId={accountSession?.sessionId}
          onLoadForumFeed={forum.loadFeed}
          onDynamicAction={(action) => {
            void handleArtifactCanvasAction(action);
          }}
          onOpenEvidence={openEvidenceInReader}
          onOpenVisualization={openVisualization}
          onDeleteArtifact={async (artifactId) => {
            const outcome = await deleteArtifact(artifactId);
            return outcome.message;
          }}
          onExportArtifact={artifactExports.actions.exportArtifact}
          onActivateArtifact={activateArtifactSurface}
          onRegenerateArtifact={(request) => {
            artifactWorkflow.actions.regenerateArtifact(request);
          }}
          onGenerateThinReadingBranch={artifactWorkflow.actions.generateThinReadingBranch}
          onRetryInterruptedThinReadingBranch={artifactWorkflow.actions.retryInterruptedThinReadingBranch}
          onSyncThinReadingAnnotations={artifactWorkflow.actions.syncThinReadingAnnotations}
          onToggleThinReadingVisualization={artifactWorkflow.actions.setThinReadingVisualizationEnabled}
          onStartAnalysis={(artifactType) => {
            void registeredWorkspaceActions.handleDirectAnalysis(artifactType);
          }}
          onUpdateThinReadingDocument={artifactWorkflow.actions.updateThinReadingDocument}
          selectedCount={workspaceState.selectedPaperIds.length}
          selectionLocked={workspaceState.selectionLocked}
          tabs={tabs}
          tasks={artifactTasks}
          thinReadingVisualizationCapability={cloudAccount.model.multimodalVisualization}
          thinReadingVisualizationReadyArtifacts={thinReadingVisualizationReadyArtifacts}
          thinReadingVisualizationStatuses={thinReadingVisualizationStatuses}
        />
      </section>
    );
  }

  function addReaderContextToConversation(context: ReaderConversationContext) {
    setReaderConversationContext(context);
    const assistantRegionId = dock.findItemRegion("assistant") ?? "right";
    dock.openItem("assistant");
    if (assistantRegionId !== "main") {
      revealDockRegion(assistantRegionId);
    }
  }

  function renderDockItem(itemId: DockItemId, regionId: DockRegionId) {
    if (itemId === "help") return <HelpPanel model={help.model} />;
    if (isLeftRailDockItem(itemId)) {
      return <LeftPane {...leftPaneProps} leftRailView={itemId} />;
    }

    if (itemId === "notes") return <NotesPanel model={notes.model} />;
    if (itemId === "board") return <ObjectWorkbench key={objectWorkbench.repository.scopeId} model={objectWorkbench} />;
    if (itemId === "assistant") return <DockSurfaceSlot host={assistantSurfaceHost} />;

    return renderArtifactSurface();
  }

  function renderAssistantSurface(regionId: DockRegionId) {
      return (
        <AssistantSidebar
          key={assistantScopeId}
          historyPersistence={assistantHistoryRef.current}
          onOpenCitation={(citation) => openEvidenceInReader(paperCitationOpenRequest(citation))}
          agentClient={assistantAgent.agentClient}
          academicProfile={profileActions.academicProfile}
          artifactTasks={artifactTasks}
          developerDiagnostics={cloudAccount.model.developerDiagnostics}
          artifactSessionOpenRequest={artifactSessionNavigation.request}
          executionJournal={assistantAgent.executionJournal}
          importedChunksByPaperId={importedChunksByPaperId}
          importedSelectedCount={importedSelectedCount}
          modelTransport={effectiveModelTransport}
          readerConversationContext={readerConversationContext}
          onApplyLayoutPreset={runtimeActionContext.applyLayoutPreset}
          onApplyGeneratedTheme={runtimeActionContext.applyGeneratedTheme}
          onApplyPanelAction={runtimeActionContext.applyPanelAction}
          onApplyThemePreset={runtimeActionContext.applyThemePreset}
          onResumeArtifactTask={artifactWorkflow.actions.resumeArtifactTask}
          onCancelArtifactTask={artifactWorkflow.actions.cancelArtifactTask}
          onGenerateArtifact={(artifactType, paperIds, context, contextRefs) => {
            const ids = paperIds?.length ? paperIds : workspaceStoreRef.current.getSelectedDocumentSet().locked
              ? workspaceStoreRef.current.getSelectedDocumentSet().documentIds : [];
            const papers = ids.map((id) => workspaceStoreRef.current.getState().papers.find((paper) => paper.id === id));
            if ((!papers.length && !contextRefs?.length) || papers.some((paper) => !paper)) return "请指定论文或将笔记、白板等资源拖入对话后再生成。";
            const sources = papers.filter((paper): paper is Paper => Boolean(paper));
            const options = { supplementalContext: context, contextRefs };
            return artifactType === "thin_reading"
              ? sources.map((paper) => artifactWorkflow.actions.startAnalysisForPapers(artifactType, [paper], options)).join("\n")
              : artifactWorkflow.actions.startAnalysisForPapers(artifactType, sources, options);
          }}
          onImportSelectedSet={runtimeActionContext.importSelectedSet}
          onPreparePapersForContext={async (paperIds) => {
            const paperIdSet = new Set(paperIds);
            const papers = workspaceStoreRef.current.getState().papers.filter((paper) =>
              paperIdSet.has(paper.id)
            );
            if (papers.length !== paperIdSet.size) {
              throw new Error("@ 引用中包含当前文献库里不存在的文件。");
            }
            setAnalysisHint(`正在为本轮对话解析 ${papers.length} 篇 @ 文献…`);
            await workspaceActions.ensurePapersImported(papers);
            setAnalysisHint(`已将 ${papers.length} 篇 @ 文献加入本轮上下文，未改变锁定集合。`);
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
          regionId={isBaseDockRegionId(regionId) && regionId !== "main" ? regionId : "right"}
          runtimeOrganizationName={organizationSummary?.name}
          runtimeWorkspace={workspaceState.workspaceSource}
          availablePapers={workspaceState.papers}
          contextSuggestions={assistantContextSuggestions}
          selectedPaperCount={workspaceState.selectedPaperIds.length}
          selectedPapers={selectedPapers}
          selectionLocked={workspaceState.selectionLocked}
          settingsStore={settingsStoreRef.current}
        />
      );
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
        onQuickAsk={askPdfQuestion}
        {...teamAnnotations.readerBindings(paper)}
        allowServerPdfParsing={false}
        readingContent={getPaperMineruResources(paper.id)?.textChunks.some((chunk) => chunk.textExtraction === "mineru")
          ? renderPaperResource({ paperId: paper.id, kind: "multimodal" }) : undefined}
        extractingPaper={paperServices.running.includes(paper.id)}
        onExtractPaper={async () => { await paperServices.extract(paper); }}
        analysisHint={analysisHint}
        artifactTabs={artifactTabs}
        artifactTasks={artifactTasks}
        developerDiagnostics={cloudAccount.model.developerDiagnostics}
        externalKnowledgeEndpoint={externalKnowledgeEndpoint}
        layoutCollapsed={paneLayout.collapsed}
        loadPdfSource={externalPapers.loadPdfSource}
        literatureResolution={pdfAnnotationPublication.model.resolutionsByPaperId[paper.id]}
        loadLiteratureRelations={literatureAuthorityClient.literatureRelations}
        onAddExternalPdfToLibrary={workspaceActions.addExternalPdfToLibrary}
        onAcquireLiteratureVersion={(literature, relation) =>
          externalPapers.acquireLiteratureVersion(literature, relation.evidence)}
        onOpenExternalFullText={externalPapers.openExternalFullTextInReader}
        onOpenLiteratureVersion={openLiteratureVersion}
        onResolveLiteratureIdentity={() => {
          void pdfAnnotationPublication.actions.resolvePaperIdentity(
            paper,
            createPdfLiteratureHints(paper, {})
          );
        }}
        onPaperAnnotated={
          isPaperCacheAvailable() ? externalPapers.promoteCachedPaperToLibrary : undefined
        }
        onPromoteExternalPaperToLibrary={externalPapers.promoteExternalPaperToLibrary}
        onArtifactDynamicAction={(action) => {
          void handleArtifactCanvasAction(action);
        }}
        onOpenEvidence={openEvidenceInReader}
        onOpenVisualization={openVisualization}
        onGenerateThinReadingBranch={artifactWorkflow.actions.generateThinReadingBranch}
        onSyncThinReadingAnnotations={artifactWorkflow.actions.syncThinReadingAnnotations}
        intuechoEndpoint={resolveIntuechoEndpoint()}
        intuechoSessionId={accountSession?.sessionId}
        paperRelationsTransport={effectiveModelTransport}
        onLoadForumFeed={forum.loadFeed}
        onChangeAnnotationPublication={pdfAnnotationPublication.actions.changePublication}
        onStartAnalysis={startReaderScopedAnalysis}
        onAddReaderContextToConversation={addReaderContextToConversation}
        onReaderSelectionChanged={extensionRuntime.actions.publishReaderSelection}
        onUpdateThinReadingDocument={artifactWorkflow.actions.updateThinReadingDocument}
        onToggleThinReadingVisualization={artifactWorkflow.actions.setThinReadingVisualizationEnabled}
        thinReadingVisualizationCapability={cloudAccount.model.multimodalVisualization}
        thinReadingVisualizationReadyArtifacts={thinReadingVisualizationReadyArtifacts}
        thinReadingVisualizationStatuses={thinReadingVisualizationStatuses}
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

  function closeDockRegion(regionId: DockRegionId) {
    if (!isBaseDockRegionId(regionId)) {
      const activeItem = dock.layout.regions[regionId].activeItemId;
      const activeTab = activeSideArtifactIds[regionId];
      dock.removeRegion(regionId);
      if (activeTab) moveDynamicTab(activeTab, "main");
      else if (activeItem) activateDockItem("main", activeItem);
      setActiveSideArtifactIds((current) => { const next = { ...current }; delete next[regionId]; return next; });
    } else if (regionId !== "main") {
      paneLayout.setCollapsed(regionId, true);
    } else {
      for (const item of dock.layout.regions.main.itemIds) { dock.closeItem(item); if (item === "board") objectWorkbench.setVisible(false); }
      setOpenReaderPaperIds((current) => current.filter((id) => (dock.findDynamicItemRegion(`pdf-${id}`) ?? "main") !== "main")); setActiveReaderPaperId(null);
      setOpenPaperResources((current) => current.filter((resource) => (dock.findDynamicItemRegion(paperResourceTabId(resource)) ?? "main") !== "main")); setActivePaperResourceId(null);
      setOpenVisualizations((current) => current.filter((item) => (dock.findDynamicItemRegion(item.id) ?? "main") !== "main")); setActiveVisualizationId(null);
      for (const tab of artifactTabs.filter((tab) => getArtifactRegion(tab.artifactId) === "main")) artifactWorkflow.actions.closeArtifactTab(tab.artifactId);
      setActiveCenterArtifactId(null);
    }
  }

  function moveDynamicTab(tabId: string, targetRegionId: DockRegionId) {
    if (artifactTabs.some((tab) => tab.artifactId === tabId)) { moveArtifactSurface(tabId, targetRegionId); return; }
    const paper = openReaderPapers.find((paper) => `pdf-${paper.id}` === tabId);
    const resource = openPaperResources.find((resource) => paperResourceTabId(resource) === tabId);
    const visualization = openVisualizations.find((item) => item.id === tabId);
    if (!paper && !resource && !visualization) return;
    dock.moveDynamicItem(tabId, targetRegionId);
    setActiveSideArtifactIds((current) => Object.fromEntries(Object.entries(current).filter(([, id]) => id !== tabId)));
    if (targetRegionId === "main") {
      setActiveReaderPaperId(paper?.id ?? null);
      setActivePaperResourceId(resource ? tabId : null);
      setActiveVisualizationId(visualization ? tabId : null);
      setActiveCenterArtifactId(null);
    } else {
      if (paper && activeReaderPaperId === paper.id) setActiveReaderPaperId(null);
      if (resource && activePaperResourceId === tabId) setActivePaperResourceId(null);
      if (visualization && activeVisualizationId === tabId) setActiveVisualizationId(null);
      setActiveSideArtifactIds((current) => ({ ...current, [targetRegionId]: tabId }));
      revealDockRegion(targetRegionId);
    }
  }

  function renderDockRegion(regionId: DockRegionId) {
    const showDetachedLayoutControls =
      regionId === "main" &&
      activeCenterArtifactId !== null;
    const dynamicReaderTabs = openReaderPapers.filter((paper) => (dock.findDynamicItemRegion(`pdf-${paper.id}`) ?? "main") === regionId).map((paper) => ({
          draggable: true,
          onDragStart: (event: React.DragEvent<HTMLButtonElement>) => { event.dataTransfer.effectAllowed = "copyMove"; event.dataTransfer.setData(PAPER_CONTEXT_MIME, paper.id); },
          icon: <DocumentPdfRegular />,
          id: `pdf-${paper.id}`,
          kind: "document" as const,
          onActivate: () => {
            if (regionId !== "main") { setActiveSideArtifactIds((current) => ({ ...current, [regionId]: `pdf-${paper.id}` })); return; }
            setActiveReaderPaperId(paper.id);
            setActiveCenterArtifactId(null);
            setActiveVisualizationId(null);
          },
          onClose: () => closeReaderPaper(paper.id),
          render: () => renderReaderPaper(paper.id),
          selected: regionId === "main" ? activeVisualizationId === null && activeCenterArtifactId === null && activePaperResourceId === null && activeReaderPaperId === paper.id : activeSideArtifactIds[regionId] === `pdf-${paper.id}`,
          title: paper.title
        }));
    const dynamicPaperResourceTabs = openPaperResources.filter((resource) => (dock.findDynamicItemRegion(paperResourceTabId(resource)) ?? "main") === regionId).map((resource) => {
          const paper = workspaceState.papers.find((candidate) => candidate.id === resource.paperId);
          const id = paperResourceTabId(resource);
          return {
            icon: resource.kind === "figures" || resource.kind === "multimodal" ? <ImageMultipleRegular /> : <DocumentTextRegular />,
            id,
            draggable: true,
            kind: "document" as const,
            onActivate: () => {
              if (regionId !== "main") { setActiveSideArtifactIds((current) => ({ ...current, [regionId]: id })); return; }
              setActivePaperResourceId(id);
              setActiveReaderPaperId(null);
              setActiveCenterArtifactId(null);
              setActiveVisualizationId(null);
            },
            onClose: () => closePaperResource(id),
            render: () => renderPaperResource(resource),
            selected: regionId === "main" ? activeVisualizationId === null && activeCenterArtifactId === null && activePaperResourceId === id : activeSideArtifactIds[regionId] === id,
            title: `${paper?.title ?? "论文"} · ${resource.kind === "figures" ? "插图" : resource.kind === "multimodal" ? "图文版" : "提取文本"}`
          };
        });
    const dynamicVisualizationTabs = openVisualizations.filter((item) => (dock.findDynamicItemRegion(item.id) ?? "main") === regionId).map((visualization) => ({
          draggable: true,
          icon: <DocumentTextRegular />,
          id: visualization.id,
          kind: "document" as const,
          onActivate: () => {
            if (regionId !== "main") { setActiveSideArtifactIds((current) => ({ ...current, [regionId]: visualization.id })); return; }
            setActiveVisualizationId(visualization.id);
            setActiveReaderPaperId(null);
            setActivePaperResourceId(null);
            setActiveCenterArtifactId(null);
          },
          onClose: () => closeVisualization(visualization.id),
          render: () => <VisualizationTab data={visualization} />,
          selected: regionId === "main" ? activeCenterArtifactId === null && activePaperResourceId === null && activeReaderPaperId === null && activeVisualizationId === visualization.id : activeSideArtifactIds[regionId] === visualization.id,
          title: visualization.title
        }));
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
    const dynamicTabs = [...dynamicReaderTabs, ...dynamicPaperResourceTabs, ...dynamicVisualizationTabs, ...dynamicArtifactTabs];
    return (
      <DockRegion
        dynamicTabs={dynamicTabs}
        layout={dock.layout.regions[regionId]}
        onActivateItem={(itemId) => activateDockItem(regionId, itemId)}
        onCloseItem={(item) => { dock.closeItem(item); if (item === "board") objectWorkbench.setVisible(false); }}
        onCloseRegion={() => closeDockRegion(regionId)}
        onSplitRegion={(side) => dock.splitRegion(regionId, side)}
        onItemDragStart={(item, event) => {
          if (item === "board" && objectWorkbench.board) {
            event.dataTransfer.effectAllowed = "copyMove";
            writeObjectTransfer(event.dataTransfer, makeObjectTransfer([refOf(objectWorkbench.board)], objectWorkbench.board.title));
          }
        }}
        onMoveDynamicTab={moveDynamicTab}
        onMoveItem={moveDockItem}
        overlay={
          regionId === "main" && !["help", "notes", "board"].some((item) => dock.layout.regions.main.activeItemId === item && !dynamicTabs.some((tab) => tab.selected)) ? (
            <FloatingModalityButton
              analysisHint={analysisHint}
              canStartAnalysis={
                workspaceState.selectedPaperIds.length > 0 && workspaceState.selectionLocked
              }
              generationProgress={activeThinReadingTask?.progress}
              onStartAnalysis={(artifactType) => {
                startReaderScopedAnalysis(artifactType, getActiveReaderAnalysisPapers());
              }}
            />
          ) : undefined
        }
        regionId={regionId}
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
    <NotesContext.Provider value={notes.port}>
    <HelpContext.Provider value={help.port}>
    <ObjectWorkbenchContext.Provider value={objectWorkbench.port}>
    <div className={appFrameClassName} data-theme-scope={appFrameScope} style={appFrameStyle}>
      <div
        className={`app-shell${objectWorkbench.visible ? " object-workbench-open" : ""}`}
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
          notesOpen={workbenchNavigation.isVisible("notes")}
          onOpenNotes={() => notes.port.open()}
          agentOpen={workbenchNavigation.isVisible("assistant")}
          helpOpen={workbenchNavigation.isVisible("help")}
          onOpenAgent={() => workbenchNavigation.open("assistant")}
          onOpenHelp={() => help.port.open()}
          layoutControls={<><Tooltip content={objectWorkbench.visible ? "关闭研究白板" : "研究白板"} relationship="description"><Button appearance="subtle" aria-label="研究白板" aria-pressed={objectWorkbench.visible} icon={<WhiteboardRegular />} draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(dockItemMimeType, "board"); }} onClick={() => { if (workbenchNavigation.isVisible("board")) objectWorkbench.setVisible(false); else { objectWorkbench.setVisible(true); if (dock.findItemRegion("board")) workbenchNavigation.open("board"); } }} /></Tooltip><DockLayoutControls
            collapsed={paneLayout.collapsed}
            onToggleBottom={() => paneLayout.setCollapsed("bottom", !paneLayout.collapsed.bottom)}
            onToggleLeft={() => paneLayout.setCollapsed("left", !paneLayout.collapsed.left)}
            onToggleRight={() => paneLayout.setCollapsed("right", !paneLayout.collapsed.right)}
          /></>}
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
                revealDockRegion(regionId);
              }
              return;
            }
            if (isBaseDockRegionId(regionId) && regionId !== "main") {
              paneLayout.setCollapsed(regionId, !paneLayout.collapsed[regionId]);
            }
          }}
        />
        <AppDialogs
          academicProfile={profileActions.academicProfile}
          accountMessage={cloudAccount.model.accountMessage}
          accountPending={cloudAccount.model.accountPending}
          accountSession={accountSession}
          controlPlaneEndpoint={cloudAccount.model.controlPlaneEndpoint}
          academicArchiveOpen={profileActions.academicArchiveOpen}
          clearProfileConfirmOpen={profileActions.clearProfileConfirmOpen}
          createOrganizationOpen={createOrganizationOpen}
          inviteSummary={inviteSummary}
          joinOrganizationOpen={joinOrganizationOpen}
          leaveSummary={leaveSummary}
          list={organizationList}
          listMessage={organizationListMessage}
          literatureDialog={pdfAnnotationPublication.model.literatureDialog}
          organizationActionMessage={organizationActionMessage}
          organizationActionPending={organizationActionPending}
          onCancelClearProfile={profileActions.closeClearProfileConfirm}
          onCancelLiteratureResolution={pdfAnnotationPublication.actions.cancelResolution}
          onClearProfile={profileActions.clearUserProfile}
          onCloseAcademicArchive={profileActions.closeAcademicArchive}
          onCloseCreateOrganization={organizationShell.actions.closeCreateDialog}
          onCloseInviteMember={organizationShell.actions.closeInviteDialog}
          onCloseJoinOrganization={organizationShell.actions.closeJoinOrganizationDialog}
          onCloseLeaveOrganization={organizationShell.actions.closeLeaveDialog}
          onCloseOrganizationDialog={organizationShell.actions.closeOrganizationDialog}
          onCreateOrganization={(name) => {
            void organizationShell.actions.createOrganizationRequest(name);
          }}
          onInviteMember={(input) => {
            void organizationShell.actions.inviteOrganizationMember(input);
          }}
          onJoinOrganization={(invitationToken) => {
            void organizationShell.actions.joinOrganizationRequest(invitationToken);
          }}
          onLeaveOrganization={() => {
            void organizationShell.actions.leaveOrganizationRequest();
          }}
          onExportProfile={handleProfileExport}
          onSkipLogin={cloudAccount.actions.skipLogin}
          onSubmitAccountLogin={(login) => {
            void cloudAccount.actions.submitAccountLogin(login);
          }}
          onSubmitAccountRegistration={(registration) => {
            void cloudAccount.actions.submitAccountRegistration(registration);
          }}
          onSubmitSystemBrowserLogin={() => {
            void cloudAccount.actions.submitSystemBrowserLogin();
          }}
          onToggleSuppressLoginReminder={cloudAccount.actions.setSuppressLoginReminder}
          onOpenSharedLibrary={(summary) => {
            void organizationShell.actions.openOrganizationSharedLibrary(summary);
          }}
          onRetryLiteratureResolution={pdfAnnotationPublication.actions.retryResolution}
          onSearchLiterature={pdfAnnotationPublication.actions.searchLiterature}
          onSelectLiteratureCandidate={pdfAnnotationPublication.actions.selectCandidate}
          onSelectOrganization={organizationShell.actions.selectOrganization}
          organizationDialogOpen={organizationDialogOpen}
          loginDialogOpen={loginDialogOpen}
          summary={organizationSummary}
        />
        <div className="dock-workspace-columns" style={{ gridTemplateColumns: visibleHorizontalRegions.map((region) => `minmax(0, ${regionWeight(region)}fr)`).join(" 4px ") }}>
          {visibleHorizontalRegions.map((region, index) => <Fragment key={region}>
            {index > 0 ? <PaneResizer ariaLabel={`调整${region === "right" ? "右栏" : region === "left" ? "左栏" : "分栏"}宽度`} onResize={(pixels) => {
              const total = visibleHorizontalRegions.reduce((sum, id) => sum + regionWeight(id), 0);
              const delta = pixels / Math.max(1, window.innerWidth - 64) * total;
              const previous = visibleHorizontalRegions[index - 1];
              dock.resizeRegion(previous, regionWeight(previous) + delta);
              dock.resizeRegion(region, regionWeight(region) - delta);
            }} /> : null}
            {renderDockRegion(region)}
          </Fragment>)}
        </div>
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
        {bottomPaneVisible ? <div className="dock-bottom-columns" style={{ gridTemplateColumns: dock.layout.bottomOrder.map((region) => `minmax(0, ${regionWeight(region)}fr)`).join(" 4px ") }}>
          {dock.layout.bottomOrder.map((region, index) => <Fragment key={region}>
            {index > 0 ? <PaneResizer ariaLabel="调整下栏分栏宽度" onResize={(pixels) => {
              const total = dock.layout.bottomOrder.reduce((sum, id) => sum + regionWeight(id), 0);
              const delta = pixels / Math.max(1, window.innerWidth - 64) * total;
              const previous = dock.layout.bottomOrder[index - 1];
              dock.resizeRegion(previous, regionWeight(previous) + delta);
              dock.resizeRegion(region, regionWeight(region) - delta);
            }} /> : null}
            {renderDockRegion(region)}
          </Fragment>)}
        </div> : null}
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
    {createPortal(renderAssistantSurface(dock.findItemRegion("assistant") ?? "right"), assistantSurfaceHost)}
    </ObjectWorkbenchContext.Provider>
    </HelpContext.Provider>
    </NotesContext.Provider>
  );
}
