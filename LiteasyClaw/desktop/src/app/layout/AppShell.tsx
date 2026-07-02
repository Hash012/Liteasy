import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useWorkspaceActions } from "../features/workspace/useWorkspaceActions";
import { useRegisteredWorkspaceActions } from "../features/workspace/useRegisteredWorkspaceActions";
import type { ImportJob } from "../features/import/import.types";
import { cloneSettingsState } from "../features/settings/settingsStateHelpers";
import type { SettingsState } from "../features/settings/settings.types";
import { useProfileActions } from "../features/profile/useProfileActions";
import type { ControlPlaneTransport } from "../features/models/controlPlaneClient";
import { usePolicySync } from "../features/models/usePolicySync";
import { useModelSettingsActions } from "../features/models/useModelSettingsActions";
import type { DevCloudEnvLike } from "../features/models/localDevCloudEndpoint";
import type { AccountTransport } from "../features/account/accountSessionClient";
import type { RecommendationTransport } from "../features/recommendations/recommendationClient";
import type { DocumentMetadataTransport } from "../features/metadata/documentMetadataClient";
import { useLeftRailNavigation } from "./useLeftRailNavigation";
import type { OrganizationGovernanceTransport } from "../features/organization/organizationGovernanceClient";
import type { OrganizationListTransport } from "../features/organization/organizationListClient";
import type { OrganizationSummaryTransport } from "../features/organization/organizationSummaryClient";
import type { OrganizationSharedLibraryManifestTransport } from "../features/organization/organizationSharedLibraryManifestClient";
import { ActivityBar } from "./ActivityBar";
import { LeftPane } from "./LeftPane";
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
import type { ActionContext } from "../features/skills/actionRegistry";

