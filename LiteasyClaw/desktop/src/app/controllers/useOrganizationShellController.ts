import type { MutableRefObject } from "react";
import type { AccountSession } from "../features/account/account.types";
import { createOrganizationSharedLibraryManifestClient } from "../features/organization/organizationSharedLibraryManifestClient";
import type { OrganizationGovernanceTransport } from "../features/organization/organizationGovernanceClient";
import type { OrganizationListTransport } from "../features/organization/organizationListClient";
import type { OrganizationSharedLibraryManifestTransport } from "../features/organization/organizationSharedLibraryManifestClient";
import type { OrganizationSummaryTransport } from "../features/organization/organizationSummaryClient";
import { useOrganizationActions } from "../features/organization/useOrganizationActions";
import { useOrganizationData } from "../features/organization/useOrganizationData";
import { useOrganizationNotifications } from "../features/organization/useOrganizationNotifications";
import { useOrganizationUiState } from "../features/organization/useOrganizationUiState";
import { useOrganizationWorkspace } from "../features/organization/useOrganizationWorkspace";
import type { createWorkspaceStore } from "../features/workspace/workspace.store";
import type { Paper } from "../features/workspace/workspace.types";

type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

type UseOrganizationShellControllerInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
  onAnalysisHint: (message: string) => void;
  onLeftRailView: (view: "library") => void;
  onWorkspaceLabel: (label: string) => void;
  onWorkspaceSync: () => void;
  organizationGovernanceTransport?: OrganizationGovernanceTransport;
  organizationListTransport?: OrganizationListTransport;
  organizationSharedLibraryManifestTransport?: OrganizationSharedLibraryManifestTransport;
  organizationTransport?: OrganizationSummaryTransport;
  starterPapers: Paper[];
  workspaceStoreRef: MutableRefObject<WorkspaceStore>;
};

export function useOrganizationShellController({
  accountSession,
  controlPlaneEndpoint,
  onAnalysisHint,
  onLeftRailView,
  onWorkspaceLabel,
  onWorkspaceSync,
  organizationGovernanceTransport,
  organizationListTransport,
  organizationSharedLibraryManifestTransport,
  organizationTransport,
  starterPapers,
  workspaceStoreRef
}: UseOrganizationShellControllerInput) {
  const organizationUi = useOrganizationUiState();
  const organizationActions = useOrganizationActions({
    canCreateOrganization: (accountSession?.membershipTier ?? "pro") !== "basic",
    onAnalysisHint
  });
  const organizationNotifications = useOrganizationNotifications({ onAnalysisHint });
  const organizationData = useOrganizationData({
    accountSession,
    controlPlaneEndpoint,
    getActiveOrganizationId: organizationUi.getActiveOrganizationId,
    organizationGovernanceTransport,
    organizationListTransport,
    organizationTransport
  });
  const organizationWorkspace = useOrganizationWorkspace({
    controlPlaneEndpoint,
    defaultSummary: organizationData.organizationSummary,
    manifestLoader: async ({ endpoint, organizationId, sessionId }) =>
      createOrganizationSharedLibraryManifestClient({
        endpoint,
        transport: organizationSharedLibraryManifestTransport
      })({
        organizationId,
        sessionId
      }),
    onAnalysisHint,
    onLeftRailView,
    onWorkspaceLabel,
    onWorkspaceSync,
    sessionId: accountSession?.sessionId,
    starterPapers,
    workspaceStoreRef
  });

  function resetOrganizationState() {
    organizationNotifications.clearOrganizationNotifications();
    organizationActions.resetOrganizationActions();
    organizationUi.resetOrganizationSelection();
  }

  return {
    actions: {
      closeCreateDialog: organizationActions.closeCreateDialog,
      closeInviteDialog: organizationActions.closeInviteDialog,
      closeJoinOrganizationDialog: organizationActions.closeJoinDialog,
      closeLeaveDialog: organizationActions.closeLeaveDialog,
      closeOrganizationDialog: organizationUi.closeOrganizationDialog,
      createDemoOrganizationJoinRequest: organizationActions.createDemoOrganizationJoinRequest,
      createDemoOrganizationLeaveRequest: organizationActions.createDemoOrganizationLeaveRequest,
      createDemoOrganizationRequest: organizationActions.createDemoOrganizationRequest,
      markOrganizationNotificationsRead: organizationNotifications.markOrganizationNotificationsRead,
      openCreateDialog: organizationActions.openCreateDialog,
      openInviteDialog: organizationActions.openInviteDialog,
      openJoinDialog: organizationActions.openJoinDialog,
      openLocalLibraryWorkspace: organizationWorkspace.openLocalLibraryWorkspace,
      openOrganizationDialog: organizationUi.openOrganizationDialog,
      openOrganizationSharedLibrary: organizationWorkspace.openOrganizationSharedLibrary,
      openLeaveDialog: organizationActions.openLeaveDialog,
      resetOrganizationState,
      selectOrganization: organizationUi.selectOrganization,
      sendDemoOrganizationInvite: organizationActions.sendDemoOrganizationInvite
    },
    model: {
      actionMessage: organizationActions.actionMessage,
      createOpen: organizationActions.createOpen,
      inviteSummary: organizationActions.inviteSummary,
      joinOpen: organizationActions.joinOpen,
      leaveSummary: organizationActions.leaveSummary,
      organizationDialogOpen: organizationUi.organizationDialogOpen,
      organizationGovernanceMessage: organizationData.organizationGovernanceMessage,
      organizationGovernanceStatus: organizationData.organizationGovernanceStatus,
      organizationGovernanceSummary: organizationData.organizationGovernanceSummary,
      organizationList: organizationData.organizationList,
      organizationListMessage: organizationData.organizationListMessage,
      organizationListStatus: organizationData.organizationListStatus,
      organizationSummary: organizationData.organizationSummary,
      organizationSummaryMessage: organizationData.organizationSummaryMessage,
      organizationSummaryStatus: organizationData.organizationSummaryStatus,
      readNotificationIds: organizationNotifications.readNotificationIds
    }
  };
}
