import {
  LibraryPane,
  type LibraryPaperChildItem
} from "../features/library/LibraryPane";
import { OrganizationSidebarPanel } from "../features/organization/OrganizationSidebarPanel";
import { PersonalCenterPanel } from "../features/profile/PersonalCenterPanel";
import { SettingsPane } from "./SettingsPane";
import type { AcademicProfile } from "../features/profile/profile.types";
import type { AgentCoreCatalogEntry, AgentMemoryEntry } from "../features/agent-core/agentCoreConfig";
import type { AccountSession } from "../features/account/account.types";
import type { ImportJob } from "../features/import/import.types";
import type { DocumentMetadataSyncResult, DocumentMetadataSyncStatus } from "../features/metadata/metadata.types";
import type { OrganizationList, OrganizationListStatus, OrganizationSummary, OrganizationSummaryStatus } from "../features/organization/organization.types";
import type {
  CloudLibraryEntry,
  CloudLibraryScope
} from "../features/library/cloudLibraryStorageClient";
import type { ExternalPdfDragPayload } from "../features/library/externalPdfDownload";
import type {
  LibraryResourceTransferSource,
  LibraryResourceTransferTarget
} from "../features/library/libraryResourceTransfer.types";
import type { LocalLibrarySnapshot } from "../features/library/localLibrary.types";
import type { RecommendationItem, RecommendationStatus } from "../features/recommendations/recommendation.types";
import type { UserTag } from "../features/profile/academicProfileClient";
import type { Paper, WorkspaceSourceType } from "../features/workspace/workspace.types";
import type { SettingsState, UpdateSettingCommand } from "../features/settings/settings.types";
import type { LeftRailView } from "./useLeftRailNavigation";

