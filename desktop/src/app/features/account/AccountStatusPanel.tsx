import type { AccountSession } from "./account.types";

type AccountStatusPanelProps = {
  cloudAvailabilityStatus?: "available" | "unavailable";
  message?: string;
  pending?: boolean;
  session: AccountSession | null;
  onLogin: () => void;
  onLogout: () => void;
};

export function AccountStatusPanel({
  cloudAvailabilityStatus = "available",
  message,
  onLogin,
  onLogout,
  pending = false,
  session
}: AccountStatusPanelProps) {
  const statusTooltip = message
    ? message
    : session
      ? `当前已登录：${session.name}`
      : "当前未登录云账号。联网并登录后，可使用组织、推荐与云端能力；否则将退化为本地阅读器。";

  return (
    <div className="account-status-card">
      <div className="account-status-header">
        <span
          aria-label={`云端能力状态：${cloudAvailabilityStatus === "available" ? "可用" : "不可用"}`}
          className={`account-status-indicator ${cloudAvailabilityStatus}`}
          title={statusTooltip}
        />
      </div>
      {session ? (
        <>
          <button className="account-status-button ghost compact" onClick={onLogout} title={statusTooltip} type="button">
            已登录
          </button>
        </>
      ) : (
        <>
          <button
            className="account-status-button compact"
            disabled={pending}
            onClick={onLogin}
            title={statusTooltip}
            type="button"
          >
            {pending ? "登录中..." : "登录云账号"}
          </button>
        </>
      )}
    </div>
  );
}
