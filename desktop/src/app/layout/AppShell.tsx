import { invoke } from "@tauri-apps/api/core";
import { useMemo, useRef, useState } from "react";
import { useCollectionItems } from "../features/collection/useCollectionItems";
import { AssistantPane } from "../features/assistant/AssistantPane";
import { useCloudAccountActions } from "../features/account/useCloudAccountActions";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
import { createArtifactStore } from "../features/artifacts/artifact.store";
import { useArtifactActions } from "../features/artifacts/useArtifactActions";
import type { ArtifactTask, ArtifactTab } from "../features/artifacts/artifact.types";
import { createWorkspaceStore } from "../features/workspace/workspace.store";
import { useWorkspaceActions } from "../features/workspace/useWorkspaceActions";
import { useRegisteredWorkspaceActions } from "../features/workspace/useRegisteredWorkspaceActions";
import { createImportStore } from "../features/import/import.store";
import type { ImportJob } from "../features/import/import.types";
import type { WorkspaceState } from "../features/workspace/workspace.types";
import { cloneSettingsState, createSeededSettingsStore } from "../features/settings/settingsStateHelpers";
import type { SettingsState } from "../features/settings/settings.types";
import { useProfileActions } from "../features/profile/useProfileActions";
import type { ControlPlaneTransport } from "../features/models/controlPlaneClient";
import { formatModelExecutionLabel, type ModelExecutionTrace } from "../features/models/modelExecution";
import { usePolicySync } from "../features/models/usePolicySync";
import { useModelSettingsActions } from "../features/models/useModelSettingsActions";
import type { AccountTransport } from "../features/account/accountSessionClient";
import { useAccountSession } from "../features/account/useAccountSession";
import type { RecommendationTransport } from "../features/recommendations/recommendationClient";
import { useRecommendations } from "../features/recommendations/useRecommendations";
import type { DocumentMetadataTransport } from "../features/metadata/documentMetadataClient";
import { useDocumentMetadataSync } from "../features/metadata/useDocumentMetadataSync";
import { useOrganizationActions } from "../features/organization/useOrganizationActions";
import { useOrganizationNotifications } from "../features/organization/useOrganizationNotifications";
import { useOrganizationWorkspace } from "../features/organization/useOrganizationWorkspace";
import { useOrganizationUiState } from "../features/organization/useOrganizationUiState";
import { useLeftRailNavigation } from "./useLeftRailNavigation";
import type { OrganizationGovernanceTransport } from "../features/organization/organizationGovernanceClient";
import type { OrganizationListTransport } from "../features/organization/organizationListClient";
import type { OrganizationSummaryTransport } from "../features/organization/organizationSummaryClient";
import { useOrganizationData } from "../features/organization/useOrganizationData";
import { starterPapers } from "./starterPapers";
import { ActivityBar } from "./ActivityBar";
import { TopBar } from "./TopBar";
import { LeftPane } from "./LeftPane";
import { AppDialogs } from "./AppDialogs";
import { cloneWorkspaceState } from "../features/workspace/workspaceStateHelpers";

type AppShellProps = {
  accountTransport?: AccountTransport;
  controlPlaneTransport?: ControlPlaneTransport;
  documentMetadataTransport?: DocumentMetadataTransport;
  initialSettings?: Partial<SettingsState>;
  organizationGovernanceTransport?: OrganizationGovernanceTransport;
  organizationListTransport?: OrganizationListTransport;
  organizationTransport?: OrganizationSummaryTransport;
  recommendationTransport?: RecommendationTransport;
};

