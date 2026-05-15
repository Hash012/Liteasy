type LightweightLoginDialogProps = {
  onSkip: () => void;
  onSubmitDemoLogin: () => void;
  onToggleSuppressReminder: (checked: boolean) => void;
};

export function LightweightLoginDialog({
  onSkip,
  onSubmitDemoLogin,
  onToggleSuppressReminder
}: LightweightLoginDialogProps) {
  return (
    <div className="workspace-dialog-backdrop" data-testid="workspace-dialog-backdrop">
      <div
        aria-label="轻量登录面板"
        className="workspace-modal-panel lightweight-login-dialog"
        role="dialog"
      >
        <div className="organization-dialog-kicker">账号</div>
        <div className="organization-dialog-title">登录后开启云端能力</div>
        <div className="organization-dialog-empty">
          你可以先登录体验组织、推荐、收藏和云端能力，也可以先跳过，直接使用本地阅读器。
        </div>
        <div className="organization-form-field">
          <span>路演版快捷入口</span>
          <button className="left-rail-button active" onClick={onSubmitDemoLogin} type="button">
            一键 Demo 登录
          </button>
        </div>
        <label className="organization-form-field">
          <span>
            <input
              onChange={(event) => onToggleSuppressReminder(event.currentTarget.checked)}
              type="checkbox"
            />{" "}
            不再提醒
          </span>
        </label>
        <div className="clear-profile-actions">
          <button className="left-rail-button muted" onClick={onSkip} type="button">
            跳过，进入本地阅读器
          </button>
        </div>
      </div>
    </div>
  );
}
