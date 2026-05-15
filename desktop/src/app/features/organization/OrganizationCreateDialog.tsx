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
          <p>Demo 创建不会写入真实后端或申请云端空间。正式版本需要套餐、权限与计费校验。</p>
        </div>
        <div className="profile-dialog-actions">
          <button className="left-rail-button subtle" onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="left-rail-button"
            disabled={organizationName.trim().length === 0}
            onClick={() => onConfirm(organizationName.trim())}
            type="button"
          >
            创建 demo 组织申请
          </button>
        </div>
      </div>
    </div>
  );
}
