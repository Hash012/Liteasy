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
    <div className="profile-dialog-backdrop">
      <div aria-label="邀请成员确认" className="profile-dialog" role="dialog">
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
          <p>Demo 邀请不会发送真实邮件。正式版本需要组织权限校验。</p>
        </div>
        <div className="profile-dialog-actions">
          <button className="left-rail-button subtle" onClick={onCancel} type="button">
            取消
          </button>
          <button className="left-rail-button" onClick={onConfirm} type="button">
            发送 demo 邀请
          </button>
        </div>
      </div>
    </div>
  );
}
