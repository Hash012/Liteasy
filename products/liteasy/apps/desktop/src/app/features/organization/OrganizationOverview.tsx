import { ActionButton as Button, DisclosureSection } from "../../shared/ui/productPrimitives";
import { Avatar, Badge, ProgressBar } from "@fluentui/react-components";
import { BookOpenRegular, PeopleRegular, AlertRegular, StorageRegular } from "@fluentui/react-icons";
import type { OrganizationSummary } from "./organization.types";
import { OrganizationAccessDetails } from "./OrganizationAccessDetails";
import "./organization.css";

export function organizationRoleLabel(role: string) {
  return ({ owner: "所有者", admin: "管理员", member: "研究员" } as Record<string, string>)[role] ?? role;
}
export function OrganizationOverview({ summary, onOpenSharedLibrary, onMarkNotificationsRead, readNotificationIds }: {
  summary: OrganizationSummary;
  onOpenSharedLibrary?: (summary: OrganizationSummary) => void;
  onMarkNotificationsRead?: (summary: OrganizationSummary) => void;
  readNotificationIds?: string[];
}) {
  const isRead = (id: string) => readNotificationIds?.includes(`${summary.organizationId}:${id}`);
  const unreadCount = summary.notifications.filter((item) => !isRead(item.id)).length;
  const library = summary.sharedLibrary;
  const libraryReady = library.status === "available" && library.documentCount > 0;
  const libraryStatus = library.status === "syncing" ? "正在同步" : library.status === "unavailable" ? "暂时不可用" : `${library.documentCount} 篇文献`;
  return <div className="organization-overview">
    <header className="organization-identity">
      <Avatar name={summary.name} shape="square" size={40} color="brand" />
      <div><h2>{summary.name}</h2><span>{organizationRoleLabel(summary.myRole)} · {summary.memberCount} 位成员</span></div>
    </header>
    <section className="organization-surface" aria-label="共享文献库概览">
      <div className="organization-section-heading"><BookOpenRegular /><h3>共享文献库</h3><Badge appearance="tint">{libraryStatus}</Badge></div>
      <p>{library.name}</p>
      <Button appearance="primary" size="small" icon={<BookOpenRegular />} disabled={!libraryReady || !onOpenSharedLibrary}
        onClick={() => onOpenSharedLibrary?.(summary)}>打开共享文献库</Button>
      {!libraryReady || !onOpenSharedLibrary ? <p className="organization-muted">{library.status === "syncing" ? "文献库正在同步，请稍后再试。" : library.status === "unavailable" ? "文献库暂不可用，请刷新组织空间后重试。" : !library.documentCount ? "文献库暂无文献。" : "共享文献库入口尚未就绪。"}</p> : null}
    </section>
    <OrganizationAccessDetails snapshot={summary.accessSnapshot} />
    <DisclosureSection className="organization-surface organization-disclosure" icon={<PeopleRegular />} title={<>成员<span className="organization-count">{summary.memberCount}</span></>}>
      <ul className="organization-member-list">
        {summary.members.map((member) => <li key={member.id}>
          <Avatar name={member.name} size={28} /><span>{member.name}</span>
          <small>{organizationRoleLabel(member.role)}{member.status === "suspended" ? " · 已暂停" : ""}</small>
        </li>)}
      </ul>
      {!summary.members.length ? <p className="organization-muted">暂无成员信息</p> : null}
    </DisclosureSection>
    <DisclosureSection className="organization-surface organization-disclosure" defaultOpen icon={<AlertRegular />} title={<>通知<span className="organization-count">{readNotificationIds ? (unreadCount ? `${unreadCount} 条未读` : "全部已读") : `${summary.notifications.length} 条`}</span></>}>
      {onMarkNotificationsRead && summary.notifications.length ? <Button appearance="subtle" size="small" disabled={!unreadCount}
        onClick={() => onMarkNotificationsRead(summary)}>全部标记已读</Button> : null}
      <p className="organization-muted">已读状态仅保存在此设备；标记已读不会处理邀请或任务。</p>
      <ul className="organization-notice-list">
        {summary.notifications.map((item) => <li key={item.id}>
          <div>{readNotificationIds ? <Badge appearance="tint" color={isRead(item.id) ? "informative" : "brand"}>{isRead(item.id) ? "已读" : "未读"}</Badge> : null}
            <small>{item.type === "announcement" ? "公告" : item.type === "document_upload" ? "文献上传" : "文献库变更"}</small></div>
          <p>{item.message}</p>
          {onMarkNotificationsRead && !isRead(item.id) ? <Button appearance="subtle" size="small" onClick={() => onMarkNotificationsRead({ ...summary, notifications: [item] })}>标记此通知已读</Button> : null}
        </li>)}
      </ul>
      {!summary.notifications.length ? <p className="organization-muted">暂无通知</p> : null}
    </DisclosureSection>
    <section className="organization-surface" aria-label="组织存储用量">
      <div className="organization-section-heading"><StorageRegular /><h3>存储空间</h3></div>
      <p>{summary.quota.storageUsedGb} {summary.quota.configured ? `/ ${summary.quota.storageLimitGb}` : ""} GB
        {!summary.quota.configured ? " · 尚未分配配额" : ""}</p>
      {summary.quota.configured && summary.quota.storageLimitGb > 0 ? <ProgressBar aria-label="组织存储使用比例"
        value={Math.min(1, Math.max(0, summary.quota.storageUsedGb / summary.quota.storageLimitGb))} /> : null}
      {summary.quota.periodEndsAt ? <small className="organization-muted">到期 {summary.quota.periodEndsAt}</small> : null}
    </section>
    {summary.taskSummary || summary.auditEvents.length ? <DisclosureSection className="organization-surface organization-disclosure" title="近期活动">
      {summary.taskSummary ? <p>运行任务 {summary.taskSummary.running} 个 · 失败任务 {summary.taskSummary.failed} 个</p> : null}
      {summary.auditEvents.slice(0, 5).map((event) => <p key={event.id}>{event.actor} {event.description}</p>)}
    </DisclosureSection> : null}
  </div>;
}
