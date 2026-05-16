import { useState } from "react";

type OrganizationCreateDialogProps = {
  onCancel: () => void;
  onConfirm: (organizationName: string) => void;
};

export function OrganizationCreateDialog({
  onCancel,
  onConfirm
}: OrganizationCreateDialogProps) {
  const [organizationName, setOrganizationName] = useState("Liteasy Demo Organization");

  return (
    <div className="workspace-dialog-backdrop profile-dialog-backdrop" data-testid="workspace-dialog-backdrop">
      <div aria-label="创建组织" className="workspace-modal-panel profile-dialog" role="dialog">
        <div className="profile-dialog-header">
          <div>
            <div className="profile-dialog-kicker">Organization Creation</div>
            <div className="profile-dialog-title">创建组织</div>
          </div>
          <button className="organization-dialog-close" onClick={onCancel} type="button">
            关闭
          </button>
        </div>
        <div className="profile-archive-card">
          <label className="organization-form-field">
            <span>组织名称</span>
            <input
              aria-label="组织名称"
              className="organization-form-input"
              onChange={(event) => setOrganizationName(event.target.value)}
              value={organizationName}
            />
          </label>
        </div>
        <div className="profile-dialog-actions">
          <button className="left-rail-button subtle" onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="left-rail-button"
            disabled={organizationName.trim().length === 0}
            onClick={() => onConfirm(organizationName.trim())}
            title="当前演示环境会记录创建组织请求，但不会真正开通组织空间。正式版本将在此接入会员权限、套餐与组织开通流程。"
            type="button"
          >
            提交创建组织申请
          </button>
        </div>
      </div>
    </div>
  );
}
