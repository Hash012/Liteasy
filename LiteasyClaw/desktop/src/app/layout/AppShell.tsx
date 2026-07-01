import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useCollectionItems } from "../features/collection/useCollectionItems";
import { useCloudAccountActions } from "../features/account/useCloudAccountActions";
import { useArtifactActions } from "../features/artifacts/useArtifactActions";
import type { ArtifactTask, ArtifactTab } from "../features/artifacts/artifact.types";
import { useWorkspaceActions } from "../features/workspace/useWorkspaceActions";
import { useRegisteredWorkspaceActions } from "../features/workspace/useRegisteredWorkspaceActions";
import type { ImportJob } from "../features/import/import.types";
import { cloneSettingsState } from "../features/settings/settingsStateHelpers";
import type { SettingsState } from "../features/settings/settings.types";
import { useProfileActions } from "../features/profile/useProfileActions";
import type { ControlPlaneTransport } from "../features/models/controlPlaneClient";
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
import type { OrganizationSharedLibraryManifestTransport } from "../features/organization/organizationSharedLibraryManifestClient";
import { createOrganizationSharedLibraryManifestClient } from "../features/organization/organizationSharedLibraryManifestClient";
import { useOrganizationData } from "../features/organization/useOrganizationData";
import { ActivityBar } from "./ActivityBar";
import { TopBar } from "./TopBar";
import { LeftPane } from "./LeftPane";
import { AppDialogs } from "./AppDialogs";
import { ReaderPane } from "./ReaderPane";
import { AssistantSidebar } from "./AssistantSidebar";
import { cloneWorkspaceState } from "../features/workspace/workspaceStateHelpers";
import { useAppShellStores } from "./useAppShellStores";
import { starterPapers } from "./starterPapers";
import { useConnectivity } from "../features/network/useConnectivity";
import { useCloudAvailabilityProbe } from "../features/network/useCloudAvailabilityProbe";
import { getCloudAvailabilityStatus } from "./cloudAvailability";
import { PaneResizer } from "./PaneResizer";
import { usePaneLayout } from "./usePaneLayout";
import { useLocalLibrary } from "../features/library/useLocalLibrary";
import type { LocalLibrarySnapshot } from "../features/library/localLibrary.types";
import { useWorkspaceSelectionController } from "../controllers/useWorkspaceSelectionController";

type AppShellProps = {
  accountTransport?: AccountTransport;
  controlPlaneTransport?: ControlPlaneTransport;
  documentMetadataTransport?: DocumentMetadataTransport;
  initialSettings?: Partial<SettingsState>;
  organizationGovernanceTransport?: OrganizationGovernanceTransport;
  organizationListTransport?: OrganizationListTransport;
  organizationSharedLibraryManifestTransport?: OrganizationSharedLibraryManifestTransport;
  organizationTransport?: OrganizationSummaryTransport;
  localLibraryLoader?: () => Promise<LocalLibrarySnapshot>;
  recommendationTransport?: RecommendationTransport;
};

