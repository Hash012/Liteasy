import { useState } from "react";

type OrganizationJoinDialogProps = {
  message?: string;
  onCancel: () => void;
  onConfirm: (invitationToken: string) => void;
  pending?: boolean;
};

export function OrganizationJoinDialog({
  message,
  onCancel,
  onConfirm,
  pending = false
}: OrganizationJoinDialogProps) {
  const [invitationToken, setInvitationToken] = useState("");

  return (
    <div className="workspace-dialog-backdrop profile-dialog-backdrop" data-testid="workspace-dialog-backdrop">
      <div aria-label="加入组织" className="workspace-modal-panel profile-dialog" role="dialog">
        <div className="profile-dialog-header">
          <div>
            <div className="profile-dialog-kicker">Organization Join</div>
            <div className="profile-dialog-title">加入组织</div>
          </div>
          <button className="organization-dialog-close" disabled={pending} onClick={onCancel} type="button">
            关闭
          </button>
        </div>
        <div className="profile-archive-card">
          <label className="organization-form-field">
            <span>邀请令牌</span>
            <input
              aria-label="邀请令牌"
              className="organization-form-input"
              onChange={(event) => setInvitationToken(event.target.value)}
              placeholder="orginv_..."
              value={invitationToken}
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
            disabled={pending || invitationToken.trim().length === 0}
            onClick={() => onConfirm(invitationToken.trim())}
            type="button"
          >
            {pending ? "正在加入" : "加入组织"}
          </button>
        </div>
      </div>
    </div>
  );
}
