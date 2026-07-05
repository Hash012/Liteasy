import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useWorkspaceActions } from "../features/workspace/useWorkspaceActions";
import { useRegisteredWorkspaceActions } from "../features/workspace/useRegisteredWorkspaceActions";
import type { ImportJob } from "../features/import/import.types";
import { cloneSettingsState } from "../features/settings/settingsStateHelpers";
import type { SettingsState } from "../features/settings/settings.types";
import { useProfileActions } from "../features/profile/useProfileActions";
import type { ControlPlaneTransport } from "../features/models/controlPlaneClient";
import { usePolicySync } from "../features/models/usePolicySync";
import { useModelSettingsActions } from "../features/models/useModelSettingsActions";
import { ArtifactTabs } from "../features/artifacts/ArtifactTabs";
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
import type { LocalLibrarySnapshot } from "../features/library/localLibrary.types";
import { useWorkspaceSelectionController } from "../controllers/useWorkspaceSelectionController";
import { useCloudAccountController } from "../controllers/useCloudAccountController";
import { useArtifactWorkflowController } from "../controllers/useArtifactWorkflowController";
import { useKnowledgeSyncController } from "../controllers/useKnowledgeSyncController";
import { useOrganizationShellController } from "../controllers/useOrganizationShellController";
import { DockRegion } from "../features/dock/DockRegion";
import { useDockLayout } from "../features/dock/useDockLayout";
import type { DockItemId, DockRegionId } from "../features/dock/dock.types";
import { DockLayoutControls } from "./DockLayoutControls";

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
  const paneLayout = usePaneLayout();
  const dock = useDockLayout();
  const { isOnline } = useConnectivity();

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
    "先勾选并锁定文献形成选中文献集，再用中栏模态按钮启动分析。"
  );
  const modelSettings = useModelSettingsActions({
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

  const workspaceActions = useWorkspaceActions({
    importDocument: (sourcePath) => invoke("mock_import", { sourcePath }),
    importStore: importStoreRef.current,
    onAnalysisHint: setAnalysisHint,
    onImportJobsChanged: setImportJobsByDocumentId,
    onWorkspaceChanged: setWorkspaceState,
    workspaceStore: workspaceStoreRef.current
  });

  const artifactWorkflow = useArtifactWorkflowController({
    artifactStore,
    getImportedChunksByPaperId: workspaceActions.getImportedChunksByPaperId,
    getSelectedDocumentSet: () => workspaceStoreRef.current.getSelectedDocumentSet(),
    getSelectedPapers: workspaceActions.getSelectedPapers,
    onAnalysisHint: setAnalysisHint,
    queueImportForPapers: workspaceActions.queueImportForPapers
  });
  const { artifactTabs, artifactTasks } = artifactWorkflow.model;

  const registeredWorkspaceActions = useRegisteredWorkspaceActions({
    importSelectedSet: workspaceActions.importSelectedSet,
    onAnalysisHint: setAnalysisHint,
    startArtifactAnalysis: artifactWorkflow.actions.startAnalysis
  });

  usePolicySync({
    applyModelPolicySnapshot: modelSettings.applyModelPolicySnapshot,
    controlPlaneTransport,
    getSettings: () => settingsStoreRef.current.getState()
  });
  const cloudAccount = useCloudAccountController({
    accountTransport,
    getSettings: () => settingsStoreRef.current.getState(),
    applyLocalDevCloudDefaults: modelSettings.applyLocalDevCloudDefaults,
    isOnline
  });
  const {
    accountSession,
    loginDialogOpen
  } = cloudAccount.model;
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
  const importedChunksByPaperId = workspaceActions.getImportedChunksByPaperId();
  const importedSelectedCount = workspaceActions.getImportedSelectedCount();
  const knowledgeSync = useKnowledgeSyncController({
    accountSession,
    controlPlaneEndpoint: settingsState["models.control_plane_endpoint"],
    documentMetadataTransport,
    documents: workspaceState.papers,
    recommendationTransport,
    recommendationsEnabled: settingsState["network.recommendation.enabled"],
    recommendationSortMode: settingsState["network.recommendation.sort_mode"],
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
  const readerArtifactRowSize = paneLayout.collapsed.bottom ? "0px" : "minmax(220px, 0.65fr)";
  const bottomPaneSize = paneLayout.collapsed.bottom
    ? "0px"
    : `minmax(180px, ${paneLayout.layout.bottom}fr)`;
  const bottomPaneUtilitySize = paneLayout.collapsed.bottom ? "0px" : "12px";
  const topPaneSize = paneLayout.collapsed.bottom
    ? "minmax(0, 1fr)"
    : `minmax(0, ${100 - paneLayout.layout.bottom}fr)`;
  const leftPaneProps: Omit<LeftPaneProps, "leftRailView"> = {
    academicProfile: profileActions.academicProfile,
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
    list: organizationList,
    listMessage: organizationListMessage,
    listStatus: organizationListStatus,
    onAddDroppedPdfFiles: workspaceActions.addDroppedPdfFiles,
    onAddExternalPaper: workspaceActions.addExternalPaperToLibrary,
    onClearProfile: profileActions.openClearProfileConfirm,
    onClearRecommendations: knowledgeSync.actions.clearRecommendationCache,
    onCollectRecommendation: knowledgeSync.actions.collectRecommendation,
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
    onOpenSharedLibrary: (summary) => {
      void organizationShell.actions.openOrganizationSharedLibrary(summary);
    },
    onRetryCollectionSync: knowledgeSync.actions.retryCollectionSync,
    onRetryDocumentMetadataSync: knowledgeSync.actions.retryDocumentMetadataSync,
    onReturnToLocalWorkspace: organizationShell.actions.openLocalLibraryWorkspace,
    onSelectOrganization: organizationShell.actions.selectOrganization,
    onToggleLock: workspaceActions.toggleSelectionLock,
    onToggleProfileSampling: profileActions.toggleProfileSampling,
    onToggleSelection: workspaceActions.toggleSelection,
    onUpdateAcademicProfile: profileActions.updateAcademicProfile,
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
    if (targetRegionId !== "main") {
      paneLayout.setCollapsed(targetRegionId, false);
    }
  }

  function renderDockItem(itemId: DockItemId) {
    if (isLeftRailDockItem(itemId)) {
      return <LeftPane {...leftPaneProps} leftRailView={itemId} />;
    }

    if (itemId === "reader") {
      return (
        <ReaderPane
          analysisHint={analysisHint}
          artifactTabs={artifactTabs}
          artifactTasks={artifactTasks}
          layoutCollapsed={paneLayout.collapsed}
          onStartAnalysis={(artifactType) => {
            void registeredWorkspaceActions.handleDirectAnalysis(artifactType);
          }}
          onToggleBottomPane={() =>
            paneLayout.setCollapsed("bottom", !paneLayout.collapsed.bottom)
          }
          onToggleLeftPane={() =>
            paneLayout.setCollapsed("left", !paneLayout.collapsed.left)
          }
          onToggleRightPane={() =>
            paneLayout.setCollapsed("right", !paneLayout.collapsed.right)
          }
          selectedPapers={selectedPapers}
          selectedPaperIds={workspaceState.selectedPaperIds}
          selectionLocked={workspaceState.selectionLocked}
          showArtifactRegion={false}
        />
      );
    }

    if (itemId === "assistant") {
      return (
        <AssistantSidebar
          importedChunksByPaperId={importedChunksByPaperId}
          importedSelectedCount={importedSelectedCount}
          onGenerateArtifact={(artifactType) => {
            const message = artifactWorkflow.actions.handleAssistantArtifact(artifactType);
            const artifactRegionId = dock.findItemRegion("artifacts") ?? "bottom";
            dock.openItem("artifacts");
            if (artifactRegionId !== "main") {
              paneLayout.setCollapsed(artifactRegionId, false);
            }
            return message;
          }}
          onOpenOrganizationSharedLibrary={
            organizationShell.actions.openOrganizationSharedLibrary
          }
          onSettingsChanged={(nextSettings) =>
            setSettingsState(cloneSettingsState(nextSettings))
          }
          profileUnlocked={accountSession !== null}
          selectedPaperCount={workspaceState.selectedPaperIds.length}
          selectedPapers={selectedPapers}
          selectionLocked={workspaceState.selectionLocked}
          settingsStore={settingsStoreRef.current}
        />
      );
    }

    return (
      <section aria-label="多模态产物区域" className="dock-artifact-surface">
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
      </section>
    );
  }

  function renderDockRegion(regionId: DockRegionId) {
    const showDetachedLayoutControls =
      regionId === "main" && dock.layout.regions.main.activeItemId !== "reader";
    return (
      <DockRegion
        layout={dock.layout.regions[regionId]}
        onActivateItem={(itemId) => activateDockItem(regionId, itemId)}
        onMoveItem={moveDockItem}
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

  return (
    <div className="app-frame">
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
          } as React.CSSProperties
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
          readPaperCount={workspaceState.papers.length}
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
          {!paneLayout.collapsed.bottom ? (
            <PaneResizer
              ariaLabel="调整下栏高度"
              axis="vertical"
              onResize={(deltaPixels) => {
                paneLayout.adjustBottom((-deltaPixels / window.innerHeight) * 100);
              }}
            />
          ) : null}
        </div>
        {!paneLayout.collapsed.bottom ? renderDockRegion("bottom") : null}
      </div>
    </div>
  );
}