export function AppShell({
  accountTransport,
  controlPlaneTransport,
  documentMetadataTransport,
  initialSettings,
  organizationGovernanceTransport,
  organizationListTransport,
  organizationSharedLibraryManifestTransport,
  organizationTransport,
  localLibraryLoader,
  recommendationTransport
}: AppShellProps = {}) {
  const { artifactStore, importStoreRef, settingsStoreRef, workspaceStoreRef } = useAppShellStores(initialSettings);
  const localLibrarySnapshot = useLocalLibrary(localLibraryLoader);
  const { isOnline } = useConnectivity();
  const paneLayout = usePaneLayout();

  const workspaceSelection = useWorkspaceSelectionController({
    workspaceStore: workspaceStoreRef.current
  });
  const workspaceState = workspaceSelection.model.workspaceState;
  const setWorkspaceState = workspaceSelection.actions.setWorkspaceState;
  const [settingsState, setSettingsState] = useState<SettingsState>(() =>
    cloneSettingsState(settingsStoreRef.current.getState())
  );
  const [importJobsByDocumentId, setImportJobsByDocumentId] = useState<Record<string, ImportJob>>({});
  const [artifactTasks, setArtifactTasks] = useState<ArtifactTask[]>([]);
  const [artifactTabs, setArtifactTabs] = useState<ArtifactTab[]>([]);
  const [analysisHint, setAnalysisHint] = useState(
    "先勾选并锁定文献形成选中文献集，再用中栏模态按钮启动分析。"
  );
  const [loginDialogDismissedThisSession, setLoginDialogDismissedThisSession] = useState(false);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [workspaceLabel, setWorkspaceLabel] = useState("本地文献库");
  const modelSettings = useModelSettingsActions({
    onSettingsChanged: (nextSettings) => setSettingsState(cloneSettingsState(nextSettings)),
    settingsStore: settingsStoreRef.current
  });
  const leftRail = useLeftRailNavigation();
  const profileActions = useProfileActions({
    onProfileSamplingChanged: (enabled) => {
      settingsStoreRef.current.apply({
        intent: "update_setting",
        target: "profile.enabled",
        value: enabled
      });
      setSettingsState(cloneSettingsState(settingsStoreRef.current.getState()));
    },
    profileSamplingEnabled: settingsState["profile.enabled"]
  });
  const organizationUi = useOrganizationUiState();

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

  usePolicySync({
    applyModelPolicySnapshot: modelSettings.applyModelPolicySnapshot,
    controlPlaneTransport,
    getSettings: () => settingsStoreRef.current.getState()
  });
  const {
    accountMessage,
    accountPending,
    accountSession,
    loginToCloudAccount,
    logoutFromCloudAccount,
    setSuppressLoginReminder,
    shouldShowLoginReminder
  } = useAccountSession({
    accountTransport,
    getSettings: () => settingsStoreRef.current.getState(),
    onSessionRestored: modelSettings.applyLocalDevCloudDefaults
  });
  const organizationActions = useOrganizationActions({
    canCreateOrganization: (accountSession?.membershipTier ?? "pro") !== "basic",
    onAnalysisHint: setAnalysisHint
  });
  const organizationNotifications = useOrganizationNotifications({ onAnalysisHint: setAnalysisHint });
  const cloudAccountActions = useCloudAccountActions({
    applyLocalDevCloudDefaults: modelSettings.applyLocalDevCloudDefaults,
    clearOrganizationNotifications: organizationNotifications.clearOrganizationNotifications,
    loginToCloudAccount,
    logoutFromCloudAccount,
    resetOrganizationActions: organizationActions.resetOrganizationActions,
    resetOrganizationSelection: organizationUi.resetOrganizationSelection
  });
  const collection = useCollectionItems({
    accountSession,
    controlPlaneEndpoint: settingsState["models.control_plane_endpoint"]
  });
  const selectedPapers = workspaceActions.getSelectedPapers();
  const importedChunksByPaperId = workspaceActions.getImportedChunksByPaperId();
  const importedSelectedCount = workspaceActions.getImportedSelectedCount();
  const {
    clearRecommendationCache,
    recommendationItems,
    recommendationMessage,
    recommendationPending,
    recommendationStatus
  } = useRecommendations({
    accountSession,
    controlPlaneEndpoint: settingsState["models.control_plane_endpoint"],
    recommendationCacheTransport: recommendationTransport,
    recommendationTransport,
    recommendationsEnabled: settingsState["network.recommendation.enabled"],
    recommendationSortMode: settingsState["network.recommendation.sort_mode"],
    selectedPapers,
    workspaceRevision: workspaceState.workspaceRevision,
    workspaceSourceKey: `${workspaceState.workspaceSource.type}:${workspaceState.workspaceSource.rootPath}`
  });
  const {
    lastResult: documentMetadataSyncResult,
    message: documentMetadataSyncMessage,
    retrySync: retryDocumentMetadataSync,
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
    controlPlaneEndpoint: settingsState["models.control_plane_endpoint"],
    defaultSummary: organizationSummary,
    manifestLoader: async ({ endpoint, organizationId, sessionId }) =>
      createOrganizationSharedLibraryManifestClient({
        endpoint,
        transport: organizationSharedLibraryManifestTransport
      })({
        organizationId,
        sessionId
      }),
    onAnalysisHint: setAnalysisHint,
    onLeftRailView: leftRail.setLeftRailView,
    onWorkspaceLabel: setWorkspaceLabel,
    onWorkspaceSync: workspaceActions.syncWorkspace,
    sessionId: accountSession?.sessionId,
    starterPapers,
    workspaceStoreRef
  });
  const { isCloudReachable } = useCloudAvailabilityProbe({
    enabled: isOnline && accountSession !== null,
    endpoint: settingsState["models.control_plane_endpoint"]
  });
  const cloudAvailabilityStatus = getCloudAvailabilityStatus({
    accountSession,
    isCloudReachable,
    isOnline
  });
  const leftPaneSize = paneLayout.collapsed.left
    ? "0px"
    : `minmax(220px, ${paneLayout.layout.left}fr)`;
  const leftPaneUtilitySize = paneLayout.collapsed.left ? "0px" : "18px";
  const rightPaneSize = paneLayout.collapsed.right
    ? "44px"
    : `minmax(220px, ${paneLayout.layout.right}fr)`;

  useEffect(() => {
    if (!localLibrarySnapshot) {
      return;
    }

    workspaceStoreRef.current.openWorkspace([], {
      rootPath: localLibrarySnapshot.rootPath,
      type: "local_library"
    });
    setWorkspaceState(cloneWorkspaceState(workspaceStoreRef.current.getState()));
    setWorkspaceLabel(localLibrarySnapshot.rootPath);
  }, [localLibrarySnapshot, workspaceStoreRef]);

  useEffect(() => {
    if (
      accountSession === null &&
      accountPending === false &&
      shouldShowLoginReminder &&
      loginDialogDismissedThisSession === false
    ) {
      setLoginDialogOpen(true);
    }
  }, [accountPending, accountSession, loginDialogDismissedThisSession, shouldShowLoginReminder]);

  useEffect(() => {
    if (accountSession !== null) {
      setLoginDialogDismissedThisSession(false);
    }
  }, [accountSession]);

  return (
    <div className="app-frame">
      <TopBar
        accountMessage={accountMessage}
        accountPending={accountPending}
        accountSession={accountSession}
        cloudAvailabilityStatus={cloudAvailabilityStatus}
        onLogin={() => {
          setLoginDialogDismissedThisSession(false);
          setLoginDialogOpen(true);
        }}
        onLogout={cloudAccountActions.logoutAndClearOrganizationState}
      />

      <div
        className="app-shell"
        data-testid="workbench-layout"
        style={
          {
            "--left-pane-size": leftPaneSize,
            "--left-pane-utility-size": leftPaneUtilitySize,
            "--right-pane-size": rightPaneSize
          } as React.CSSProperties
        }
      >
        <ActivityBar
          activeView={leftRail.leftRailView}
          onSelectView={(view) => {
            leftRail.setLeftRailView(view);
            if (paneLayout.collapsed.left) {
              paneLayout.setCollapsed("left", false);
            }
          }}
          onToggleActiveView={() => {
            paneLayout.setCollapsed("left", !paneLayout.collapsed.left);
          }}
        />
        {!paneLayout.collapsed.left ? (
          <LeftPane
            academicProfile={profileActions.academicProfile}
            accountSession={accountSession}
            collectionItems={collection.collectionItems}
            collectionMessage={collection.message}
            collectionStatus={collection.status}
            documentMetadataSyncMessage={documentMetadataSyncMessage}
            documentMetadataSyncResult={documentMetadataSyncResult ?? null}
            documentMetadataSyncStatus={documentMetadataSyncStatus}
            governanceMessage={organizationGovernanceMessage}
            governanceStatus={organizationGovernanceStatus}
            governanceSummary={organizationGovernanceSummary}
            importJobs={importJobsByDocumentId}
            leftRailView={leftRail.leftRailView}
            list={organizationList}
            listMessage={organizationListMessage}
            listStatus={organizationListStatus}
            onAddExternalPaper={workspaceActions.addExternalPaperToLibrary}
            onClearProfile={profileActions.openClearProfileConfirm}
            onClearRecommendations={clearRecommendationCache}
            onCollectRecommendation={collection.collectRecommendation}
            onRetryCollectionSync={collection.retry}
            onCreateOrganization={organizationActions.openCreateDialog}
            onImportSelectedSet={() => {
              void registeredWorkspaceActions.handleImportSelectedSet();
            }}
            onInviteMember={organizationActions.openInviteDialog}
            onJoinOrganization={organizationActions.openJoinDialog}
            onLoginRequired={() => {
              setLoginDialogOpen(true);
            }}
            onLeaveOrganization={organizationActions.openLeaveDialog}
            onMarkNotificationsRead={organizationNotifications.markOrganizationNotificationsRead}
            onOpenAcademicArchive={profileActions.openAcademicArchive}
            onOpenOrganizationDialog={organizationUi.openOrganizationDialog}
            organizationActionMessage={organizationActions.actionMessage}
            onOpenSharedLibrary={(summary) => {
              void organizationWorkspace.openOrganizationSharedLibrary(summary);
            }}
            onReturnToLocalWorkspace={organizationWorkspace.openLocalLibraryWorkspace}
            onRetryDocumentMetadataSync={retryDocumentMetadataSync}
            onSelectOrganization={organizationUi.selectOrganization}
            onToggleLock={workspaceActions.toggleSelectionLock}
            onToggleProfileSampling={profileActions.toggleProfileSampling}
            onToggleSelection={workspaceActions.toggleSelection}
            onUpdateAcademicProfile={profileActions.updateAcademicProfile}
            organizationSummary={organizationSummary}
            organizationSummaryMessage={organizationSummaryMessage}
            organizationSummaryStatus={organizationSummaryStatus}
            papers={workspaceState.papers}
            profileClearMessage={profileActions.profileClearMessage}
            profileReadPaperCount={workspaceState.papers.length}
            profileSamplingEnabled={settingsState["profile.enabled"]}
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
        ) : null}
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
          onSkipLogin={() => {
            setLoginDialogDismissedThisSession(true);
            setLoginDialogOpen(false);
          }}
          onSubmitDemoLogin={() => {
            setLoginDialogDismissedThisSession(true);
            setLoginDialogOpen(false);
            void cloudAccountActions.loginWithLocalDevCloudDefaults();
          }}
          onToggleSuppressLoginReminder={(checked) => {
            setSuppressLoginReminder(checked);
          }}
          onOpenSharedLibrary={(summary) => {
            void organizationWorkspace.openOrganizationSharedLibrary(summary);
          }}
          onSelectOrganization={organizationUi.selectOrganization}
          organizationDialogOpen={organizationUi.organizationDialogOpen}
          loginDialogOpen={loginDialogOpen}
          readPaperCount={workspaceState.papers.length}
          summary={organizationSummary}
        />
        <ReaderPane
          analysisHint={analysisHint}
          artifactTabs={artifactTabs}
          artifactTasks={artifactTasks}
          onStartAnalysis={(artifactType) => {
            void registeredWorkspaceActions.handleDirectAnalysis(artifactType);
          }}
          selectedPaperIds={workspaceState.selectedPaperIds}
          selectionLocked={workspaceState.selectionLocked}
        />
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
          <button
            aria-label={paneLayout.collapsed.right ? "展开右栏" : "右栏折叠控制"}
            className="pane-collapse-button edge-arrow"
            onClick={() => paneLayout.setCollapsed("right", !paneLayout.collapsed.right)}
            title={paneLayout.collapsed.right ? "展开右栏" : "折叠右栏"}
            type="button"
          >
            {paneLayout.collapsed.right ? "‹" : "›"}
          </button>
        </div>
        {!paneLayout.collapsed.right ? (
          <AssistantSidebar
            importedChunksByPaperId={importedChunksByPaperId}
            importedSelectedCount={importedSelectedCount}
            onGenerateArtifact={artifactActions.handleAssistantArtifact}
            onOpenOrganizationSharedLibrary={organizationWorkspace.openOrganizationSharedLibrary}
            onSettingsChanged={(nextSettings) => setSettingsState(cloneSettingsState(nextSettings))}
            profileUnlocked={accountSession !== null}
            selectedPaperCount={workspaceState.selectedPaperIds.length}
            selectedPapers={selectedPapers}
            selectionLocked={workspaceState.selectionLocked}
            settingsStore={settingsStoreRef.current}
          />
        ) : (
          <aside className="pane-rail right" aria-label="右栏折叠边栏" />
        )}
      </div>
    </div>
  );
}
