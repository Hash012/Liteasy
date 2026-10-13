import { ActionButton as Button, DisclosureSection, IconAction } from "../../shared/ui/productPrimitives";
import { OrganizationInvitationPanel } from "./OrganizationInvitationPanel";
import { OrganizationActivityInbox } from "./OrganizationActivityInbox";
import type { AccountSession } from "../account/account.types";
import { Tooltip, Menu, MenuTrigger, MenuPopover, MenuList, MenuItem } from "@fluentui/react-components";
import {
  AddRegular,
  OpenRegular,
  PeopleAddRegular,
  SignOutRegular,
  PeopleRegular,
  MoreHorizontalRegular,
  SettingsRegular
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
  return (
    <section aria-label="左边栏组织" className="organization-sidebar-panel">
      {loggedOut ? <div className="organization-empty">
        <PeopleRegular aria-hidden="true" /><h2>与团队一起研究</h2>
        <p>共享文献、查看团队通知，并统一管理成员与存储空间。</p>
        <Button appearance="primary" icon={<PeopleAddRegular />} onClick={onLoginRequired}>登录后使用组织空间</Button>
      </div> : <div className="organization-sidebar-actions">
        <Tooltip content="打开组织窗口" relationship="label"><Button appearance="subtle" aria-label="打开组织窗口" icon={<OpenRegular />} onClick={onOpenWindow} /></Tooltip>
        {!summary ? <>
        <Tooltip content={canCreateOrganization ? "创建组织" : "当前账号暂不可创建组织"} relationship="description">
          <Button appearance="subtle" aria-label="创建组织" icon={<AddRegular />} disabled={!canCreateOrganization || !onCreateOrganization} onClick={onCreateOrganization} />
        </Tooltip>
        <Button appearance="subtle" icon={<PeopleAddRegular />} onClick={onJoinOrganization}>加入组织</Button>
        </> : null}
        {summary && canInviteMembers ? <Tooltip content="邀请成员" relationship="label">
          <Button appearance="subtle" aria-label="邀请成员" icon={<PeopleAddRegular />} onClick={() => onInviteMember?.(summary)} />
        </Tooltip> : null}
        {summary ? <Menu><MenuTrigger disableButtonEnhancement><IconAction density="compact" label="组织管理" icon={<MoreHorizontalRegular />} /></MenuTrigger><MenuPopover><MenuList>
          <MenuItem icon={<AddRegular />} disabled={!canCreateOrganization || !onCreateOrganization} onClick={onCreateOrganization}>创建组织</MenuItem>
          <MenuItem icon={<PeopleAddRegular />} onClick={onJoinOrganization}>加入组织</MenuItem>
          <MenuItem icon={<SignOutRegular />} onClick={() => onLeaveOrganization?.(summary)}>退出组织</MenuItem>
        </MenuList></MenuPopover></Menu> : null}
      </div>}
      {accountSession && <OrganizationActivityInbox session={accountSession} endpoint={cloudEndpoint} />}
      {actionMessage ? (
        <div aria-label="组织操作反馈" className="organization-action-feedback" role="status">
          <div className="organization-action-feedback-message">{actionMessage}</div>
        </div>
      ) : null}
      {!loggedOut ? <OrganizationSpacePanel
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
      /> : null}
      {summary ? (
        <DisclosureSection className="organization-surface organization-disclosure" key={summary.organizationId} icon={<SettingsRegular />} title="文献库权限">
          <OrganizationStoragePolicyPanel endpoint={cloudEndpoint} summary={summary} />
        </DisclosureSection>
      ) : null}
      {accountSession && summary && <OrganizationInvitationPanel session={accountSession} endpoint={cloudEndpoint} summary={summary} onChanged={onOrganizationChanged ?? (() => undefined)} />}
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
