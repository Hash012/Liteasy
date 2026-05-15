import type {
  OrganizationList,
  OrganizationListStatus,
  OrganizationSummary,
  OrganizationSummaryStatus
} from "./organization.types";

type OrganizationSpacePanelProps = {
  list: OrganizationList | null;
  listMessage: string;
  listStatus: OrganizationListStatus;
  message: string;
  onMarkNotificationsRead?: (summary: OrganizationSummary) => void;
  onOpenSharedLibrary?: (summary: OrganizationSummary) => void;
  onSelectOrganization?: (organizationId: string) => void;
  readNotificationIds: string[];
  status: OrganizationSummaryStatus;
  summary: OrganizationSummary | null;
};

function getNotificationTypeLabel(type: string) {
  if (type === "announcement") {
    return "公告";
  }

  if (type === "document_upload") {
    return "文献上传";
  }

  return "文献库变更";
}

function getNotificationReadKey(organizationId: string, notificationId: string) {
  return `${organizationId}:${notificationId}`;
}

function getSharedLibraryOpenMessage(summary: OrganizationSummary) {
  if (summary.sharedLibrary.status === "syncing") {
    return "共享文献库状态：同步中，暂时不能打开。请稍后重试。";
  }

  if (summary.sharedLibrary.status === "unavailable") {
    return "共享文献库状态：不可用，请联系组织管理员或稍后重试。";
  }

  if (summary.sharedLibrary.documentCount === 0) {
    return "共享文献库状态：暂无可打开文献，请等待组织同步完成。";
  }

  return "共享文献库状态：可打开，会像 VSCode 打开文件夹一样切换当前工作区。";
}

function getStatusLabel(status: OrganizationSummaryStatus, summary: OrganizationSummary | null) {
  if (status === "success" && summary) {
    return `组织空间：${summary.name}`;
  }

  if (status === "loading") {
    return "组织空间：加载中";
  }

  if (status === "error") {
    return "组织空间：加载失败";
  }

  return "组织空间：未连接云账号";
}

export function OrganizationSpacePanel({
  list,
  listMessage,
  listStatus,
  message,
  onMarkNotificationsRead,
  onOpenSharedLibrary,
  onSelectOrganization,
  readNotificationIds,
  status,
  summary
}: OrganizationSpacePanelProps) {
  const latestNotification = summary?.notifications[0];
  const latestAuditEvent = summary?.auditEvents[0];
  const readNotificationIdSet = new Set(readNotificationIds);
  const unreadNotificationCount = summary
    ? summary.notifications.filter(
        (notification) =>
          !readNotificationIdSet.has(
            getNotificationReadKey(summary.organizationId, notification.id)
          )
      ).length
    : 0;

  return (
    <div className="model-policy-card organization-space-card">
      <div className="model-policy-title">组织空间</div>
      <div className={`model-policy-status ${status}`}>{getStatusLabel(status, summary)}</div>
      {list ? (
        <>
          <div className="model-policy-summary">
            已加入组织：{list.organizations.map((organization) => organization.name).join("、")}
          </div>
          {list.organizations.map((organization) => (
            <button
              className="policy-button ghost"
              disabled={summary?.organizationId === organization.organizationId}
              key={organization.organizationId}
              onClick={() => onSelectOrganization?.(organization.organizationId)}
              type="button"
            >
              查看 {organization.name}
            </button>
          ))}
        </>
      ) : listStatus === "loading" || listStatus === "error" ? (
        <div className="model-policy-footnote">{listMessage}</div>
      ) : null}
      {summary ? (
        <>
          <div className="model-policy-summary">
            角色：{summary.myRole} · 成员 {summary.memberCount} 人
          </div>
          {summary.members.length > 0 ? (
            <div className="model-policy-summary">
              组织成员：{summary.members.map((member) => `${member.name}（${member.role}）`).join("、")}
            </div>
          ) : null}
          <div className="model-policy-summary">
            共享文献库：{summary.sharedLibrary.name} · {summary.sharedLibrary.documentCount} 篇
          </div>
          {latestNotification ? (
            <div className="model-policy-summary">通知：{latestNotification.message}</div>
          ) : null}
          <div className="model-policy-summary">未读通知：{unreadNotificationCount} 条</div>
          {summary.notifications.length > 0 ? (
            <button
              className="policy-button ghost"
              disabled={unreadNotificationCount === 0}
              onClick={() => onMarkNotificationsRead?.(summary)}
              type="button"
            >
              全部标记已读
            </button>
          ) : null}
          {summary.notifications.map((notification) => (
            <div className="organization-notification-item" key={notification.id}>
              <div className="model-policy-summary">
                通知：{getNotificationTypeLabel(notification.type)} · {notification.message}
              </div>
              <div className="model-policy-footnote">
                通知状态：{notification.message} · {readNotificationIdSet.has(getNotificationReadKey(summary.organizationId, notification.id)) ? "已读" : "未读"}
              </div>
            </div>
          ))}
          <div className="model-policy-summary">
            配额：{summary.quota.storageUsedGb} / {summary.quota.storageLimitGb} GB，到期 {summary.quota.periodEndsAt}
          </div>
          <div className="model-policy-summary">
            治理：运行任务 {summary.taskSummary.running} 个，失败任务 {summary.taskSummary.failed} 个
          </div>
          {latestAuditEvent ? (
            <div className="model-policy-summary">
              最近审计：{latestAuditEvent.actor} {latestAuditEvent.description}
            </div>
          ) : null}
          <div className="model-policy-footnote">{getSharedLibraryOpenMessage(summary)}</div>
          <button
            className="policy-button sync"
            disabled={summary.sharedLibrary.status !== "available" || summary.sharedLibrary.documentCount === 0}
            onClick={() => onOpenSharedLibrary?.(summary)}
            type="button"
          >
            打开共享文献库
          </button>
        </>
      ) : (
        <div className="model-policy-footnote">{message}</div>
      )}
    </div>
  );
}
