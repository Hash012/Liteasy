import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { canManageOrganizationLibrary } from "../features/organization/organizationStoragePolicy";
import { useForumController } from "../features/forum/useForumController";
import type { UIDslActionRef, UIDslDocument } from "../features/generative-ui/generativeUi.types";
import { generateWorkbenchOverlayUIDslDocument } from "../features/generative-ui/uiDslGenerator";
import { DockRegion } from "../features/dock/DockRegion";
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
import { getDefaultModelForProvider } from "../features/models/modelPolicy";
import type { AcademicProfileTransport } from "../features/profile/academicProfileClient";

type AppShellProps = {
  accountCapabilitiesTransport?: AccountCapabilitiesTransport;
  accountTransport?: AccountTransport;
  academicProfileTransport?: AcademicProfileTransport;
  controlPlaneTransport?: ControlPlaneTransport;
  documentMetadataTransport?: DocumentMetadataTransport;
  initialSettings?: Partial<SettingsState>;
  initialPapers?: Paper[];
  localDevCloudEnv?: DevCloudEnvLike;
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
  accountCapabilitiesTransport,
  accountTransport,
  academicProfileTransport,
  controlPlaneTransport,
  documentMetadataTransport,
  initialPapers,
  initialSettings,
  localDevCloudEnv,
  organizationListTransport,
  organizationSharedLibraryManifestTransport,
  organizationTransport,
  localLibraryLoader,
  modelTransport,
  recommendationTransport
}: AppShellProps = {}) {
  const { artifactStore, importStoreRef, settingsStoreRef, workspaceStoreRef } = useAppShellStores(
    initialSettings,
    initialPapers
  );
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
  const { isOnline } = useConnectivity();
  const [runtimeTheme, setRuntimeTheme] = useState<RuntimeTheme>({ kind: "default" });
  const [workbenchOverlay, setWorkbenchOverlay] = useState<UIDslDocument | null>(null);
  const [activeCenterArtifactId, setActiveCenterArtifactId] = useState<string | null>(null);
  const [activeSideArtifactIds, setActiveSideArtifactIds] = useState<
    Partial<Record<DockRegionId, string>>
  >({});
  const [openReaderPaperIds, setOpenReaderPaperIds] = useState<string[]>([]);
  const [activeReaderPaperId, setActiveReaderPaperId] = useState<string | null>(null);
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
  const effectiveModelTransport = useMemo(() => modelTransport ?? createBearerModelTransport({
    getAccessToken: () => cloudAccessTokenRef.current
  }), [modelTransport]);
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
    extractPaperResources: (paper) => {
      const savedMaterial = savedMineruResourcesRef.current[paper.id];
      if (savedMaterial) {
        return Promise.resolve({
          chunks: savedMaterial.textChunks,
          figures: savedMaterial.figures
        });
      }
      return extractPdfResourcesWithMineruFallback({
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
    artifactResultScopeKey: artifactAccountId
      ? `${settingsState["models.cloud_proxy_endpoint"]}:${artifactAccountId}`
      : undefined,
    cancelAgentRun: (runId, reason) => agentCancelRunnerRef.current(runId, reason),
    cancelThinReadingVisualization: (input) => cancelVisualizationGenerationRef.current(input),
    generateThinReadingVisualization: (request) => generateVisualizationRef.current(request),
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
    isAgentModelAccessAvailable: () => Boolean(modelTransport || cloudAccessTokenRef.current),
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
          sourcePaper.id === paper.id ||
          sourcePaper.title === paper.title ||
          sourcePaper.title.startsWith(`${paper.title}：`) ||
          paper.title.startsWith(`${sourcePaper.title}：`)
        ));
      });
      if (artifact) {
        resources[paper.id] = {
          figures: artifact.figures ?? [],
          textChunks: artifact.mineruTextChunks ?? []
        };
      }
      return resources;
    },
    {}
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

  const savedMineruResourceSignature = artifactCatalog
    .map((artifact) => `${artifact.artifactId}:${artifact.figures?.length ?? 0}:${artifact.mineruTextChunks?.length ?? 0}`)
    .sort()
    .join("|");

  useEffect(() => {
    const restored: Record<string, ImportJob> = {};
    for (const paper of workspaceState.papers) {
      const material = savedMineruResourcesByPaperId[paper.id];
      const latestJob = importStoreRef.current.getLatestJobByDocumentId(paper.id);
      if (!material || latestJob?.status === "parsed" || !paper.sourcePath) {
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

  const cloudAccount = useCloudAccountController({
    accountCapabilitiesTransport,
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
  multimodalVisualizationCapabilityRef.current = cloudAccount.model.multimodalVisualization;
  updateMultimodalVisualizationCapabilityRef.current =
    cloudAccount.actions.setMultimodalVisualizationCapability;
  cancelVisualizationGenerationRef.current = cloudAccount.actions.cancelVisualizationGeneration;
  generateVisualizationRef.current = cloudAccount.actions.generateVisualization;
  pendingVisualizationRequestsRef.current = cloudAccount.actions.pendingVisualizationRequests;
  resumeVisualizationGenerationRef.current = cloudAccount.actions.resumeVisualizationGeneration;
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
    modelTransport: effectiveModelTransport,
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
  const pdfAnnotationPublication = usePdfAnnotationPublicationController({
    forumClient: forum.client,
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
          tab.papers?.some((sourcePaper) =>
            sourcePaper.title === paper.title ||
            sourcePaper.title.startsWith(`${paper.title}：`) ||
            paper.title.startsWith(`${sourcePaper.title}：`)
          ) ||
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
          developerDiagnostics={cloudAccount.model.developerDiagnostics}
          intuechoEndpoint={resolveIntuechoEndpoint()}
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
          developerDiagnostics={cloudAccount.model.developerDiagnostics}
          executionJournal={assistantAgent.executionJournal}
          importedChunksByPaperId={importedChunksByPaperId}
          importedSelectedCount={importedSelectedCount}
          modelTransport={effectiveModelTransport}
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
        {...teamAnnotations.readerBindings(paper)}
        allowServerPdfParsing={false}
        analysisHint={analysisHint}
        artifactTabs={artifactTabs}
        artifactTasks={artifactTasks}
        developerDiagnostics={cloudAccount.model.developerDiagnostics}
        externalKnowledgeEndpoint={externalKnowledgeEndpoint}
        layoutCollapsed={paneLayout.collapsed}
        loadPdfSource={externalPapers.loadPdfSource}
        loadLiteratureRelations={forum.client.literatureRelations}
        onAddExternalPdfToLibrary={workspaceActions.addExternalPdfToLibrary}
        onOpenExternalFullText={externalPapers.openExternalFullTextInReader}
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
            setActiveVisualizationId(null);
          },
          onClose: () => closeReaderPaper(paper.id),
          render: () => renderReaderPaper(paper.id),
          selected: activeVisualizationId === null && activeCenterArtifactId === null && activePaperResourceId === null && activeReaderPaperId === paper.id,
          title: paper.title
        }))
      : [];
    const dynamicPaperResourceTabs = regionId === "main"
      ? openPaperResources.map((resource) => {
          const paper = workspaceState.papers.find((candidate) => candidate.id === resource.paperId);
          const id = paperResourceTabId(resource);
          return {
            icon: resource.kind === "figures" || resource.kind === "multimodal" ? <ImageMultipleRegular /> : <DocumentTextRegular />,
            id,
            kind: "document" as const,
            onActivate: () => {
              setActivePaperResourceId(id);
              setActiveReaderPaperId(null);
              setActiveCenterArtifactId(null);
              setActiveVisualizationId(null);
            },
            onClose: () => closePaperResource(id),
            render: () => renderPaperResource(resource),
            selected: activeVisualizationId === null && activeCenterArtifactId === null && activePaperResourceId === id,
            title: `${paper?.title ?? "论文"} · ${resource.kind === "figures" ? "插图" : resource.kind === "multimodal" ? "图文版" : "提取文本"}`
          };
        })
      : [];
    const dynamicVisualizationTabs = regionId === "main"
      ? openVisualizations.map((visualization) => ({
          icon: <DocumentTextRegular />,
          id: visualization.id,
          kind: "document" as const,
          onActivate: () => {
            setActiveVisualizationId(visualization.id);
            setActiveReaderPaperId(null);
            setActivePaperResourceId(null);
            setActiveCenterArtifactId(null);
          },
          onClose: () => closeVisualization(visualization.id),
          render: () => <VisualizationTab data={visualization} />,
          selected: activeCenterArtifactId === null && activePaperResourceId === null && activeReaderPaperId === null && activeVisualizationId === visualization.id,
          title: visualization.title
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
    const dynamicTabs = [...dynamicReaderTabs, ...dynamicPaperResourceTabs, ...dynamicVisualizationTabs, ...dynamicArtifactTabs];
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
              generationProgress={activeThinReadingTask?.progress}
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
          onSelectLiteratureCandidate={pdfAnnotationPublication.actions.selectCandidate}
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
