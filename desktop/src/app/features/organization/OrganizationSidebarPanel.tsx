import type { AccountSession } from "../account/account.types";
import { OrganizationGovernancePanel } from "./OrganizationGovernancePanel";
import { OrganizationSpacePanel } from "./OrganizationSpacePanel";
import type {
  OrganizationGovernanceStatus,
  OrganizationGovernanceSummary,
  OrganizationList,
  OrganizationListStatus,
  OrganizationSummary,
  OrganizationSummaryStatus
} from "./organization.types";

type OrganizationSidebarPanelProps = {
  accountSession: AccountSession | null;
  actionMessage?: string;
  governanceMessage: string;
  governanceStatus: OrganizationGovernanceStatus;
  governanceSummary: OrganizationGovernanceSummary | null;
  list: OrganizationList | null;
  listMessage: string;
  listStatus: OrganizationListStatus;
  onCreateOrganization?: () => void;
  onInviteMember?: (summary: OrganizationSummary) => void;
  onJoinOrganization?: () => void;
  onLoginRequired?: () => void;
  onLeaveOrganization?: (summary: OrganizationSummary) => void;
  onMarkNotificationsRead?: (summary: OrganizationSummary) => void;
  onOpenSharedLibrary?: (summary: OrganizationSummary) => void;
  onOpenWindow: () => void;
  onSelectOrganization?: (organizationId: string) => void;
  readNotificationIds: string[];
  summary: OrganizationSummary | null;
  summaryMessage: string;
  summaryStatus: OrganizationSummaryStatus;
};

export function OrganizationSidebarPanel({
  accountSession,
  actionMessage,
  governanceMessage,
  governanceStatus,
  governanceSummary,
  list,
  listMessage,
  listStatus,
  onCreateOrganization,
  onInviteMember,
  onJoinOrganization,
  onLoginRequired,
  onLeaveOrganization,
  onMarkNotificationsRead,
  onOpenSharedLibrary,
  onOpenWindow,
  onSelectOrganization,
  readNotificationIds,
  summary,
  summaryMessage,
  summaryStatus
}: OrganizationSidebarPanelProps) {
  const loggedOut = summary === null && list === null && listStatus === "unauthenticated" && summaryStatus === "unauthenticated";
  const canCreateOrganization = accountSession !== null && (accountSession.membershipTier ?? "pro") === "pro";
  const canInviteMembers = summary ? /管理员|owner|admin/i.test(summary.myRole) : false;
  const accountPermissionTooltip = canCreateOrganization
    ? "当前账号权限：可创建组织，也可加入已有组织。"
    : "当前账号权限：可加入组织，暂不可创建组织。";

  return (
    <section aria-label="左边栏组织" className="organization-sidebar-panel">
      <div className="organization-sidebar-header">
        <div>
          <div className="organization-sidebar-kicker">Activity · Organization</div>
          <div className="organization-sidebar-title">组织</div>
        </div>
      </div>
      {loggedOut ? (
        <div className="organization-action-feedback">
          <div className="organization-action-feedback-title">组织能力说明</div>
          <div className="organization-action-feedback-message">
            当前已退化为本地阅读器，组织空间不可用。登录后可加入组织、创建组织、查看共享文献库和组织通知。
          </div>
          <div className="organization-sidebar-actions">
            <button className="policy-button sync" onClick={onLoginRequired} type="button">
              登录后查看组织能力
            </button>
          </div>
        </div>
      ) : (
        <div className="organization-sidebar-actions">
          <button className="policy-button sync" onClick={onOpenWindow} type="button">
            打开组织窗口
          </button>
          {canCreateOrganization ? (
            <button
              className="policy-button ghost"
              onClick={onCreateOrganization}
              title={accountPermissionTooltip}
              type="button"
            >
              创建组织
            </button>
          ) : (
            <button className="policy-button ghost" disabled title={accountPermissionTooltip} type="button">
              创建组织
            </button>
          )}
          <button
            className="policy-button ghost"
            onClick={onJoinOrganization}
            title={accountPermissionTooltip}
            type="button"
          >
            加入组织
          </button>
          {summary && canInviteMembers ? (
            <button className="policy-button ghost" onClick={() => onInviteMember?.(summary)} type="button">
              邀请成员
            </button>
          ) : null}
          {summary ? (
            <button className="left-rail-button danger" onClick={() => onLeaveOrganization?.(summary)} type="button">
              退出组织
            </button>
          ) : null}
        </div>
      )}
      {actionMessage ? (
        <div aria-label="组织操作反馈" className="organization-action-feedback" role="status">
          <div className="organization-action-feedback-title">组织操作反馈</div>
          <div className="organization-action-feedback-message">{actionMessage}</div>
        </div>
      ) : null}
      <OrganizationSpacePanel
        list={list}
        listMessage={listMessage}
        listStatus={listStatus}
        message={summaryMessage}
        onMarkNotificationsRead={onMarkNotificationsRead}
        onOpenSharedLibrary={onOpenSharedLibrary}
        onSelectOrganization={onSelectOrganization}
        readNotificationIds={readNotificationIds}
        status={summaryStatus}
        summary={summary}
      />
      <OrganizationGovernancePanel
        message={governanceMessage}
        status={governanceStatus}
        summary={governanceSummary}
      />
    </section>
  );
}
