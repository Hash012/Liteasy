import type { AccountSession } from "./account.types";

type AccountStatusPanelProps = {
  message?: string;
  pending?: boolean;
  session: AccountSession | null;
  onLogin: () => void;
  onLogout: () => void;
};

export function AccountStatusPanel({
  message,
  onLogin,
  onLogout,
  pending = false,
  session
}: AccountStatusPanelProps) {
  return (
    <div className="account-status-card">
      <div className="account-status-title">云账号</div>
      {session ? (
        <>
          <div className="account-status-name">{session.name}</div>
          <div className="account-status-email">{session.email}</div>
          <div className="account-status-meta">会话有效期：{session.expiresAt}</div>
          <button className="account-status-button ghost" onClick={onLogout} type="button">
            断开云账号
          </button>
        </>
      ) : (
        <>
          <div className="account-status-meta">当前未连接云账号。可先连接开发云会话，再体验同步与推荐功能。</div>
          <button
            className="account-status-button"
            disabled={pending}
            onClick={onLogin}
            type="button"
          >
            {pending ? "连接中..." : "连接开发云账号"}
          </button>
        </>
      )}
      {message ? <div className="account-status-message">{message}</div> : null}
    </div>
  );
}
