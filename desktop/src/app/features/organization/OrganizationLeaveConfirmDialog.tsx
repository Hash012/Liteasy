import type { OrganizationSummary } from "./organization.types";

type OrganizationLeaveConfirmDialogProps = {
  onCancel: () => void;
  onConfirm: () => void;
  summary: OrganizationSummary;
};

export function OrganizationLeaveConfirmDialog({
  onCancel,
  onConfirm,
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
          <button className="organization-dialog-close" onClick={onCancel} type="button">
            关闭
          </button>
        </div>
        <div className="profile-archive-card">
          <div className="profile-archive-title">组织：{summary.name}</div>
          <p>Demo 退出不会移除真实成员关系，也不会关闭共享文献库访问。正式版本需要二次鉴权和组织策略校验。</p>
        </div>
        <div className="profile-dialog-actions">
          <button className="left-rail-button subtle" onClick={onCancel} type="button">
            取消
          </button>
          <button className="left-rail-button danger" onClick={onConfirm} type="button">
            创建 demo 退出请求
          </button>
        </div>
      </div>
    </div>
  );
}
