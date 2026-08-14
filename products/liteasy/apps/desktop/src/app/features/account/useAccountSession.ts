import { formatCloudConnectionError } from "../network/cloudErrorMessage";
import { useEffect, useState } from "react";
import {
  createAuthenticatedCloudAccountSession,
  createRegisteredCloudAccountSession,
  revokeCloudAccountSession,
  validateStoredCloudAccountSession
} from "./accountSessionRuntime";
import {
  clearStoredAccountSession,
  loadSuppressLoginReminderPreference,
  loadStoredAccountSession,
  storeAccountSession,
  storeSuppressLoginReminderPreference
} from "./accountSessionStorage";
import type {
  AccountLoginInput,
  AccountRegistrationInput,
  AccountTransport
} from "./accountSessionClient";
import type { AccountSession } from "./account.types";
import type { SettingsState } from "../settings/settings.types";
import {
  isDesktopIdentityHostAvailable,
  loginWithSystemBrowser,
  restoreSystemBrowserSession,
  revokeSystemBrowserSession,
  type DesktopIdentityInvoke
} from "./desktopIdentityClient";

type UseAccountSessionInput = {
  accountTransport?: AccountTransport;
  desktopIdentityInvoke?: DesktopIdentityInvoke;
  desktopIdentityHostAvailable?: boolean;
  desktopIdentityFetch?: typeof fetch;
  getSettings: () => SettingsState;
};

const oauthRefreshLeadMs = 60_000;
const oauthRefreshRetryMs = 15_000;
const maximumTimerDelayMs = 2_147_000_000;

