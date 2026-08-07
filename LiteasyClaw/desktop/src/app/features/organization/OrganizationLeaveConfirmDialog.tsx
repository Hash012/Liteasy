import type { OrganizationSummary } from "./organization.types";

type OrganizationLeaveConfirmDialogProps = {
  message?: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
  summary: OrganizationSummary;
};

export function OrganizationLeaveConfirmDialog({
  message,
  onCancel,
  onConfirm,
  pending = false,
  summary
}: OrganizationLeaveConfirmDialogProps) {
  return (
    <div className="workspace-dialog-backdrop profile-dialog-backdrop danger" data-testid="workspace-dialog-backdrop">
      <div aria-label="退出组织确认" className="workspace-modal-panel profile-dialog" role="dialog">
        <div className="profile-dialog-header">
          <div>
            <div className="profile-dialog-kicker">Organization Leave</div>
            <div className="profile-dialog-title">退出组织确认</div>
          </div>
          <button className="organization-dialog-close" disabled={pending} onClick={onCancel} type="button">
            关闭
          </button>
        </div>
        <div className="profile-archive-card">
          <div className="profile-archive-title">组织：{summary.name}</div>
        </div>
        {message ? <div aria-live="polite" className="organization-action-message">{message}</div> : null}
        <div className="profile-dialog-actions">
          <button className="left-rail-button subtle" disabled={pending} onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="left-rail-button danger"
            disabled={pending}
            onClick={onConfirm}
            type="button"
          >
            {pending ? "正在退出" : "退出组织"}
          </button>
        </div>
      </div>
    </div>
  );
}
