import type { OrganizationSummary } from "./organization.types";

type OrganizationInviteConfirmDialogProps = {
  onCancel: () => void;
  onConfirm: () => void;
  summary: OrganizationSummary;
};

export function OrganizationInviteConfirmDialog({
  onCancel,
  onConfirm,
  summary
}: OrganizationInviteConfirmDialogProps) {
  return (
    <div className="workspace-dialog-backdrop profile-dialog-backdrop" data-testid="workspace-dialog-backdrop">
      <div aria-label="邀请成员确认" className="workspace-modal-panel profile-dialog" role="dialog">
        <div className="profile-dialog-header">
          <div>
            <div className="profile-dialog-kicker">Organization Invite</div>
            <div className="profile-dialog-title">邀请成员确认</div>
          </div>
          <button className="organization-dialog-close" onClick={onCancel} type="button">
            关闭
          </button>
        </div>
        <div className="profile-archive-card">
          <div className="profile-archive-title">组织：{summary.name}</div>
          <p>当前演示环境会记录邀请动作，但不会真正发送邀请。正式版本将在此接入成员权限与邀请生命周期。</p>
        </div>
        <div className="profile-dialog-actions">
          <button className="left-rail-button subtle" onClick={onCancel} type="button">
            取消
          </button>
          <button className="left-rail-button" onClick={onConfirm} type="button">
            发送邀请
          </button>
        </div>
      </div>
    </div>
  );
}
