import { useState } from "react";

type OrganizationCreateDialogProps = {
  message?: string;
  onCancel: () => void;
  onConfirm: (organizationName: string) => void;
  pending?: boolean;
};

export function OrganizationCreateDialog({
  message,
  onCancel,
  onConfirm,
  pending = false
}: OrganizationCreateDialogProps) {
  const [organizationName, setOrganizationName] = useState("");

  return (
    <div className="workspace-dialog-backdrop profile-dialog-backdrop" data-testid="workspace-dialog-backdrop">
      <div aria-label="创建组织" className="workspace-modal-panel profile-dialog" role="dialog">
        <div className="profile-dialog-header">
          <div>
            <div className="profile-dialog-kicker">Organization Creation</div>
            <div className="profile-dialog-title">创建组织</div>
          </div>
          <button className="organization-dialog-close" disabled={pending} onClick={onCancel} type="button">
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
        {message ? <div aria-live="polite" className="organization-action-message">{message}</div> : null}
        <div className="profile-dialog-actions">
          <button className="left-rail-button subtle" disabled={pending} onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="left-rail-button"
            disabled={pending || organizationName.trim().length === 0}
            onClick={() => onConfirm(organizationName.trim())}
            type="button"
          >
            {pending ? "正在创建" : "创建组织"}
          </button>
        </div>
      </div>
    </div>
  );
}
