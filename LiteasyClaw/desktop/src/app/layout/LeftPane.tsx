import {
  LibraryPane,
  type LibraryPaperChildItem
} from "../features/library/LibraryPane";
import { OrganizationSidebarPanel } from "../features/organization/OrganizationSidebarPanel";
import { PersonalCenterPanel } from "../features/profile/PersonalCenterPanel";
import { SettingsPane } from "./SettingsPane";
import type { AcademicProfile } from "../features/profile/profile.types";
import type { AgentCoreCatalogEntry } from "../features/agent-core/agentCoreConfig";
import type { AccountSession } from "../features/account/account.types";
import type { ImportJob } from "../features/import/import.types";
import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "../features/metadata/metadata.types";
import type { OrganizationGovernanceStatus, OrganizationGovernanceSummary, OrganizationList, OrganizationListStatus, OrganizationSummary, OrganizationSummaryStatus } from "../features/organization/organization.types";
import type { CollectionItem } from "../features/collection/collection.types";
import type { RecommendationItem, RecommendationStatus } from "../features/recommendations/recommendation.types";
import type { Paper, WorkspaceSourceType } from "../features/workspace/workspace.types";
import type { SettingsState } from "../features/settings/settings.types";
import type { LeftRailView } from "./useLeftRailNavigation";

