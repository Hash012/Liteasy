import { LibraryPane } from "../features/library/LibraryPane";
import { OrganizationSidebarPanel } from "../features/organization/OrganizationSidebarPanel";
import { PersonalCenterPanel } from "../features/profile/PersonalCenterPanel";
import { SettingsPane } from "./SettingsPane";
import type { AcademicProfile } from "../features/profile/profile.types";
import type { AccountSession } from "../features/account/account.types";
import type { ImportJob } from "../features/import/import.types";
import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "../features/metadata/metadata.types";
import type { OrganizationGovernanceStatus, OrganizationGovernanceSummary, OrganizationList, OrganizationListStatus, OrganizationSummary, OrganizationSummaryStatus } from "../features/organization/organization.types";
import type { CollectionItem } from "../features/collection/collection.types";
import type { RecommendationItem, RecommendationStatus } from "../features/recommendations/recommendation.types";
import type { Paper } from "../features/workspace/workspace.types";
import type { SettingsState } from "../features/settings/settings.types";
import type { LeftRailView } from "./useLeftRailNavigation";
import type { PolicySyncStatus } from "../features/models/policySync.types";

export type LeftPaneProps = {
  academicProfile: AcademicProfile;
  accountSession: AccountSession | null;
  collectionItems: CollectionItem[];
  documentMetadataSyncMessage?: string;
  documentMetadataSyncResult: DocumentMetadataSyncResult | null;
  documentMetadataSyncStatus: DocumentMetadataSyncStatus;
  governanceMessage: string;
  importJobs: Record<string, ImportJob>;
  governanceStatus: OrganizationGovernanceStatus;
  governanceSummary: OrganizationGovernanceSummary | null;
  lastSyncedAt?: string;
  latestExecutionLabel?: string;
  leftRailView: LeftRailView;
  list: OrganizationList | null;
  listMessage: string;
  organizationActionMessage?: string;
  listStatus: OrganizationListStatus;
  onAddExternalPaper: (item: { id: string; source: string; title: string }) => void;
  onClearProfile: () => void;
  onClearRecommendations: () => void;
  onCollectRecommendation: (item: RecommendationItem) => void;
  onCreateOrganization?: () => void;
  onImportSelectedSet: () => void;
  onInviteMember?: (summary: OrganizationSummary) => void;
  onJoinOrganization?: () => void;
  onLeaveOrganization?: (summary: OrganizationSummary) => void;
  onMarkNotificationsRead?: (summary: OrganizationSummary) => void;
  onOpenAcademicArchive: () => void;
  onOpenOrganizationDialog: () => void;
  onOpenSharedLibrary?: (summary: OrganizationSummary) => void;
  onReturnToLocalWorkspace: () => void;
  onRetryDocumentMetadataSync?: () => void;
  onSelectOrganization?: (organizationId: string) => void;
  onSetAccessMode: (mode: SettingsState["models.access_mode"]) => void;
  onSyncCloudPolicy: () => void;
  onToggleLocalDirectEnabled: (enabled: boolean) => void;
  onUseLocalDevCloudDefaults: () => void;
  onToggleProfileSampling: () => void;
  onUpdateAcademicProfile: (profile: AcademicProfile) => void;
  onToggleSelection: (paperId: string) => void;
  onToggleLock: () => void;
  organizationSummary: OrganizationSummary | null;
  organizationSummaryMessage: string;
  organizationSummaryStatus: OrganizationSummaryStatus;
  papers: Paper[];
  policySyncMessage?: string;
  policySyncPending: boolean;
  policySyncStatus: PolicySyncStatus;
  policyVersion?: string;
  profileClearMessage?: string;
  profileReadPaperCount: number;
  profileSamplingEnabled: boolean;
  recommendationItems: RecommendationItem[];
  recommendationMessage: string;
  recommendationPending: boolean;
  recommendationStatus: RecommendationStatus;
  readNotificationIds: string[];
  selectedPaperIds: string[];
  selectionLocked: boolean;
  settings: SettingsState;
  summary: OrganizationSummary | null;
  workspaceLabel: string;
};

function getPaneHeader(leftRailView: LeftRailView) {
  if (leftRailView === "organization") {
    return "组织";
  }

  if (leftRailView === "profile") {
    return "个人中心";
  }

  if (leftRailView === "settings") {
    return "设置";
  }

  return "文献库";
}

