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
        </div>
        <div className="profile-dialog-actions">
          <button className="left-rail-button subtle" onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="left-rail-button danger"
            onClick={onConfirm}
            title="当前演示环境会记录退出组织请求，但不会真正变更成员关系。正式版本将在此接入二次确认、权限校验与成员关系变更。"
            type="button"
          >
            提交退出组织请求
          </button>
        </div>
      </div>
    </div>
  );
}