export function AppShell({
  accountTransport,
  controlPlaneTransport,
  documentMetadataTransport,
  initialSettings,
  organizationGovernanceTransport,
  organizationListTransport,
  organizationTransport,
  recommendationTransport
}: AppShellProps = {}) {
  const workspaceStoreRef = useRef(createWorkspaceStore());
  const workspaceSeededRef = useRef(false);
  const importStoreRef = useRef(createImportStore());
  const settingsStoreRef = useRef(createSeededSettingsStore(initialSettings));
  const artifactStore = useMemo(() => createArtifactStore(), []);
  if (!workspaceSeededRef.current) {
    starterPapers.forEach((paper) => workspaceStoreRef.current.addPaper(paper));
    workspaceSeededRef.current = true;
  }

  const [workspaceState, setWorkspaceState] = useState<WorkspaceState>(() =>
    cloneWorkspaceState(workspaceStoreRef.current.getState())
  );
  const [settingsState, setSettingsState] = useState<SettingsState>(() =>
    cloneSettingsState(settingsStoreRef.current.getState())
  );
  const [importJobsByDocumentId, setImportJobsByDocumentId] = useState<Record<string, ImportJob>>({});
  const [artifactTasks, setArtifactTasks] = useState<ArtifactTask[]>([]);
  const [artifactTabs, setArtifactTabs] = useState<ArtifactTab[]>([]);
  const [analysisHint, setAnalysisHint] = useState(
    "先勾选并锁定文献形成选中文献集，再用中栏模态按钮启动分析。"
  );
  const [lastModelExecution, setLastModelExecution] = useState<ModelExecutionTrace | undefined>();
  const [workspaceLabel, setWorkspaceLabel] = useState("本地文献库");
  const collection = useCollectionItems();
  const modelSettings = useModelSettingsActions({
    onSettingsChanged: (nextSettings) => setSettingsState(cloneSettingsState(nextSettings)),
    settingsStore: settingsStoreRef.current
  });
  const leftRail = useLeftRailNavigation();
  const profileActions = useProfileActions();
  const organizationUi = useOrganizationUiState();
  const organizationActions = useOrganizationActions({ onAnalysisHint: setAnalysisHint });
  const organizationNotifications = useOrganizationNotifications({ onAnalysisHint: setAnalysisHint });

  const workspaceActions = useWorkspaceActions({
    importDocument: (sourcePath) => invoke("mock_import", { sourcePath }),
    importStore: importStoreRef.current,
    onAnalysisHint: setAnalysisHint,
    onImportJobsChanged: setImportJobsByDocumentId,
    onWorkspaceChanged: setWorkspaceState,
    workspaceStore: workspaceStoreRef.current
  });

  const artifactActions = useArtifactActions({
    artifactStore,
    getImportedChunksByPaperId: workspaceActions.getImportedChunksByPaperId,
    getSelectedDocumentSet: () => workspaceStoreRef.current.getSelectedDocumentSet(),
    getSelectedPapers: workspaceActions.getSelectedPapers,
    onAnalysisHint: setAnalysisHint,
    onArtifactTabsChanged: setArtifactTabs,
    onArtifactTasksChanged: setArtifactTasks,
    queueImportForPapers: workspaceActions.queueImportForPapers
  });

  const registeredWorkspaceActions = useRegisteredWorkspaceActions({
    importSelectedSet: workspaceActions.importSelectedSet,
    onAnalysisHint: setAnalysisHint,
    startArtifactAnalysis: artifactActions.startAnalysis
  });

  const {
    lastSyncedAt,
    policySyncMessage,
    policySyncPending,
    policySyncStatus,
    policyVersion,
    syncCloudPolicy
  } = usePolicySync({
    applyModelPolicySnapshot: modelSettings.applyModelPolicySnapshot,
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
    getSettings: () => settingsStoreRef.current.getState(),
    onSessionRestored: modelSettings.applyLocalDevCloudDefaults
  });
  const cloudAccountActions = useCloudAccountActions({
    applyLocalDevCloudDefaults: modelSettings.applyLocalDevCloudDefaults,
    clearOrganizationNotifications: organizationNotifications.clearOrganizationNotifications,
    loginToCloudAccount,
    logoutFromCloudAccount,
    resetOrganizationActions: organizationActions.resetOrganizationActions,
    resetOrganizationSelection: organizationUi.resetOrganizationSelection
  });
  const selectedPapers = workspaceActions.getSelectedPapers();
  const importedChunksByPaperId = workspaceActions.getImportedChunksByPaperId();
  const importedSelectedCount = workspaceActions.getImportedSelectedCount();
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
    selectedPapers,
    workspaceRevision: workspaceState.workspaceRevision
  });
  const {
    lastResult: documentMetadataSyncResult,
    message: documentMetadataSyncMessage,
    status: documentMetadataSyncStatus
  } = useDocumentMetadataSync({
    accountSession,
    controlPlaneEndpoint: settingsState["models.control_plane_endpoint"],
    documents: workspaceState.papers,
    transport: documentMetadataTransport,
    workspaceRevision: workspaceState.workspaceRevision
  });
  const {
    organizationGovernanceMessage,
    organizationGovernanceStatus,
    organizationGovernanceSummary,
    organizationList,
    organizationListMessage,
    organizationListStatus,
    organizationSummary,
    organizationSummaryMessage,
    organizationSummaryStatus
  } = useOrganizationData({
    accountSession,
    controlPlaneEndpoint: settingsState["models.control_plane_endpoint"],
    getActiveOrganizationId: organizationUi.getActiveOrganizationId,
    organizationGovernanceTransport,
    organizationListTransport,
    organizationTransport
  });

  const organizationWorkspace = useOrganizationWorkspace({
    defaultSummary: organizationSummary,
    onAnalysisHint: setAnalysisHint,
    onLeftRailView: leftRail.setLeftRailView,
    onWorkspaceLabel: setWorkspaceLabel,
    onWorkspaceSync: workspaceActions.syncWorkspace,
    starterPapers,
    workspaceStoreRef
  });

  return (
    <div className="app-frame">
      <AppDialogs
        accountSession={accountSession}
        academicArchiveOpen={profileActions.academicArchiveOpen}
        clearProfileConfirmOpen={profileActions.clearProfileConfirmOpen}
        createOrganizationOpen={organizationActions.createOpen}
        inviteSummary={organizationActions.inviteSummary}
        joinOrganizationOpen={organizationActions.joinOpen}
        leaveSummary={organizationActions.leaveSummary}
        list={organizationList}
        listMessage={organizationListMessage}
        onCancelClearProfile={profileActions.closeClearProfileConfirm}
        onClearProfile={profileActions.clearUserProfile}
        onCloseAcademicArchive={profileActions.closeAcademicArchive}
        onCloseCreateOrganization={organizationActions.closeCreateDialog}
        onCloseInviteMember={organizationActions.closeInviteDialog}
        onCloseJoinOrganization={organizationActions.closeJoinDialog}
        onCloseLeaveOrganization={organizationActions.closeLeaveDialog}
        onCloseOrganizationDialog={organizationUi.closeOrganizationDialog}
        onCreateOrganization={organizationActions.createDemoOrganizationRequest}
        onInviteMember={organizationActions.sendDemoOrganizationInvite}
        onJoinOrganization={organizationActions.createDemoOrganizationJoinRequest}
        onLeaveOrganization={organizationActions.createDemoOrganizationLeaveRequest}
        onOpenSharedLibrary={(summary) => {
          void organizationWorkspace.openOrganizationSharedLibrary(summary);
        }}
        onSelectOrganization={organizationUi.selectOrganization}
        organizationDialogOpen={organizationUi.organizationDialogOpen}
        readPaperCount={workspaceState.papers.length}
        summary={organizationSummary}
      />
      <TopBar
        accountMessage={accountMessage}
        accountPending={accountPending}
        accountSession={accountSession}
        modelAccessMode={settingsState["models.access_mode"]}
        onLogin={() => {
          void cloudAccountActions.loginWithLocalDevCloudDefaults();
        }}
        onLogout={cloudAccountActions.logoutAndClearOrganizationState}
      />

      <div className="app-shell">
        <ActivityBar activeView={leftRail.leftRailView} onSelectView={leftRail.setLeftRailView} />
        <LeftPane
          accountSession={accountSession}
          collectionItems={collection.collectionItems}
          documentMetadataSyncMessage={documentMetadataSyncMessage}
          documentMetadataSyncResult={documentMetadataSyncResult ?? null}
          documentMetadataSyncStatus={documentMetadataSyncStatus}
          governanceMessage={organizationGovernanceMessage}
          governanceStatus={organizationGovernanceStatus}
          governanceSummary={organizationGovernanceSummary}
          importJobs={importJobsByDocumentId}
          lastSyncedAt={lastSyncedAt}
          latestExecutionLabel={lastModelExecution ? formatModelExecutionLabel(lastModelExecution) : undefined}
          leftRailView={leftRail.leftRailView}
          list={organizationList}
          listMessage={organizationListMessage}
          listStatus={organizationListStatus}
          onAddExternalPaper={workspaceActions.addExternalPaperToLibrary}
          onClearProfile={profileActions.openClearProfileConfirm}
          onCollectRecommendation={collection.collectRecommendation}
          onCreateOrganization={organizationActions.openCreateDialog}
          onImportSelectedSet={() => {
            void registeredWorkspaceActions.handleImportSelectedSet();
          }}
          onInviteMember={organizationActions.openInviteDialog}
          onJoinOrganization={organizationActions.openJoinDialog}
          onLeaveOrganization={organizationActions.openLeaveDialog}
          onMarkNotificationsRead={organizationNotifications.markOrganizationNotificationsRead}
          onOpenAcademicArchive={profileActions.openAcademicArchive}
          onOpenOrganizationDialog={organizationUi.openOrganizationDialog}
          onOpenSharedLibrary={(summary) => {
            void organizationWorkspace.openOrganizationSharedLibrary(summary);
          }}
          onReturnToLocalWorkspace={organizationWorkspace.openLocalLibraryWorkspace}
          onSelectOrganization={organizationUi.selectOrganization}
          onSetAccessMode={modelSettings.setModelAccessMode}
          onSyncCloudPolicy={() => {
            void syncCloudPolicy();
          }}
          onToggleLocalDirectEnabled={modelSettings.setLocalDirectEnabled}
          onToggleLock={workspaceActions.toggleSelectionLock}
          onToggleProfileSampling={profileActions.toggleProfileSampling}
          onToggleSelection={workspaceActions.toggleSelection}
          organizationSummary={organizationSummary}
          organizationSummaryMessage={organizationSummaryMessage}
          organizationSummaryStatus={organizationSummaryStatus}
          papers={workspaceState.papers}
          policySyncMessage={policySyncMessage}
          policySyncPending={policySyncPending}
          policySyncStatus={policySyncStatus}
          policyVersion={policyVersion}
          profileClearMessage={profileActions.profileClearMessage}
          profileReadPaperCount={workspaceState.papers.length}
          profileSamplingEnabled={profileActions.profileSamplingEnabled}
          recommendationItems={recommendationItems}
          recommendationMessage={recommendationMessage}
          recommendationPending={recommendationPending}
          recommendationStatus={recommendationStatus}
          readNotificationIds={organizationNotifications.readNotificationIds}
          selectedPaperIds={workspaceState.selectedPaperIds}
          selectionLocked={workspaceState.selectionLocked}
          settings={settingsState}
          summary={organizationSummary}
          workspaceLabel={workspaceLabel}
        />
        <main className="pane center">
          <div className="pane-header">Reader</div>
          <div className="pane-body">
            <ArtifactTabs
              analysisHint={analysisHint}
              canStartAnalysis={
                workspaceState.selectedPaperIds.length > 0 && workspaceState.selectionLocked
              }
              onStartAnalysis={(artifactType) => {
                void registeredWorkspaceActions.handleDirectAnalysis(artifactType);
              }}
              selectedCount={workspaceState.selectedPaperIds.length}
              selectionLocked={workspaceState.selectionLocked}
              tabs={artifactTabs}
              tasks={artifactTasks}
            />
          </div>
        </main>
        <section aria-label="右栏AI助手" className="pane right assistant-only-pane">
          <div className="pane-header">AI Assistant</div>
          <div className="pane-body">
            <AssistantPane
              importedChunksByPaperId={importedChunksByPaperId}
              onGenerateArtifact={artifactActions.handleAssistantArtifact}
              onModelExecution={setLastModelExecution}
              onOpenOrganizationSharedLibrary={organizationWorkspace.openOrganizationSharedLibrary}
              onSettingsChanged={(nextSettings) => setSettingsState(cloneSettingsState(nextSettings))}
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
        </section>
      </div>
    </div>
  );
}