type AppShellProps = {
  accountTransport?: AccountTransport;
  controlPlaneTransport?: ControlPlaneTransport;
  documentMetadataTransport?: DocumentMetadataTransport;
  initialSettings?: Partial<SettingsState>;
  localDevCloudEnv?: DevCloudEnvLike;
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
  localDevCloudEnv,
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
  const { isOnline } = useConnectivity();
  const [runtimeTheme, setRuntimeTheme] = useState<"default" | "playful">("default");

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
    localDevCloudEnv,
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
    onLeftRailView: leftRail.setLeftRailView,
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
  const applyRuntimeLayoutPreset: ActionContext["applyLayoutPreset"] = (input) => {
    if (input.preset === "two_column") {
      paneLayout.setCollapsed("left", true);
      return "已切换为双栏布局。";
    }

    paneLayout.resetLayout();
    return "已恢复默认布局。";
  };
  const applyRuntimeThemePreset: ActionContext["applyThemePreset"] = (input) => {
    if (input.preset === "playful" || input.tone === "cartoon") {
      setRuntimeTheme("playful");
      return "已应用卡通风格。";
    }

    setRuntimeTheme("default");
    return "已恢复默认风格。";
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
      return `已${actionLabel}${paneLabel}。`;
    }

    leftRail.setLeftRailView(input.panel);
    paneLayout.setCollapsed("left", false);

    if (input.panel === "settings") {
      return "已打开设置面板。";
    }

    if (input.panel === "organization") {
      return "已打开组织面板。";
    }

    if (input.panel === "profile") {
      return "已打开个人中心。";
    }

    return "已打开文献库面板。";
  };
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

  return (
    <div className={`app-frame${runtimeTheme === "playful" ? " theme-playful" : ""}`}>
      <div
        className="app-shell"
        data-testid="workbench-layout"
        style={
          {
            "--left-pane-size": leftPaneSize,
            "--left-pane-utility-size": leftPaneUtilitySize,
            "--reader-artifact-row-size": readerArtifactRowSize,
            "--right-pane-utility-size": rightPaneUtilitySize,
            "--right-pane-size": rightPaneSize
          } as React.CSSProperties
        }
      >
        <ActivityBar
          activeView={leftRail.leftRailView}
          accountSessionAvailable={accountSession !== null}
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
            collectionItems={collectionItems}
            collectionMessage={collectionMessage}
            collectionStatus={collectionStatus}
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
            onAddDroppedPdfFiles={workspaceActions.addDroppedPdfFiles}
            onClearProfile={profileActions.openClearProfileConfirm}
            onClearRecommendations={knowledgeSync.actions.clearRecommendationCache}
            onCollectRecommendation={knowledgeSync.actions.collectRecommendation}
            onRetryCollectionSync={knowledgeSync.actions.retryCollectionSync}
            onCreateOrganization={organizationShell.actions.openCreateDialog}
            onImportSelectedSet={() => {
              void registeredWorkspaceActions.handleImportSelectedSet();
            }}
            onInviteMember={organizationShell.actions.openInviteDialog}
            onJoinOrganization={organizationShell.actions.openJoinDialog}
            onLoginRequired={cloudAccount.actions.openLoginDialog}
            onLeaveOrganization={organizationShell.actions.openLeaveDialog}
            onLogout={logoutAndClearOrganizationState}
            onMarkNotificationsRead={organizationShell.actions.markOrganizationNotificationsRead}
            onOpenAcademicArchive={profileActions.openAcademicArchive}
            onOpenOrganizationDialog={organizationShell.actions.openOrganizationDialog}
            organizationActionMessage={organizationActionMessage}
            onOpenSharedLibrary={(summary) => {
              void organizationShell.actions.openOrganizationSharedLibrary(summary);
            }}
            onReturnToLocalWorkspace={organizationShell.actions.openLocalLibraryWorkspace}
            onRetryDocumentMetadataSync={knowledgeSync.actions.retryDocumentMetadataSync}
            onSelectOrganization={organizationShell.actions.selectOrganization}
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
            readNotificationIds={readNotificationIds}
            selectedPaperIds={workspaceState.selectedPaperIds}
            selectionLocked={workspaceState.selectionLocked}
            settings={settingsState}
            summary={organizationSummary}
            workspaceLabel={workspaceLabel}
            workspaceSourceType={workspaceState.workspaceSource.type}
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
        <ReaderPane
          analysisHint={analysisHint}
          artifactTabs={artifactTabs}
          artifactTasks={artifactTasks}
          layoutCollapsed={paneLayout.collapsed}
          onStartAnalysis={(artifactType) => {
            void registeredWorkspaceActions.handleDirectAnalysis(artifactType);
          }}
          onToggleBottomPane={() => paneLayout.setCollapsed("bottom", !paneLayout.collapsed.bottom)}
          onToggleLeftPane={() => paneLayout.setCollapsed("left", !paneLayout.collapsed.left)}
          onToggleRightPane={() => paneLayout.setCollapsed("right", !paneLayout.collapsed.right)}
          selectedPapers={selectedPapers}
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
        </div>
        {!paneLayout.collapsed.right ? (
          <AssistantSidebar
            importedChunksByPaperId={importedChunksByPaperId}
            importedSelectedCount={importedSelectedCount}
            onApplyLayoutPreset={applyRuntimeLayoutPreset}
            onApplyPanelAction={applyRuntimePanelAction}
            onApplyThemePreset={applyRuntimeThemePreset}
            onGenerateArtifact={artifactWorkflow.actions.handleAssistantArtifact}
            onImportSelectedSet={registeredWorkspaceActions.handleImportSelectedSet}
            onOpenOrganizationSharedLibrary={organizationShell.actions.openOrganizationSharedLibrary}
            onSettingsChanged={(nextSettings) => setSettingsState(cloneSettingsState(nextSettings))}
            profileUnlocked={accountSession !== null}
            runtimeOrganizationName={organizationSummary?.name}
            runtimeWorkspace={workspaceState.workspaceSource}
            selectedPaperCount={workspaceState.selectedPaperIds.length}
            selectedPapers={selectedPapers}
            selectionLocked={workspaceState.selectionLocked}
            settingsStore={settingsStoreRef.current}
          />
        ) : null}
      </div>
    </div>
  );
}
