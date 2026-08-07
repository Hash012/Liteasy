import { useState } from "react";
import type { OrganizationRole, OrganizationSummary } from "./organization.types";

type OrganizationInviteConfirmDialogProps = {
  message?: string;
  onCancel: () => void;
  onConfirm: (input: {
    role: Extract<OrganizationRole, "admin" | "member">;
    targetSubject: string;
  }) => void;
  pending?: boolean;
  summary: OrganizationSummary;
};

export function OrganizationInviteConfirmDialog({
  message,
  onCancel,
  onConfirm,
  pending = false,
  summary
}: OrganizationInviteConfirmDialogProps) {
  const [targetSubject, setTargetSubject] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");

  return (
    <div className="workspace-dialog-backdrop profile-dialog-backdrop" data-testid="workspace-dialog-backdrop">
      <div aria-label="邀请成员确认" className="workspace-modal-panel profile-dialog" role="dialog">
        <div className="profile-dialog-header">
          <div>
            <div className="profile-dialog-kicker">Organization Invite</div>
            <div className="profile-dialog-title">邀请成员确认</div>
          </div>
          <button className="organization-dialog-close" disabled={pending} onClick={onCancel} type="button">
            关闭
          </button>
        </div>
        <div className="profile-archive-card">
          <div className="profile-archive-title">组织：{summary.name}</div>
          <label className="organization-form-field">
            <span>账号主体 ID</span>
            <input
              aria-label="账号主体 ID"
              className="organization-form-input"
              onChange={(event) => setTargetSubject(event.target.value)}
              placeholder="IdP subject"
              value={targetSubject}
            />
          </label>
          <label className="organization-form-field">
            <span>组织角色</span>
            <select
              aria-label="组织角色"
              className="organization-form-input"
              onChange={(event) => setRole(event.target.value === "admin" ? "admin" : "member")}
              value={role}
            >
              <option value="member">成员</option>
              {summary.myRole === "owner" ? <option value="admin">管理员</option> : null}
            </select>
          </label>
        </div>
        {message ? <div aria-live="polite" className="organization-action-message">{message}</div> : null}
        <div className="profile-dialog-actions">
          <button className="left-rail-button subtle" disabled={pending} onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="left-rail-button"
            disabled={pending || targetSubject.trim().length === 0}
            onClick={() => onConfirm({ role, targetSubject: targetSubject.trim() })}
            type="button"
          >
            {pending ? "正在创建" : "创建邀请"}
          </button>
        </div>
      </div>
    </div>
  );
}
