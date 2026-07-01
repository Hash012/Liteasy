import { useState } from "react";
import type { FormEvent } from "react";
import type { AccountRegistrationInput } from "./accountSessionClient";

type LightweightLoginDialogProps = {
  onSkip: () => void;
  onSubmitAccountRegistration: (registration: AccountRegistrationInput) => void;
  onSubmitDemoLogin: () => void;
  onToggleSuppressReminder: (checked: boolean) => void;
};

export function LightweightLoginDialog({
  onSkip,
  onSubmitAccountRegistration,
  onSubmitDemoLogin,
  onToggleSuppressReminder
}: LightweightLoginDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleRegistrationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmitAccountRegistration({
      displayName: displayName.trim(),
      email: email.trim(),
      password
    });
  }

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
          注册你的专属账号后可开启组织、推荐、收藏和云端能力；也可以继续使用 Demo 登录或本地阅读器。
        </div>
        <form className="account-registration-form" onSubmit={handleRegistrationSubmit}>
          <label className="organization-form-field">
            <span>昵称</span>
            <input
              className="organization-form-input"
              onChange={(event) => setDisplayName(event.currentTarget.value)}
              required
              type="text"
              value={displayName}
            />
          </label>
          <label className="organization-form-field">
            <span>邮箱</span>
            <input
              className="organization-form-input"
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="organization-form-field">
            <span>密码</span>
            <input
              className="organization-form-input"
              minLength={8}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="left-rail-button active" type="submit">
            注册并登录
          </button>
        </form>
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
