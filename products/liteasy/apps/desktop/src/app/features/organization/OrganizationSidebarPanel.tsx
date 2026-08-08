import type { AccountSession } from "../account/account.types";
import { Tooltip } from "@fluentui/react-components";
import {
  AddRegular,
  OpenRegular,
  PeopleAddRegular,
  SignOutRegular
} from "@fluentui/react-icons";
import { OrganizationMemberGovernancePanel } from "./OrganizationMemberGovernancePanel";
import { OrganizationSpacePanel } from "./OrganizationSpacePanel";
import { OrganizationStoragePolicyPanel } from "./OrganizationStoragePolicyPanel";
import type {
  OrganizationList,
  OrganizationListStatus,
  OrganizationSummary,
  OrganizationSummaryStatus
} from "./organization.types";

type OrganizationSidebarPanelProps = {
  accountSession: AccountSession | null;
  actionMessage?: string;
  cloudEndpoint: string;
  list: OrganizationList | null;
  listMessage: string;
  listStatus: OrganizationListStatus;
  onCreateOrganization?: () => void;
  onInviteMember?: (summary: OrganizationSummary) => void;
  onJoinOrganization?: () => void;
  onLoginRequired?: () => void;
  onLeaveOrganization?: (summary: OrganizationSummary) => void;
  onMarkNotificationsRead?: (summary: OrganizationSummary) => void;
  onOrganizationChanged?: () => void | Promise<void>;
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
  cloudEndpoint,
  list,
  listMessage,
  listStatus,
  onCreateOrganization,
  onInviteMember,
  onJoinOrganization,
  onLoginRequired,
  onLeaveOrganization,
  onMarkNotificationsRead,
  onOrganizationChanged,
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
  const canInviteMembers = summary ? summary.myRole === "owner" || summary.myRole === "admin" : false;
  const accountPermissionTooltip = canCreateOrganization
    ? "当前账号权限：可创建组织，也可加入已有组织。"
    : "当前账号权限：可加入组织，暂不可创建组织。";

  return (
    <section aria-label="左边栏组织" className="organization-sidebar-panel">
      {loggedOut ? (
        <div className="organization-action-feedback">
          <div className="organization-sidebar-actions">
            <Tooltip content="登录后使用组织空间" positioning="below" relationship="description">
              <button
                aria-label="登录后使用组织空间"
                className="policy-button sync icon-only"
                onClick={onLoginRequired}
                title="登录后使用组织空间"
                type="button"
              >
                <PeopleAddRegular />
              </button>
            </Tooltip>
          </div>
        </div>
      ) : (
        <div className="organization-sidebar-actions">
          <Tooltip content="打开组织窗口" positioning="below" relationship="description">
            <button aria-label="打开组织窗口" className="policy-button sync icon-only" onClick={onOpenWindow} type="button">
              <OpenRegular />
            </button>
          </Tooltip>
          {canCreateOrganization ? (
            <Tooltip content="创建组织" positioning="below" relationship="description">
              <button
                aria-label="创建组织"
                className="policy-button ghost icon-only"
                onClick={onCreateOrganization}
                title={accountPermissionTooltip}
                type="button"
              >
                <AddRegular />
              </button>
            </Tooltip>
          ) : (
            <button aria-label="创建组织" className="policy-button ghost icon-only" disabled title={accountPermissionTooltip} type="button">
              <AddRegular />
            </button>
          )}
          <Tooltip content="加入组织" positioning="below" relationship="description">
            <button aria-label="加入组织" className="policy-button ghost icon-only" onClick={onJoinOrganization} title={accountPermissionTooltip} type="button">
              <PeopleAddRegular />
            </button>
          </Tooltip>
          {summary && canInviteMembers ? (
            <Tooltip content="邀请成员" positioning="below" relationship="description">
              <button aria-label="邀请成员" className="policy-button ghost icon-only" onClick={() => onInviteMember?.(summary)} type="button">
                <PeopleAddRegular />
              </button>
            </Tooltip>
          ) : null}
          {summary ? (
            <Tooltip content="退出组织" positioning="below" relationship="description">
              <button aria-label="退出组织" className="left-rail-button danger icon-only" onClick={() => onLeaveOrganization?.(summary)} type="button">
                <SignOutRegular />
              </button>
            </Tooltip>
          ) : null}
        </div>
      )}
      {actionMessage ? (
        <div aria-label="组织操作反馈" className="organization-action-feedback" role="status">
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
      {summary ? (
        <OrganizationStoragePolicyPanel endpoint={cloudEndpoint} summary={summary} />
      ) : null}
      {accountSession && summary && (summary.myRole === "owner" || summary.myRole === "admin") ? (
        <OrganizationMemberGovernancePanel
          accountSession={accountSession}
          endpoint={cloudEndpoint}
          onChanged={onOrganizationChanged ?? (() => undefined)}
          summary={summary}
        />
      ) : null}
    </section>
  );
}