export function LeftPane({
  academicProfile,
  accountSession,
  collectionItems,
  documentMetadataSyncMessage,
  documentMetadataSyncResult,
  documentMetadataSyncStatus,
  governanceMessage,
  importJobs,
  governanceStatus,
  governanceSummary,
  lastSyncedAt,
  latestExecutionLabel,
  leftRailView,
  list,
  listMessage,
  listStatus,
  onAddExternalPaper,
  onClearProfile,
  onClearRecommendations,
  onCollectRecommendation,
  onCreateOrganization,
  onImportSelectedSet,
  onInviteMember,
  onJoinOrganization,
  onLeaveOrganization,
  onMarkNotificationsRead,
  onOpenAcademicArchive,
  onOpenOrganizationDialog,
  onOpenSharedLibrary,
  onReturnToLocalWorkspace,
  onRetryDocumentMetadataSync,
  onSelectOrganization,
  onSetAccessMode,
  onSyncCloudPolicy,
  onToggleLocalDirectEnabled,
  onUseLocalDevCloudDefaults,
  onToggleProfileSampling,
  onUpdateAcademicProfile,
  onToggleSelection,
  onToggleLock,
  organizationActionMessage,
  organizationSummary,
  organizationSummaryMessage,
  organizationSummaryStatus,
  papers,
  policySyncMessage,
  policySyncPending,
  policySyncStatus,
  policyVersion,
  profileClearMessage,
  profileReadPaperCount,
  profileSamplingEnabled,
  recommendationItems,
  recommendationMessage,
  recommendationPending,
  recommendationStatus,
  readNotificationIds,
  selectedPaperIds,
  selectionLocked,
  settings,
  summary,
  workspaceLabel
}: LeftPaneProps) {
  return (
    <aside className="pane left">
      <div className="pane-header">{getPaneHeader(leftRailView)}</div>
      <div className="pane-body">
        {leftRailView === "organization" ? (
          <OrganizationSidebarPanel
            actionMessage={organizationActionMessage}
            governanceMessage={governanceMessage}
            governanceStatus={governanceStatus}
            governanceSummary={governanceSummary}
            list={list}
            listMessage={listMessage}
            listStatus={listStatus}
            onCreateOrganization={onCreateOrganization}
            onInviteMember={onInviteMember}
            onJoinOrganization={onJoinOrganization}
            onLeaveOrganization={onLeaveOrganization}
            onMarkNotificationsRead={onMarkNotificationsRead}
            onOpenSharedLibrary={onOpenSharedLibrary}
            onOpenWindow={onOpenOrganizationDialog}
            onSelectOrganization={onSelectOrganization}
            readNotificationIds={readNotificationIds}
            summary={summary}
            summaryMessage={organizationSummaryMessage}
            summaryStatus={organizationSummaryStatus}
          />
        ) : leftRailView === "profile" ? (
          <PersonalCenterPanel
            academicProfile={academicProfile}
            accountSession={accountSession}
            onClearProfile={onClearProfile}
            onOpenAcademicArchive={onOpenAcademicArchive}
            onToggleProfileSampling={onToggleProfileSampling}
            onUpdateAcademicProfile={onUpdateAcademicProfile}
            organizationSummary={organizationSummary}
            profileClearMessage={profileClearMessage}
            profileSamplingEnabled={profileSamplingEnabled}
            readPaperCount={profileReadPaperCount}
          />
        ) : leftRailView === "settings" ? (
          <SettingsPane
            documentMetadataSyncMessage={documentMetadataSyncMessage}
            documentMetadataSyncResult={documentMetadataSyncResult}
            documentMetadataSyncStatus={documentMetadataSyncStatus}
            latestExecutionLabel={latestExecutionLabel}
            onRetryDocumentMetadataSync={onRetryDocumentMetadataSync}
            onSetAccessMode={onSetAccessMode}
            onSyncCloudPolicy={onSyncCloudPolicy}
            onToggleLocalDirectEnabled={onToggleLocalDirectEnabled}
            onUseLocalDevCloudDefaults={onUseLocalDevCloudDefaults}
            policySyncMessage={policySyncMessage}
            policySyncPending={policySyncPending}
            policySyncStatus={policySyncStatus}
            policyVersion={policyVersion}
            settings={settings}
            syncedAt={lastSyncedAt}
          />
        ) : (
          <LibraryPane
            canReturnToLocalWorkspace={workspaceLabel !== "本地文献库"}
            collectionItems={collectionItems}
            importJobs={importJobs}
            onAddExternalPaper={onAddExternalPaper}
            onClearRecommendations={onClearRecommendations}
            onCollectRecommendation={onCollectRecommendation}
            onImportSelectedSet={onImportSelectedSet}
            onReturnToLocalWorkspace={onReturnToLocalWorkspace}
            onToggleLock={onToggleLock}
            onToggleSelection={onToggleSelection}
            papers={papers}
            recommendationItems={recommendationItems}
            recommendationMessage={recommendationMessage}
            recommendationPending={recommendationPending}
            recommendationStatus={recommendationStatus}
            selectedPaperIds={selectedPaperIds}
            selectionLocked={selectionLocked}
            workspaceLabel={workspaceLabel}
          />
        )}
      </div>
    </aside>
  );
}
