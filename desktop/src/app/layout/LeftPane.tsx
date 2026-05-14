import { LibraryPane } from "../features/library/LibraryPane";
import { OrganizationSidebarPanel } from "../features/organization/OrganizationSidebarPanel";
import { PersonalCenterPanel } from "../features/profile/PersonalCenterPanel";
import { SettingsPane } from "./SettingsPane";
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
  listStatus: OrganizationListStatus;
  onAddExternalPaper: (item: { id: string; source: string; title: string }) => void;
  onClearProfile: () => void;
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
  onSelectOrganization?: (organizationId: string) => void;
  onSetAccessMode: (mode: SettingsState["models.access_mode"]) => void;
  onSyncCloudPolicy: () => void;
  onToggleLocalDirectEnabled: (enabled: boolean) => void;
  onToggleProfileSampling: () => void;
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

export function LeftPane({
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
  onSelectOrganization,
  onSetAccessMode,
  onSyncCloudPolicy,
  onToggleLocalDirectEnabled,
  onToggleProfileSampling,
  onToggleSelection,
  onToggleLock,
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
      <div className="pane-header">{leftRailView === "organization" ? "Organization" : leftRailView === "profile" ? "Profile" : leftRailView === "settings" ? "Settings" : "Library"}</div>
      <div className="pane-body">
        {leftRailView === "organization" ? (
          <OrganizationSidebarPanel
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
            accountSession={accountSession}
            onClearProfile={onClearProfile}
            onOpenAcademicArchive={onOpenAcademicArchive}
            onToggleProfileSampling={onToggleProfileSampling}
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
            onSetAccessMode={onSetAccessMode}
            onSyncCloudPolicy={onSyncCloudPolicy}
            onToggleLocalDirectEnabled={onToggleLocalDirectEnabled}
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
