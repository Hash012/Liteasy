import { getRecoveryRuntime } from "../local-recovery/runtimeProfile";
import { restoreWebDavPreferences, reportWebDavRestoreError } from "../webdav/webdavPreferences";
import { CloudServiceError, formatCloudConnectionError } from "../network/cloudErrorMessage";
import { useEffect, useRef, useState } from "react";
import {
  createAuthenticatedCloudAccountSession,
  createRegisteredCloudAccountSession,
  revokeCloudAccountSession,
  validateStoredCloudAccountSession
} from "./accountSessionRuntime";
import {
  clearStoredAccountSession,
  getAccountSessionGeneration,
  loadSuppressLoginReminderPreference,
  loadStoredAccountSession,
  replaceRefreshedAccountSession,
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
import { registerAccountSessionRefresher } from "./accountAuthenticatedFetch";

type UseAccountSessionInput = {
  accountTransport?: AccountTransport;
  desktopIdentityInvoke?: DesktopIdentityInvoke;
  desktopIdentityHostAvailable?: boolean;
  desktopIdentityFetch?: typeof fetch;
  getSettings: () => SettingsState;
  onSessionRestored?: () => void;
};

export function useAccountSession({
  accountTransport,
  desktopIdentityHostAvailable = isDesktopIdentityHostAvailable(),
  desktopIdentityFetch,
  desktopIdentityInvoke,
  getSettings,
  onSessionRestored
}: UseAccountSessionInput) {
  const requestGeneration = useRef(0);
  const settingsRef = useRef(getSettings);
  settingsRef.current = getSettings;
  const onSessionRestoredRef = useRef(onSessionRestored);
  onSessionRestoredRef.current = onSessionRestored;
  const [accountSession, setAccountSession] = useState<AccountSession | null>(null);
  const [accountPending, setAccountPending] = useState(false);
  const accountPendingRef = useRef(accountPending);
  accountPendingRef.current = accountPending;
  const refreshInFlight = useRef<{ generation: string; promise: Promise<void> } | null>(null);
  const [accountMessage, setAccountMessage] = useState<string | undefined>();
  const [authenticationMode, setAuthenticationMode] = useState<"development" | "oauth" | null>(null);
  const [shouldShowLoginReminder, setShouldShowLoginReminder] = useState(
    !loadSuppressLoginReminderPreference()
  );

  function beginRequest() {
    const generation = ++requestGeneration.current;
    const endpoint = settingsRef.current()["models.control_plane_endpoint"];
    return () => requestGeneration.current === generation &&
      settingsRef.current()["models.control_plane_endpoint"] === endpoint;
  }

  function invalidateSession() {
    clearStoredAccountSession();
    setAccountSession(null);
    setAuthenticationMode(null);
    setAccountMessage("登录会话已过期，请重新登录；本地资料仍可使用。");
  }

  async function refreshAccountSession(force = false): Promise<void> {
    const stored = loadStoredAccountSession();
    if (!stored || authenticationMode !== "oauth") return;
    const generation = getAccountSessionGeneration();
    if (refreshInFlight.current?.generation === generation) return refreshInFlight.current.promise;
    if (accountPendingRef.current) throw new Error("oauth_session_changed");
    if (!force && Date.parse(stored.expiresAt) > Date.now() + 60_000) return;
    const request = requestGeneration.current;
    const endpoint = settingsRef.current()["models.control_plane_endpoint"].replace(/\/+$/, "");
    const isCurrent = () => requestGeneration.current === request &&
      generation === getAccountSessionGeneration() &&
      settingsRef.current()["models.control_plane_endpoint"].replace(/\/+$/, "") === endpoint;
    if (stored.endpoint !== endpoint) {
      invalidateSession();
      throw new Error("oauth_session_configuration_mismatch");
    }
    const promise = (async () => {
      try {
        const renewed = await restoreSystemBrowserSession({
          endpoint,
          fetchImpl: desktopIdentityFetch,
          invoke: desktopIdentityInvoke,
          isCurrent,
          refresh: true
        });
        if (!isCurrent()) throw new Error("oauth_session_changed");
        if (renewed.issuer !== stored.issuer || renewed.userId !== stored.userId ||
          !(Date.parse(renewed.expiresAt) > Date.now())) throw new Error("oauth_session_invalid");
        setAccountSession(replaceRefreshedAccountSession(renewed, generation));
        setAccountMessage("云账号会话有效。");
      } catch (error) {
        if (!isCurrent()) throw error;
        const code = error instanceof Error ? error.message : String(error);
        if (["oauth_session_expired", "oauth_session_not_found", "oauth_session_invalid",
          "oauth_session_configuration_mismatch", "oauth_verified_subject_missing"].some((value) => code.includes(value))) {
          invalidateSession();
        } else if (!code.includes("oauth_session_changed")) {
          // Keep the secure credential available for retries, but stop showing an expired login.
          if (!(Date.parse(stored.expiresAt) > Date.now())) setAccountSession(null);
          setAccountMessage("登录续期暂时失败，请检查网络；连接恢复后会自动重试，本地资料仍可使用。");
        }
        throw error;
      }
    })();
    refreshInFlight.current = { generation, promise };
    try { await promise; }
    finally { if (refreshInFlight.current?.promise === promise) refreshInFlight.current = null; }
  }

  const refreshSessionRef = useRef(refreshAccountSession);
  refreshSessionRef.current = refreshAccountSession;
  useEffect(() => {
    if (authenticationMode !== "oauth") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const unregister = registerAccountSessionRefresher({
      refresh: (force) => refreshSessionRef.current(force),
      invalidate: invalidateSession
    });
    function schedule() {
      if (stopped) return;
      const session = loadStoredAccountSession();
      if (!session) return;
      const untilRefresh = Date.parse(session.expiresAt) - Date.now() - 60_000;
      const delay = Number.isFinite(untilRefresh) ? Math.min(60_000, Math.max(15_000, untilRefresh)) : 15_000;
      timer = setTimeout(() => {
        void refreshSessionRef.current().catch(() => {}).finally(schedule);
      }, delay);
    }
    const resume = () => { void refreshSessionRef.current().catch(() => {}); };
    const visible = () => { if (document.visibilityState === "visible") resume(); };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", visible);
    schedule();
    return () => {
      stopped = true;
      clearTimeout(timer);
      unregister();
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [authenticationMode]);

  useEffect(() => {
    const isCurrent = beginRequest();
    const cleanup = () => { ++requestGeneration.current; };
    if (getRecoveryRuntime()) { clearStoredAccountSession(); setShouldShowLoginReminder(false); return cleanup; }
    const storedSession = loadStoredAccountSession();
    if (storedSession) {
      onSessionRestoredRef.current?.();
      setAccountSession(storedSession);
      setAuthenticationMode(storedSession.sessionId.startsWith("ltsy_") ? "development" : desktopIdentityHostAvailable ? "oauth" : null);
      setAccountMessage("已恢复本地云账号会话。");

      if (storedSession.sessionId.startsWith("ltsy_")) {
        void validateStoredCloudAccountSession(getSettings(), storedSession.sessionId, {
          transport: accountTransport
        })
          .then((validatedSession) => {
            if (!isCurrent()) return;
            setAccountSession(storeAccountSession(validatedSession));
            setAccountMessage("云账号会话有效。");
          })
          .catch((error) => {
            if (!isCurrent()) return;
            if (error instanceof CloudServiceError && error.status === 401) {
              setAccountSession(null);
              clearStoredAccountSession();
              setAccountMessage("登录会话已过期，请重新登录。");
            } else {
              setAccountMessage(error instanceof CloudServiceError && error.status === 403
                ? "当前账号无权访问此云服务；本地资料仍可使用。"
                : "暂时无法验证云账号会话，请检查网络后重试；本地资料仍可使用。");
            }
          });
      }
      return cleanup;
    }
    if (desktopIdentityHostAvailable) {
      setAccountPending(true);
      void restoreSystemBrowserSession({
        endpoint: getSettings()["models.control_plane_endpoint"],
        fetchImpl: desktopIdentityFetch,
        invoke: desktopIdentityInvoke,
        isCurrent
      })
        .then(async (restoredSession) => {
          if (!isCurrent()) return;
          storeAccountSession(restoredSession);
          await restoreWebDavPreferences(isCurrent).catch((error) => { if (isCurrent()) reportWebDavRestoreError(error); });
          if (!isCurrent()) return;
          setAccountSession(storeAccountSession(restoredSession));
          setAuthenticationMode("oauth");
          setAccountMessage("登录会话已从操作系统安全存储恢复。");
          onSessionRestoredRef.current?.();
        })
        .catch((error) => {
          if (!isCurrent()) return;
          const code = error instanceof Error ? error.message : String(error);
          if (code.startsWith("oauth_configuration_")) {
            setAccountMessage("账号服务配置错误，请检查服务端点和身份服务配置。");
          } else if (code.includes("oauth_session_expired")) {
            setAccountMessage("登录会话已过期，请重新登录；本地资料仍可使用。");
          } else if (!code.includes("oauth_session_not_found")) {
            setAccountMessage("暂时无法恢复云账号会话，请检查网络后重试；本地资料仍可使用。");
          }
        })
        .finally(() => { if (isCurrent()) setAccountPending(false); });
    }
    return cleanup;
  }, []);

  async function loginPersonalAccountWithSystemBrowser() {
    if (getRecoveryRuntime()) { setAccountMessage("隔离恢复资料保持离线，请在原工作区登录。"); return null; }
    const isCurrent = beginRequest();
    setAccountPending(true);
    setAccountMessage("正在打开系统浏览器进行安全登录...");
    try {
      const session = await loginWithSystemBrowser({
        endpoint: getSettings()["models.control_plane_endpoint"],
        fetchImpl: desktopIdentityFetch,
        invoke: desktopIdentityInvoke,
        isCurrent
      });
      if (!isCurrent()) return null;
      storeAccountSession(session);
      await restoreWebDavPreferences(isCurrent).catch((error) => { if (isCurrent()) reportWebDavRestoreError(error); });
      if (!isCurrent()) return null;
      setAccountSession(storeAccountSession(session));
      setAuthenticationMode("oauth");
      setAccountMessage("登录成功；刷新凭据已保存在操作系统安全存储中。");
      return session;
    } catch (error) {
      if (!isCurrent()) return null;
      const code = error instanceof Error ? error.message : String(error);
      setAccountMessage(code.includes("oauth_authorization_denied")
        ? "登录已取消。"
        : code.startsWith("oauth_configuration_")
        ? "账号服务配置错误，请检查服务端点和身份服务配置。"
        : "系统浏览器登录失败，请检查身份服务配置后重试。");
      return null;
    } finally {
      if (isCurrent()) setAccountPending(false);
    }
  }

  async function loginPersonalAccount(login: AccountLoginInput) {
    if (getRecoveryRuntime()) { setAccountMessage("隔离恢复资料保持离线，请在原工作区登录。"); return null; }
    const isCurrent = beginRequest();
    setAccountPending(true);
    setAccountMessage("正在登录账号...");

    try {
      const session = await createAuthenticatedCloudAccountSession(getSettings(), login, {
        transport: accountTransport
      });
      if (!isCurrent()) return null;
      setAccountSession(storeAccountSession(session));
      setAuthenticationMode("development");
      setAccountMessage("本地开发登录成功；会话仅在本次运行期间保留。");
      return session;
    } catch (error) {
      if (!isCurrent()) return null;
      const detail = formatCloudConnectionError(error, {
        controlPlaneEndpoint: getSettings()["models.control_plane_endpoint"]
      });
      setAccountMessage(`账号登录失败。详细信息：${detail}`);
      return null;
    } finally {
      if (isCurrent()) setAccountPending(false);
    }
  }

  async function registerPersonalAccount(registration: AccountRegistrationInput) {
    if (getRecoveryRuntime()) { setAccountMessage("隔离恢复资料保持离线，请在原工作区登录。"); return null; }
    const isCurrent = beginRequest();
    setAccountPending(true);
    setAccountMessage("正在注册云账号...");

    try {
      const session = await createRegisteredCloudAccountSession(getSettings(), registration, {
        transport: accountTransport
      });
      if (!isCurrent()) return null;
      setAccountSession(storeAccountSession(session));
      setAuthenticationMode("development");
      setAccountMessage("本地开发账号已创建；会话仅在本次运行期间保留。");
      return session;
    } catch (error) {
      if (!isCurrent()) return null;
      const detail = formatCloudConnectionError(error, {
        controlPlaneEndpoint: getSettings()["models.control_plane_endpoint"]
      });
      setAccountMessage(`云账号注册失败。详细信息：${detail}`);
      return null;
    } finally {
      if (isCurrent()) setAccountPending(false);
    }
  }

  function logoutFromCloudAccount() {
    const isCurrent = beginRequest();
    const sessionId = loadStoredAccountSession()?.sessionId;
    setAccountSession(null);
    clearStoredAccountSession();
    setAccountPending(false);
    setAuthenticationMode(null);
    setAccountMessage("已断开本次运行的云账号会话。");

    if (authenticationMode === "oauth" || desktopIdentityHostAvailable) {
      void revokeSystemBrowserSession({
        endpoint: getSettings()["models.control_plane_endpoint"],
        invoke: desktopIdentityInvoke
      }).then((result) => {
        if (!isCurrent()) return;
        setAccountMessage(result.remoteRevocation === "unconfirmed"
          ? "当前设备的登录凭据已清除；远程会话撤销尚未确认。"
          : "已退出当前设备的云账号会话。");
      }).catch(() => {
        if (isCurrent()) setAccountMessage("本次运行已断开云账号；设备凭据清理尚未确认，请重试。");
      });
    } else if (sessionId?.startsWith("ltsy_")) {
      void revokeCloudAccountSession(getSettings(), sessionId, {
        transport: accountTransport
      }).then(() => {
        if (isCurrent()) setAccountMessage("已断开云账号，并撤销当前服务会话。");
      }).catch(() => {
        if (isCurrent()) setAccountMessage("本次运行已断开云账号；远程会话撤销尚未确认。");
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