export type LeftPaneProps = {
  accountScopeId?: string;
  activePaperId?: string | null;
  academicProfile: AcademicProfile;
  agentMemories: AgentMemoryEntry[];
  agentRecentState: string;
  accountSession: AccountSession | null;
  cloudEndpoint: string;
  cloudTreeRevision?: number;
  documentMetadataSyncMessage?: string;
  documentMetadataSyncResult: DocumentMetadataSyncResult | null;
  documentMetadataSyncStatus: DocumentMetadataSyncStatus;
  libraryRootPath?: string | null;
  loadLegacyLibraryRoots?: () => Promise<string[]>;
  localLibraryError?: string | null;
  localLibrarySnapshot: LocalLibrarySnapshot | null;
  onBackupLibrary?: (destinationDirectory: string) => Promise<string>;
  onChangeLibraryRoot?: (nextRootPath: string) => Promise<void>;
  onOpenLibraryInFileManager?: () => Promise<void>;
  onSelectLegacyLibraryRoot?: (legacyRootPath: string) => Promise<void>;
  importJobs: Record<string, ImportJob>;
  libraryPaperChildren?: Record<string, LibraryPaperChildItem[]>;
  leftRailView: LeftRailView;
  list: OrganizationList | null;
  listMessage: string;
  organizationActionMessage?: string;
  listStatus: OrganizationListStatus;
  onAddExternalPdf?: (item: ExternalPdfDragPayload) => void | Promise<void>;
  onAddDroppedPdfFiles?: (files: File[], targetFolderPath?: string) => void | Promise<void>;
  onClearProfile: () => void;
  onClearRecommendations: () => void;
  onDismissRecommendation: (item: RecommendationItem) => void;
  onCreateOrganization?: () => void;
  onImportSelectedSet: () => void;
  onImportZoteroDirectory?: (files: File[]) => string | Promise<string>;
  onInviteMember?: (summary: OrganizationSummary) => void;
  onJoinOrganization?: () => void;
  onLoginRequired?: () => void;
  onLeaveOrganization?: (summary: OrganizationSummary) => void;
  onLogout: () => void;
  onMarkNotificationsRead?: (summary: OrganizationSummary) => void;
  onOrganizationChanged?: () => void | Promise<void>;
  onOpenAcademicArchive: () => void;
  onOpenOrganizationDialog: () => void;
  onOpenCloudEntry?: (scope: CloudLibraryScope, entry: CloudLibraryEntry) => void | Promise<void>;
  onOpenPaper?: (paperId: string) => void;
  onOpenPaperChild?: (item: LibraryPaperChildItem, paper: Paper) => void;
  onRenamePaperChild?: (item: LibraryPaperChildItem, paper: Paper, requestedName: string) => Promise<string>;
  onRefreshLocalLibrary?: () => Promise<void>;
  onMoveLibraryFolder?: (folderPath: string, targetFolderPath: string) => Promise<string>;
  onMoveLibraryPaper?: (paperId: string, targetFolderPath: string) => Promise<string>;
  onOpenSharedLibrary?: (summary: OrganizationSummary) => void;
  onOpenSkillDocument?: (entry: AgentCoreCatalogEntry) => void;
  onReturnToLocalWorkspace: () => void;
  onRenameLibraryFolder?: (folderPath: string, requestedName: string) => Promise<string>;
  onRenameLibraryPaper?: (paperId: string, requestedName: string) => Promise<string>;
  onResourceTransfer?: (
    source: LibraryResourceTransferSource,
    target: LibraryResourceTransferTarget
  ) => void | Promise<void>;
  onRetryDocumentMetadataSync?: () => void;
  onSelectOrganization?: (organizationId: string) => void;
  onToggleProfileSampling: () => void;
  onUpdateAcademicProfile: (profile: AcademicProfile) => void;
  onUpdateAgentMemories: (memories: AgentMemoryEntry[]) => void;
  onUpdateAgentRecentState: (summary: string) => void;
  onToggleSelection: (paperId: string) => void;
  onToggleLock: () => void;
  onUpdateSetting?: (command: UpdateSettingCommand) => void;
  organizationSummary: OrganizationSummary | null;
  organizationSummaryMessage: string;
  organizationSummaryStatus: OrganizationSummaryStatus;
  organizationId?: string;
  papers: Paper[];
  profileClearMessage?: string;
  profileReadPaperCount: number;
  profileSamplingEnabled: boolean;
  profileTags: UserTag[];
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
  accountScopeId,
  activePaperId,
  academicProfile,
  agentMemories,
  agentRecentState,
  accountSession,
  cloudEndpoint,
  cloudTreeRevision,
  documentMetadataSyncMessage,
  documentMetadataSyncResult,
  documentMetadataSyncStatus,
  libraryRootPath,
  loadLegacyLibraryRoots,
  localLibraryError,
  localLibrarySnapshot,
  onBackupLibrary,
  onChangeLibraryRoot,
  onOpenLibraryInFileManager,
  onSelectLegacyLibraryRoot,
  importJobs,
  libraryPaperChildren,
  leftRailView,
  list,
  listMessage,
  listStatus,
  onAddExternalPdf,
  onAddDroppedPdfFiles,
  onClearProfile,
  onClearRecommendations,
  onDismissRecommendation,
  onCreateOrganization,
  onImportSelectedSet,
  onImportZoteroDirectory,
  onInviteMember,
  onJoinOrganization,
  onLoginRequired,
  onLeaveOrganization,
  onLogout,
  onMarkNotificationsRead,
  onOrganizationChanged,
  onOpenAcademicArchive,
  onOpenCloudEntry,
  onOpenOrganizationDialog,
  onOpenPaper,
  onOpenPaperChild,
  onRenamePaperChild,
  onRefreshLocalLibrary,
  onMoveLibraryFolder,
  onMoveLibraryPaper,
  onOpenSharedLibrary,
  onOpenSkillDocument,
  onReturnToLocalWorkspace,
  onRenameLibraryFolder,
  onRenameLibraryPaper,
  onResourceTransfer,
  onRetryDocumentMetadataSync,
  onSelectOrganization,
  onToggleProfileSampling,
  onUpdateAcademicProfile,
  onUpdateAgentMemories,
  onUpdateAgentRecentState,
  onToggleSelection,
  onToggleLock,
  onUpdateSetting,
  organizationActionMessage,
  organizationSummary,
  organizationSummaryMessage,
  organizationSummaryStatus,
  organizationId,
  papers,
  profileClearMessage,
  profileReadPaperCount,
  profileSamplingEnabled,
  profileTags,
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
            cloudEndpoint={cloudEndpoint}
            list={list}
            listMessage={listMessage}
            listStatus={listStatus}
            onCreateOrganization={onCreateOrganization}
            onInviteMember={onInviteMember}
            onJoinOrganization={onJoinOrganization}
            onLoginRequired={onLoginRequired}
            onLeaveOrganization={onLeaveOrganization}
            onMarkNotificationsRead={onMarkNotificationsRead}
            onOrganizationChanged={onOrganizationChanged}
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
              agentMemories={agentMemories}
              agentRecentState={agentRecentState}
              accountSession={accountSession}
              onClearProfile={onClearProfile}
              onLogout={onLogout}
              onOpenAcademicArchive={onOpenAcademicArchive}
              onToggleProfileSampling={onToggleProfileSampling}
              onUpdateAcademicProfile={onUpdateAcademicProfile}
              onUpdateAgentMemories={onUpdateAgentMemories}
              onUpdateAgentRecentState={onUpdateAgentRecentState}
              organizationSummary={organizationSummary}
              profileClearMessage={profileClearMessage}
              profileSamplingEnabled={profileSamplingEnabled}
              profileTags={profileTags}
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
            libraryRootPath={libraryRootPath}
            loadLegacyLibraryRoots={loadLegacyLibraryRoots}
            onBackupLibrary={onBackupLibrary}
            onChangeLibraryRoot={onChangeLibraryRoot}
            onOpenLibraryInFileManager={onOpenLibraryInFileManager}
            onSelectLegacyLibraryRoot={onSelectLegacyLibraryRoot}
            onOpenSkillDocument={onOpenSkillDocument}
            onRetryDocumentMetadataSync={onRetryDocumentMetadataSync}
            onUpdateSetting={onUpdateSetting}
            settings={settings}
          />
        ) : (
          <LibraryPane
            accountScopeId={accountScopeId}
            accountSessionAvailable={accountSession !== null}
            activePaperId={activePaperId}
            canOpenOrganizationWorkspace={canOpenOrganizationWorkspace}
            cloudEndpoint={cloudEndpoint}
            cloudTreeRevision={cloudTreeRevision}
            importJobs={importJobs}
            loadLegacyLibraryRoots={loadLegacyLibraryRoots}
            localLibraryError={localLibraryError}
            localLibrarySnapshot={localLibrarySnapshot}
            paperChildren={libraryPaperChildren}
            onAddExternalPdf={onAddExternalPdf}
            onAddDroppedPdfFiles={onAddDroppedPdfFiles}
            onClearRecommendations={onClearRecommendations}
            onDismissRecommendation={onDismissRecommendation}
            onImportSelectedSet={onImportSelectedSet}
            onImportZoteroDirectory={onImportZoteroDirectory}
            onLoginRequired={onLoginRequired}
            onOpenOrganizationWorkspace={() => {
              if (organizationSummary) {
                onOpenSharedLibrary?.(organizationSummary);
              }
            }}
            onOpenCloudEntry={onOpenCloudEntry}
            onOpenPaper={onOpenPaper}
            onOpenPaperChild={onOpenPaperChild}
            onRefreshLocalLibrary={onRefreshLocalLibrary}
            onSelectLegacyLibraryRoot={onSelectLegacyLibraryRoot}
            onMoveFolder={onMoveLibraryFolder}
            onMovePaper={onMoveLibraryPaper}
            onReturnToLocalWorkspace={onReturnToLocalWorkspace}
            onRenameFolder={onRenameLibraryFolder}
            onRenamePaper={onRenameLibraryPaper}
            onResourceTransfer={onResourceTransfer}
            onToggleLock={onToggleLock}
            onToggleSelection={onToggleSelection}
            organizationWorkspaceLabel={organizationWorkspaceLabel}
            organizationId={organizationId}
            organizationStorageAccess={organizationSummary?.policy ? {
              ...organizationSummary.policy,
              role: organizationSummary.myRole
            } : undefined}
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
