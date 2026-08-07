import { useState, type MutableRefObject } from "react";
import type { AccountSession } from "../features/account/account.types";
import { createOrganizationSharedLibraryManifestClient } from "../features/organization/organizationSharedLibraryManifestClient";
import type { OrganizationListTransport } from "../features/organization/organizationListClient";
import type { OrganizationSharedLibraryManifestTransport } from "../features/organization/organizationSharedLibraryManifestClient";
import type { OrganizationSummaryTransport } from "../features/organization/organizationSummaryClient";
import type { OrganizationActionTransport } from "../features/organization/organizationActionsClient";
import { useOrganizationActions } from "../features/organization/useOrganizationActions";
import { useOrganizationData } from "../features/organization/useOrganizationData";
import { useOrganizationNotifications } from "../features/organization/useOrganizationNotifications";
import { useOrganizationUiState } from "../features/organization/useOrganizationUiState";
import { useOrganizationWorkspace } from "../features/organization/useOrganizationWorkspace";
import type { createWorkspaceStore } from "../features/workspace/workspace.store";

type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

type UseOrganizationShellControllerInput = {
  accountSession: AccountSession | null;
  controlPlaneEndpoint: string;
  onAnalysisHint: (message: string) => void;
  onLeftRailView: (view: "library") => void;
  onWorkspaceLabel: (label: string) => void;
  onWorkspaceSync: () => void;
  organizationActionTransport?: OrganizationActionTransport;
  organizationListTransport?: OrganizationListTransport;
  organizationSharedLibraryManifestTransport?: OrganizationSharedLibraryManifestTransport;
  organizationTransport?: OrganizationSummaryTransport;
  workspaceStoreRef: MutableRefObject<WorkspaceStore>;
};

export function useOrganizationShellController({
  accountSession,
  controlPlaneEndpoint,
  onAnalysisHint,
  onLeftRailView,
  onWorkspaceLabel,
  onWorkspaceSync,
  organizationActionTransport,
  organizationListTransport,
  organizationSharedLibraryManifestTransport,
  organizationTransport,
  workspaceStoreRef
}: UseOrganizationShellControllerInput) {
  const organizationUi = useOrganizationUiState();
  const [organizationDataRevision, setOrganizationDataRevision] = useState(0);
  const organizationActions = useOrganizationActions({
    accountSession,
    canCreateOrganization: Boolean(accountSession && accountSession.membershipTier !== "basic"),
    controlPlaneEndpoint,
    onAnalysisHint,
    onOrganizationChanged: (organizationId) => {
      if (organizationId) {
        organizationUi.selectOrganization(organizationId);
      } else {
        organizationUi.resetOrganizationSelection();
      }
      setOrganizationDataRevision((current) => current + 1);
    },
    transport: organizationActionTransport
  });
  const organizationNotifications = useOrganizationNotifications({ onAnalysisHint });
  const organizationData = useOrganizationData({
    accountSession,
    controlPlaneEndpoint,
    getActiveOrganizationId: organizationUi.getActiveOrganizationId,
    organizationListTransport,
    organizationTransport,
    refreshRevision: organizationDataRevision
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
      createOrganizationRequest: organizationActions.createOrganizationRequest,
      inviteOrganizationMember: organizationActions.inviteOrganizationMember,
      joinOrganizationRequest: organizationActions.joinOrganizationRequest,
      leaveOrganizationRequest: organizationActions.leaveOrganizationRequest,
      markOrganizationNotificationsRead: organizationNotifications.markOrganizationNotificationsRead,
      openCreateDialog: organizationActions.openCreateDialog,
      openInviteDialog: organizationActions.openInviteDialog,
      openJoinDialog: organizationActions.openJoinDialog,
      openLocalLibraryWorkspace: organizationWorkspace.openLocalLibraryWorkspace,
      openOrganizationDialog: organizationUi.openOrganizationDialog,
      openOrganizationSharedLibrary: organizationWorkspace.openOrganizationSharedLibrary,
      openLeaveDialog: organizationActions.openLeaveDialog,
      refreshOrganizationData: () => setOrganizationDataRevision((current) => current + 1),
      resetOrganizationState,
      selectOrganization: organizationUi.selectOrganization
    },
    model: {
      actionMessage: organizationActions.actionMessage,
      actionPending: organizationActions.actionPending,
      createOpen: organizationActions.createOpen,
      inviteSummary: organizationActions.inviteSummary,
      joinOpen: organizationActions.joinOpen,
      leaveSummary: organizationActions.leaveSummary,
      organizationDialogOpen: organizationUi.organizationDialogOpen,
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
