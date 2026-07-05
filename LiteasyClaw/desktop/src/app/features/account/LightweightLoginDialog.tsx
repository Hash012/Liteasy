import { useState } from "react";
import type { FormEvent } from "react";
import type {
  AccountLoginInput,
  AccountRegistrationInput
} from "./accountSessionClient";

type LightweightLoginDialogProps = {
  accountMessage?: string;
  accountPending?: boolean;
  onSkip: () => void;
  onSubmitAccountLogin: (login: AccountLoginInput) => void;
  onSubmitAccountRegistration: (registration: AccountRegistrationInput) => void;
  onSubmitDemoLogin: () => void;
  onToggleSuppressReminder: (checked: boolean) => void;
};

export function LightweightLoginDialog({
  accountMessage,
  accountPending = false,
  onSkip,
  onSubmitAccountLogin,
  onSubmitAccountRegistration,
  onSubmitDemoLogin,
  onToggleSuppressReminder
}: LightweightLoginDialogProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mode === "register") {
      onSubmitAccountRegistration({
        displayName: displayName.trim(),
        email: email.trim(),
        password
      });
      return;
    }

    onSubmitAccountLogin({
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
        <div className="organization-dialog-title">登录 LiteasyClaw</div>
        <div className="organization-dialog-empty">
          账号与内容保存在当前开发服务器；密码仅以安全哈希保存。
        </div>
        <div aria-label="账号操作" className="account-auth-mode-tabs" role="group">
          <button
            aria-pressed={mode === "login"}
            className={`left-rail-button ${mode === "login" ? "active" : "muted"}`}
            onClick={() => setMode("login")}
            type="button"
          >
            已有账号登录
          </button>
          <button
            aria-pressed={mode === "register"}
            className={`left-rail-button ${mode === "register" ? "active" : "muted"}`}
            onClick={() => setMode("register")}
            type="button"
          >
            创建账号
          </button>
        </div>
        <form className="account-registration-form" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <label className="organization-form-field">
              <span>昵称</span>
              <input
                autoComplete="name"
                className="organization-form-input"
                maxLength={80}
                onChange={(event) => setDisplayName(event.currentTarget.value)}
                required
                type="text"
                value={displayName}
              />
            </label>
          ) : null}
          <label className="organization-form-field">
            <span>邮箱</span>
            <input
              autoComplete="email"
              className="organization-form-input"
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="organization-form-field">
            <span>{mode === "register" ? "密码或密码短语（至少 12 位）" : "密码"}</span>
            <input
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              className="organization-form-input"
              maxLength={128}
              minLength={mode === "register" ? 12 : undefined}
              onChange={(event) => setPassword(event.currentTarget.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="left-rail-button active" disabled={accountPending} type="submit">
            {accountPending ? "请稍候…" : mode === "register" ? "注册并登录" : "登录"}
          </button>
        </form>
        {accountMessage ? (
          <div aria-live="polite" className="organization-dialog-empty">
            {accountMessage}
          </div>
        ) : null}
        <div className="organization-form-field">
          <span>仅用于路演兼容</span>
          <button
            className="left-rail-button muted"
            disabled={accountPending}
            onClick={onSubmitDemoLogin}
            type="button"
          >
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
