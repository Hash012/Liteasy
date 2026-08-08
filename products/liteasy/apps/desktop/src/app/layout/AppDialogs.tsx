import type { AccountSession } from "../features/account/account.types";
import type {
  AccountLoginInput,
  AccountRegistrationInput
} from "../features/account/accountSessionClient";
import { LightweightLoginDialog } from "../features/account/LightweightLoginDialog";
import { OrganizationEntryDialog } from "../features/organization/OrganizationEntryDialog";
import { OrganizationCreateDialog } from "../features/organization/OrganizationCreateDialog";
import { OrganizationInviteConfirmDialog } from "../features/organization/OrganizationInviteConfirmDialog";
import { OrganizationJoinDialog } from "../features/organization/OrganizationJoinDialog";
import { OrganizationLeaveConfirmDialog } from "../features/organization/OrganizationLeaveConfirmDialog";
import type { OrganizationList, OrganizationSummary } from "../features/organization/organization.types";
import type { OrganizationRole } from "../features/organization/organization.types";
import { AcademicArchiveDialog } from "../features/profile/AcademicArchiveDialog";
import { ClearProfileConfirmDialog } from "../features/profile/ClearProfileConfirmDialog";
import type { AcademicProfile } from "../features/profile/profile.types";

export type AppDialogsProps = {
  academicProfile: AcademicProfile;
  accountSession: AccountSession | null;
  accountMessage?: string;
  accountPending?: boolean;
  controlPlaneEndpoint?: string;
  academicArchiveOpen: boolean;
  clearProfileConfirmOpen: boolean;
  createOrganizationOpen: boolean;
  inviteSummary: OrganizationSummary | null;
  joinOrganizationOpen: boolean;
  leaveSummary: OrganizationSummary | null;
  list: OrganizationList | null;
  listMessage: string;
  organizationActionMessage?: string;
  organizationActionPending?: boolean;
  loginDialogOpen?: boolean;
  onCancelClearProfile: () => void;
  onClearProfile: () => void;
  onCloseAcademicArchive: () => void;
  onCloseCreateOrganization: () => void;
  onCloseInviteMember: () => void;
  onCloseJoinOrganization: () => void;
  onCloseLeaveOrganization: () => void;
  onSkipLogin?: () => void;
  onSubmitAccountLogin?: (login: AccountLoginInput) => void;
  onSubmitAccountRegistration?: (registration: AccountRegistrationInput) => void;
  onSubmitSystemBrowserLogin?: () => void;
  onToggleSuppressLoginReminder?: (checked: boolean) => void;
  onCloseOrganizationDialog: () => void;
  onCreateOrganization: (organizationName: string) => void;
  onInviteMember: (input: {
    role: Extract<OrganizationRole, "admin" | "member">;
    targetSubject: string;
  }) => void;
  onJoinOrganization: (invitationToken: string) => void;
  onLeaveOrganization: () => void;
  onExportProfile: () => void;
  onOpenSharedLibrary: (summary: OrganizationSummary) => void;
  onSelectOrganization: (organizationId: string) => void;
  organizationDialogOpen: boolean;
  summary: OrganizationSummary | null;
};

export function AppDialogs({
  academicProfile,
  accountMessage,
  accountPending,
  accountSession,
  controlPlaneEndpoint = "",
  academicArchiveOpen,
  clearProfileConfirmOpen,
  createOrganizationOpen,
  inviteSummary,
  joinOrganizationOpen,
  leaveSummary,
  list,
  listMessage,
  organizationActionMessage,
  organizationActionPending,
  loginDialogOpen = false,
  onCancelClearProfile,
  onClearProfile,
  onCloseAcademicArchive,
  onCloseCreateOrganization,
  onCloseInviteMember,
  onCloseJoinOrganization,
  onCloseLeaveOrganization,
  onSkipLogin,
  onSubmitAccountLogin,
  onSubmitAccountRegistration,
  onSubmitSystemBrowserLogin,
  onToggleSuppressLoginReminder,
  onCloseOrganizationDialog,
  onCreateOrganization,
  onInviteMember,
  onJoinOrganization,
  onLeaveOrganization,
  onExportProfile,
  onOpenSharedLibrary,
  onSelectOrganization,
  organizationDialogOpen,
  summary
}: AppDialogsProps) {
  return (
    <div className="workspace-dialog-layer" data-testid="workspace-dialog-layer">
      {loginDialogOpen ? (
        <LightweightLoginDialog
          accountMessage={accountMessage}
          accountPending={accountPending}
          controlPlaneEndpoint={controlPlaneEndpoint}
          onSkip={onSkipLogin ?? (() => undefined)}
          onSubmitAccountLogin={onSubmitAccountLogin ?? (() => undefined)}
          onSubmitAccountRegistration={onSubmitAccountRegistration ?? (() => undefined)}
          onSubmitSystemBrowserLogin={onSubmitSystemBrowserLogin ?? (() => undefined)}
          onToggleSuppressReminder={onToggleSuppressLoginReminder ?? (() => undefined)}
        />
      ) : null}
      {clearProfileConfirmOpen ? (
        <ClearProfileConfirmDialog onCancel={onCancelClearProfile} onConfirm={onClearProfile} />
      ) : null}
      {academicArchiveOpen ? (
        <AcademicArchiveDialog
          academicProfile={academicProfile}
          accountSession={accountSession}
          onClose={onCloseAcademicArchive}
          onExport={onExportProfile}
        />
      ) : null}
      {createOrganizationOpen ? (
        <OrganizationCreateDialog
          message={organizationActionMessage}
          onCancel={onCloseCreateOrganization}
          onConfirm={onCreateOrganization}
          pending={organizationActionPending}
        />
      ) : null}
      {joinOrganizationOpen ? (
        <OrganizationJoinDialog
          message={organizationActionMessage}
          onCancel={onCloseJoinOrganization}
          onConfirm={onJoinOrganization}
          pending={organizationActionPending}
        />
      ) : null}
      {inviteSummary ? (
        <OrganizationInviteConfirmDialog
          onCancel={onCloseInviteMember}
          onConfirm={onInviteMember}
          message={organizationActionMessage}
          pending={organizationActionPending}
          summary={inviteSummary}
        />
      ) : null}
      {leaveSummary ? (
        <OrganizationLeaveConfirmDialog
          onCancel={onCloseLeaveOrganization}
          onConfirm={onLeaveOrganization}
          message={organizationActionMessage}
          pending={organizationActionPending}
          summary={leaveSummary}
        />
      ) : null}
      {organizationDialogOpen ? (
        <OrganizationEntryDialog
          list={list}
          listMessage={listMessage}
          onClose={onCloseOrganizationDialog}
          onOpenSharedLibrary={onOpenSharedLibrary}
          onSelectOrganization={onSelectOrganization}
          summary={summary}
        />
      ) : null}
    </div>
  );
}
