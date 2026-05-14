import type { OrganizationList, OrganizationSummary } from "./organization.types";

type OrganizationEntryDialogProps = {
  list: OrganizationList | null;
  listMessage: string;
  onClose: () => void;
  onOpenSharedLibrary?: (summary: OrganizationSummary) => void;
  onSelectOrganization: (organizationId: string) => void;
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

export function OrganizationEntryDialog({
  list,
  listMessage,
  onClose,
  onOpenSharedLibrary,
  onSelectOrganization,
  summary
}: OrganizationEntryDialogProps) {
  return (
    <div className="organization-dialog-backdrop">
      <div aria-label="组织窗口" className="organization-dialog" role="dialog">
        <div className="organization-dialog-header">
          <div>
            <div className="organization-dialog-kicker">左边栏 · 组织</div>
            <div className="organization-dialog-title">组织窗口</div>
          </div>
          <button className="organization-dialog-close" onClick={onClose} type="button">
            关闭
          </button>
        </div>

        <div className="organization-dialog-grid">
          <section className="organization-dialog-section">
            <div className="organization-dialog-section-title">组织列表</div>
            {list ? (
              <div className="organization-list-stack">
                {list.organizations.map((organization) => (
                  <button
                    aria-label={`打开 ${organization.name} 详情`}
                    className={
                      summary?.organizationId === organization.organizationId
                        ? "organization-list-card active"
                        : "organization-list-card"
                    }
                    key={organization.organizationId}
                    onClick={() => onSelectOrganization(organization.organizationId)}
                    type="button"
                  >
                    <span className="organization-list-name">{organization.name}</span>
                    <span className="organization-list-meta">
                      {organization.name} · {organization.myRole} · {organization.memberCount} 人 · {organization.sharedLibraryName}
                    </span>
                    <span className="organization-list-action">打开 {organization.name} 详情</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="organization-dialog-empty">{listMessage}</div>
            )}
          </section>

          <section className="organization-dialog-section detail">
            {summary ? (
              <>
                <div className="organization-dialog-section-title">组织详情：{summary.name}</div>
                <div className="organization-detail-row">角色：{summary.myRole} · 成员 {summary.memberCount} 人</div>
                {summary.members.length > 0 ? (
                  <div className="organization-detail-row">
                    成员：{summary.members.map((member) => `${member.name}（${member.role}）`).join("、")}
                  </div>
                ) : null}
                <div className="organization-detail-row">
                  共享文献库：{summary.sharedLibrary.name} · {summary.sharedLibrary.documentCount} 篇
                </div>
                {summary.notifications.map((notification) => (
                  <div className="organization-detail-row" key={notification.id}>
                    通知：{getNotificationTypeLabel(notification.type)} · {notification.message}
                  </div>
                ))}
                <div className="organization-detail-row">
                  配额：{summary.quota.storageUsedGb} / {summary.quota.storageLimitGb} GB，到期 {summary.quota.periodEndsAt}
                </div>
                <button
                  className="policy-button sync"
                  disabled={summary.sharedLibrary.status !== "available"}
                  onClick={() => onOpenSharedLibrary?.(summary)}
                  type="button"
                >
                  在工作区打开共享文献库
                </button>
              </>
            ) : (
              <div className="organization-dialog-empty">选择组织后会显示成员、通知和共享文献库详情。</div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
