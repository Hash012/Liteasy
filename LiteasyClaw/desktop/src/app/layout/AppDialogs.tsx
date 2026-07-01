import type { AccountSession } from "../features/account/account.types";
import type { AccountRegistrationInput } from "../features/account/accountSessionClient";
import { LightweightLoginDialog } from "../features/account/LightweightLoginDialog";
import { OrganizationEntryDialog } from "../features/organization/OrganizationEntryDialog";
import { OrganizationCreateDialog } from "../features/organization/OrganizationCreateDialog";
import { OrganizationInviteConfirmDialog } from "../features/organization/OrganizationInviteConfirmDialog";
import { OrganizationJoinDialog } from "../features/organization/OrganizationJoinDialog";
import { OrganizationLeaveConfirmDialog } from "../features/organization/OrganizationLeaveConfirmDialog";
import type { OrganizationList, OrganizationSummary } from "../features/organization/organization.types";
import { AcademicArchiveDialog } from "../features/profile/AcademicArchiveDialog";
import { ClearProfileConfirmDialog } from "../features/profile/ClearProfileConfirmDialog";
import type { AcademicProfile } from "../features/profile/profile.types";

export type AppDialogsProps = {
  academicProfile: AcademicProfile;
  accountSession: AccountSession | null;
  academicArchiveOpen: boolean;
  clearProfileConfirmOpen: boolean;
  createOrganizationOpen: boolean;
  inviteSummary: OrganizationSummary | null;
  joinOrganizationOpen: boolean;
  leaveSummary: OrganizationSummary | null;
  list: OrganizationList | null;
  listMessage: string;
  loginDialogOpen?: boolean;
  onCancelClearProfile: () => void;
  onClearProfile: () => void;
  onCloseAcademicArchive: () => void;
  onCloseCreateOrganization: () => void;
  onCloseInviteMember: () => void;
  onCloseJoinOrganization: () => void;
  onCloseLeaveOrganization: () => void;
  onSkipLogin?: () => void;
  onSubmitAccountRegistration?: (registration: AccountRegistrationInput) => void;
  onSubmitDemoLogin?: () => void;
  onToggleSuppressLoginReminder?: (checked: boolean) => void;
  onCloseOrganizationDialog: () => void;
  onCreateOrganization: (organizationName: string) => void;
  onInviteMember: () => void;
  onJoinOrganization: (inviteCode: string) => void;
  onLeaveOrganization: () => void;
  onOpenSharedLibrary: (summary: OrganizationSummary) => void;
  onSelectOrganization: (organizationId: string) => void;
  organizationDialogOpen: boolean;
  readPaperCount: number;
  summary: OrganizationSummary | null;
};

export function AppDialogs({
  academicProfile,
  accountSession,
  academicArchiveOpen,
  clearProfileConfirmOpen,
  createOrganizationOpen,
  inviteSummary,
  joinOrganizationOpen,
  leaveSummary,
  list,
  listMessage,
  loginDialogOpen = false,
  onCancelClearProfile,
  onClearProfile,
  onCloseAcademicArchive,
  onCloseCreateOrganization,
  onCloseInviteMember,
  onCloseJoinOrganization,
  onCloseLeaveOrganization,
  onSkipLogin,
  onSubmitAccountRegistration,
  onSubmitDemoLogin,
  onToggleSuppressLoginReminder,
  onCloseOrganizationDialog,
  onCreateOrganization,
  onInviteMember,
  onJoinOrganization,
  onLeaveOrganization,
  onOpenSharedLibrary,
  onSelectOrganization,
  organizationDialogOpen,
  readPaperCount,
  summary
}: AppDialogsProps) {
  return (
    <div className="workspace-dialog-layer" data-testid="workspace-dialog-layer">
      {loginDialogOpen ? (
        <LightweightLoginDialog
          onSkip={onSkipLogin ?? (() => undefined)}
          onSubmitAccountRegistration={onSubmitAccountRegistration ?? (() => undefined)}
          onSubmitDemoLogin={onSubmitDemoLogin ?? (() => undefined)}
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
          readPaperCount={readPaperCount}
        />
      ) : null}
      {createOrganizationOpen ? (
        <OrganizationCreateDialog
          onCancel={onCloseCreateOrganization}
          onConfirm={onCreateOrganization}
        />
      ) : null}
      {joinOrganizationOpen ? (
        <OrganizationJoinDialog onCancel={onCloseJoinOrganization} onConfirm={onJoinOrganization} />
      ) : null}
      {inviteSummary ? (
        <OrganizationInviteConfirmDialog
          onCancel={onCloseInviteMember}
          onConfirm={onInviteMember}
          summary={inviteSummary}
        />
      ) : null}
      {leaveSummary ? (
        <OrganizationLeaveConfirmDialog
          onCancel={onCloseLeaveOrganization}
          onConfirm={onLeaveOrganization}
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