export type LeftPaneProps = {
  activePaperId?: string | null;
  academicProfile: AcademicProfile;
  accountSession: AccountSession | null;
  collectionItems: CollectionItem[];
  collectionMessage: string;
  collectionStatus: "idle" | "loading" | "ready" | "error";
  documentMetadataSyncMessage?: string;
  documentMetadataSyncResult: DocumentMetadataSyncResult | null;
  documentMetadataSyncStatus: DocumentMetadataSyncStatus;
  governanceMessage: string;
  importJobs: Record<string, ImportJob>;
  libraryPaperChildren?: Record<string, LibraryPaperChildItem[]>;
  governanceStatus: OrganizationGovernanceStatus;
  governanceSummary: OrganizationGovernanceSummary | null;
  leftRailView: LeftRailView;
  list: OrganizationList | null;
  listMessage: string;
  organizationActionMessage?: string;
  listStatus: OrganizationListStatus;
  onAddExternalPaper: (item: { id: string; source: string; title: string }) => void;
  onAddDroppedPdfFiles?: (files: File[]) => void;
  onClearProfile: () => void;
  onClearRecommendations: () => void;
  onCollectRecommendation: (item: RecommendationItem) => void;
  onRetryCollectionSync?: () => void;
  onCreateOrganization?: () => void;
  onImportSelectedSet: () => void;
  onInviteMember?: (summary: OrganizationSummary) => void;
  onJoinOrganization?: () => void;
  onLoginRequired?: () => void;
  onLeaveOrganization?: (summary: OrganizationSummary) => void;
  onLogout: () => void;
  onMarkNotificationsRead?: (summary: OrganizationSummary) => void;
  onOpenAcademicArchive: () => void;
  onOpenOrganizationDialog: () => void;
  onOpenPaper?: (paperId: string) => void;
  onOpenPaperChild?: (item: LibraryPaperChildItem, paper: Paper) => void;
  onOpenSharedLibrary?: (summary: OrganizationSummary) => void;
  onOpenSkillDocument?: (entry: AgentCoreCatalogEntry) => void;
  onReturnToLocalWorkspace: () => void;
  onRetryDocumentMetadataSync?: () => void;
  onSelectOrganization?: (organizationId: string) => void;
  onToggleProfileSampling: () => void;
  onUpdateAcademicProfile: (profile: AcademicProfile) => void;
  onToggleSelection: (paperId: string) => void;
  onToggleLock: () => void;
  organizationSummary: OrganizationSummary | null;
  organizationSummaryMessage: string;
  organizationSummaryStatus: OrganizationSummaryStatus;
  papers: Paper[];
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
  workspaceSourceType: WorkspaceSourceType;
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
  activePaperId,
  academicProfile,
  accountSession,
  collectionItems,
  collectionMessage,
  collectionStatus,
  documentMetadataSyncMessage,
  documentMetadataSyncResult,
  documentMetadataSyncStatus,
  governanceMessage,
  importJobs,
  libraryPaperChildren,
  governanceStatus,
  governanceSummary,
  leftRailView,
  list,
  listMessage,
  listStatus,
  onAddExternalPaper,
  onAddDroppedPdfFiles,
  onClearProfile,
  onClearRecommendations,
  onCollectRecommendation,
  onRetryCollectionSync,
  onCreateOrganization,
  onImportSelectedSet,
  onInviteMember,
  onJoinOrganization,
  onLoginRequired,
  onLeaveOrganization,
  onLogout,
  onMarkNotificationsRead,
  onOpenAcademicArchive,
  onOpenOrganizationDialog,
  onOpenPaper,
  onOpenPaperChild,
  onOpenSharedLibrary,
  onOpenSkillDocument,
  onReturnToLocalWorkspace,
  onRetryDocumentMetadataSync,
  onSelectOrganization,
  onToggleProfileSampling,
  onUpdateAcademicProfile,
  onToggleSelection,
  onToggleLock,
  organizationActionMessage,
  organizationSummary,
  organizationSummaryMessage,
  organizationSummaryStatus,
  papers,
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
  workspaceLabel,
  workspaceSourceType
}: LeftPaneProps) {
  const canOpenOrganizationWorkspace =
    organizationSummary !== null &&
    organizationSummary.sharedLibrary.status === "available" &&
    organizationSummary.sharedLibrary.documentCount > 0 &&
    typeof onOpenSharedLibrary === "function";
  const organizationWorkspaceLabel = organizationSummary
    ? `${organizationSummary.sharedLibrary.name}（${organizationSummary.name}）`
    : "组织共享文献库";

  return (
    <aside className="pane left">
      <div className="pane-header">{getPaneHeader(leftRailView)}</div>
      <div className="pane-body">
        {leftRailView === "organization" ? (
          <OrganizationSidebarPanel
            accountSession={accountSession}
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
            onLoginRequired={onLoginRequired}
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
          accountSession ? (
            <PersonalCenterPanel
              academicProfile={academicProfile}
              accountSession={accountSession}
              onClearProfile={onClearProfile}
              onLogout={onLogout}
              onOpenAcademicArchive={onOpenAcademicArchive}
              onToggleProfileSampling={onToggleProfileSampling}
              onUpdateAcademicProfile={onUpdateAcademicProfile}
              organizationSummary={organizationSummary}
              profileClearMessage={profileClearMessage}
              profileSamplingEnabled={profileSamplingEnabled}
              readPaperCount={profileReadPaperCount}
            />
          ) : (
            <section aria-label="左边栏个人能力说明" className="organization-sidebar-panel">
              <div className="organization-sidebar-header">
                <div>
                  <div className="organization-sidebar-kicker">Activity · Profile</div>
                  <div className="organization-sidebar-title-row">
                    <div className="organization-sidebar-title">个人中心</div>
                    <span className="profile-login-status">未登录</span>
                  </div>
                </div>
              </div>
              <div className="organization-sidebar-actions">
                <button
                  className="policy-button sync"
                  onClick={onLoginRequired}
                  title="当前已退化为本地阅读器，个人画像、学术档案与云端身份信息不可用。登录后将自动恢复。"
                  type="button"
                >
                  登录后查看个人能力
                </button>
              </div>
            </section>
          )
        ) : leftRailView === "settings" ? (
          <SettingsPane
            documentMetadataSyncMessage={documentMetadataSyncMessage}
            documentMetadataSyncResult={documentMetadataSyncResult}
            documentMetadataSyncStatus={documentMetadataSyncStatus}
            onOpenSkillDocument={onOpenSkillDocument}
            onRetryDocumentMetadataSync={onRetryDocumentMetadataSync}
          />
        ) : (
          <LibraryPane
            accountSessionAvailable={accountSession !== null}
            activePaperId={activePaperId}
            canOpenOrganizationWorkspace={canOpenOrganizationWorkspace}
            collectionItems={collectionItems}
            collectionMessage={collectionMessage}
            collectionStatus={collectionStatus}
            importJobs={importJobs}
            paperChildren={libraryPaperChildren}
            onAddExternalPaper={onAddExternalPaper}
            onAddDroppedPdfFiles={onAddDroppedPdfFiles}
            onClearRecommendations={onClearRecommendations}
            onCollectRecommendation={onCollectRecommendation}
            onImportSelectedSet={onImportSelectedSet}
            onLoginRequired={onLoginRequired}
            onOpenOrganizationWorkspace={() => {
              if (organizationSummary) {
                onOpenSharedLibrary?.(organizationSummary);
              }
            }}
            onOpenPaper={onOpenPaper}
            onOpenPaperChild={onOpenPaperChild}
            onRetryCollectionSync={onRetryCollectionSync}
            onReturnToLocalWorkspace={onReturnToLocalWorkspace}
            onToggleLock={onToggleLock}
            onToggleSelection={onToggleSelection}
            organizationWorkspaceLabel={organizationWorkspaceLabel}
            papers={papers}
            recommendationItems={recommendationItems}
            recommendationMessage={recommendationMessage}
            recommendationPending={recommendationPending}
            recommendationStatus={recommendationStatus}
            selectedPaperIds={selectedPaperIds}
            selectionLocked={selectionLocked}
            workspaceLabel={workspaceLabel}
            workspaceSourceType={workspaceSourceType}
          />
        )}
      </div>
    </aside>
  );
}
