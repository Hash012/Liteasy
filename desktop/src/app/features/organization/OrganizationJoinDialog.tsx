import { useState } from "react";

type OrganizationJoinDialogProps = {
  onCancel: () => void;
  onConfirm: (inviteCode: string) => void;
};

export function OrganizationJoinDialog({
  onCancel,
  onConfirm
}: OrganizationJoinDialogProps) {
  const [inviteCode, setInviteCode] = useState("LITEASY-DEMO-JOIN");

  return (
    <div className="workspace-dialog-backdrop profile-dialog-backdrop" data-testid="workspace-dialog-backdrop">
      <div aria-label="加入组织" className="workspace-modal-panel profile-dialog" role="dialog">
        <div className="profile-dialog-header">
          <div>
            <div className="profile-dialog-kicker">Organization Join</div>
            <div className="profile-dialog-title">加入组织</div>
          </div>
          <button className="organization-dialog-close" onClick={onCancel} type="button">
            关闭
          </button>
        </div>
        <div className="profile-archive-card">
          <label className="organization-form-field">
            <span>组织邀请码</span>
            <input
              aria-label="组织邀请码"
              className="organization-form-input"
              onChange={(event) => setInviteCode(event.target.value)}
              value={inviteCode}
            />
          </label>
          <p>Demo 加入不会校验真实邀请码或写入组织成员关系。正式版本需要邀请生命周期、组织权限与管理员审批。</p>
        </div>
        <div className="profile-dialog-actions">
          <button className="left-rail-button subtle" onClick={onCancel} type="button">
            取消
          </button>
          <button
            className="left-rail-button"
            disabled={inviteCode.trim().length === 0}
            onClick={() => onConfirm(inviteCode.trim())}
            type="button"
          >
            提交 demo 加入申请
          </button>
        </div>
      </div>
    </div>
  );
}