export function useAccountSession({
  accountTransport,
  desktopIdentityHostAvailable = isDesktopIdentityHostAvailable(),
  desktopIdentityFetch,
  desktopIdentityInvoke,
  getSettings
}: UseAccountSessionInput) {
  const [accountSession, setAccountSession] = useState<AccountSession | null>(null);
  const [accountPending, setAccountPending] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | undefined>();
  const [authenticationMode, setAuthenticationMode] = useState<"development" | "oauth" | null>(null);
  const [shouldShowLoginReminder, setShouldShowLoginReminder] = useState(
    !loadSuppressLoginReminderPreference()
  );

  useEffect(() => {
    const storedSession = loadStoredAccountSession();
    if (storedSession) {
      setAccountSession(storedSession);
      setAccountMessage("已恢复本地云账号会话。");

      if (storedSession.sessionId.startsWith("ltsy_")) {
        void validateStoredCloudAccountSession(getSettings(), storedSession.sessionId, {
          transport: accountTransport
        })
          .then((validatedSession) => {
            setAccountSession(storeAccountSession(validatedSession));
            setAccountMessage("云账号会话有效。");
          })
          .catch(() => {
            setAccountSession(null);
            clearStoredAccountSession();
            setAccountMessage("登录会话已过期，请重新登录。");
          });
      }
      return;
    }
    if (desktopIdentityHostAvailable) {
      setAccountPending(true);
      void restoreSystemBrowserSession({
        endpoint: getSettings()["models.control_plane_endpoint"],
        fetchImpl: desktopIdentityFetch,
        invoke: desktopIdentityInvoke
      })
        .then((restoredSession) => {
          setAccountSession(storeAccountSession(restoredSession));
          setAuthenticationMode("oauth");
          setAccountMessage("登录会话已从操作系统安全存储恢复。");
        })
        .catch((error) => {
          const code = error instanceof Error ? error.message : String(error);
          if (!code.includes("oauth_session_not_found") && !code.includes("oauth_configuration_unavailable")) {
            setAccountMessage("无法恢复登录会话，请重新登录。");
          }
        })
        .finally(() => setAccountPending(false));
    }
  }, []);

  useEffect(() => {
    if (!desktopIdentityHostAvailable || authenticationMode !== "oauth" || !accountSession) {
      return;
    }
    const expiresAt = Date.parse(accountSession.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function scheduleRefresh() {
      const delayMs = Math.max(0, expiresAt - Date.now() - oauthRefreshLeadMs);
      timer = setTimeout(
        delayMs > maximumTimerDelayMs ? scheduleRefresh : () => void refreshSession(),
        Math.min(delayMs, maximumTimerDelayMs)
      );
    }

    async function refreshSession() {
      try {
        const refreshedSession = await restoreSystemBrowserSession({
          endpoint: getSettings()["models.control_plane_endpoint"],
          fetchImpl: desktopIdentityFetch,
          invoke: desktopIdentityInvoke
        });
        if (cancelled) return;
        setAccountSession(storeAccountSession(refreshedSession));
        setAccountMessage("登录会话已自动续期。");
      } catch {
        if (cancelled) return;
        const remainingMs = expiresAt - Date.now();
        if (remainingMs <= 0) {
          setAccountSession(null);
          clearStoredAccountSession();
          setAuthenticationMode(null);
          setAccountMessage("登录会话已过期，请重新登录。");
          return;
        }
        timer = setTimeout(() => void refreshSession(), Math.min(oauthRefreshRetryMs, remainingMs));
      }
    }

    scheduleRefresh();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accountSession, authenticationMode, desktopIdentityFetch, desktopIdentityHostAvailable, desktopIdentityInvoke]);

  async function loginPersonalAccountWithSystemBrowser() {
    setAccountPending(true);
    setAccountMessage("正在打开系统浏览器进行安全登录...");
    try {
      const session = await loginWithSystemBrowser({
        endpoint: getSettings()["models.control_plane_endpoint"],
        fetchImpl: desktopIdentityFetch,
        invoke: desktopIdentityInvoke
      });
      setAccountSession(storeAccountSession(session));
      setAuthenticationMode("oauth");
      setAccountMessage("登录成功；刷新凭据已保存在操作系统安全存储中。");
      return session;
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      setAccountMessage(code.includes("oauth_authorization_denied")
        ? "登录已取消。"
        : "系统浏览器登录失败，请检查身份服务配置后重试。");
      return null;
    } finally {
      setAccountPending(false);
    }
  }

  async function loginPersonalAccount(login: AccountLoginInput) {
    setAccountPending(true);
    setAccountMessage("正在登录账号...");

    try {
      const session = await createAuthenticatedCloudAccountSession(getSettings(), login, {
        transport: accountTransport
      });
      setAccountSession(storeAccountSession(session));
      setAuthenticationMode("development");
      setAccountMessage("本地开发登录成功；会话仅在本次运行期间保留。");
      return session;
    } catch (error) {
      const detail = formatCloudConnectionError(error, {
        controlPlaneEndpoint: getSettings()["models.control_plane_endpoint"]
      });
      setAccountMessage(`账号登录失败。详细信息：${detail}`);
      return null;
    } finally {
      setAccountPending(false);
    }
  }

  async function registerPersonalAccount(registration: AccountRegistrationInput) {
    setAccountPending(true);
    setAccountMessage("正在注册云账号...");

    try {
      const session = await createRegisteredCloudAccountSession(getSettings(), registration, {
        transport: accountTransport
      });
      setAccountSession(storeAccountSession(session));
      setAuthenticationMode("development");
      setAccountMessage("本地开发账号已创建；会话仅在本次运行期间保留。");
      return session;
    } catch (error) {
      const detail = formatCloudConnectionError(error, {
        controlPlaneEndpoint: getSettings()["models.control_plane_endpoint"]
      });
      setAccountMessage(`云账号注册失败。详细信息：${detail}`);
      return null;
    } finally {
      setAccountPending(false);
    }
  }

  function logoutFromCloudAccount() {
    const sessionId = accountSession?.sessionId;
    setAccountSession(null);
    clearStoredAccountSession();
    setAccountMessage("已断开当前云账号会话。");

    if (authenticationMode === "oauth") {
      void revokeSystemBrowserSession({
        endpoint: getSettings()["models.control_plane_endpoint"],
        fetchImpl: desktopIdentityFetch,
        invoke: desktopIdentityInvoke
      }).catch(() => {
        // The local credential is removed by the host before remote revocation.
      });
    } else if (sessionId?.startsWith("ltsy_")) {
      void revokeCloudAccountSession(getSettings(), sessionId, {
        transport: accountTransport
      }).catch(() => {
        // Local logout is immediate. An expired server session is harmless and
        // will be cleaned up automatically even if the network is unavailable.
      });
    }
  }

  function setSuppressLoginReminder(suppressed: boolean) {
    storeSuppressLoginReminderPreference(suppressed);
    setShouldShowLoginReminder(!suppressed);
  }

  return {
    accountMessage,
    accountPending,
    accountSession,
    loginPersonalAccountWithSystemBrowser,
    loginPersonalAccount,
    logoutFromCloudAccount,
    registerPersonalAccount,
    setSuppressLoginReminder,
    shouldShowLoginReminder
  };
}
