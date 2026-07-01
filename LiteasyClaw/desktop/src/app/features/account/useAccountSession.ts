import { formatCloudConnectionError } from "../network/cloudErrorMessage";
import { useEffect, useRef, useState } from "react";
import {
  createCloudAccountSession,
  createRegisteredCloudAccountSession
} from "./accountSessionRuntime";
import {
  clearStoredAccountSession,
  loadSuppressLoginReminderPreference,
  loadStoredAccountSession,
  storeAccountSession,
  storeSuppressLoginReminderPreference
} from "./accountSessionStorage";
import type { AccountRegistrationInput, AccountTransport } from "./accountSessionClient";
import type { AccountSession } from "./account.types";
import type { SettingsState } from "../settings/settings.types";

type UseAccountSessionInput = {
  accountTransport?: AccountTransport;
  getSettings: () => SettingsState;
  onSessionRestored?: () => void;
};

export function useAccountSession({ accountTransport, getSettings, onSessionRestored }: UseAccountSessionInput) {
  const onSessionRestoredRef = useRef(onSessionRestored);
  onSessionRestoredRef.current = onSessionRestored;
  const [accountSession, setAccountSession] = useState<AccountSession | null>(null);
  const [accountPending, setAccountPending] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | undefined>();
  const [shouldShowLoginReminder, setShouldShowLoginReminder] = useState(
    !loadSuppressLoginReminderPreference()
  );

  useEffect(() => {
    const storedSession = loadStoredAccountSession();
    if (storedSession) {
      onSessionRestoredRef.current?.();
      setAccountSession(storedSession);
      setAccountMessage("已恢复本地云账号会话。");
    }
  }, []);

  async function loginToCloudAccount() {
    setAccountPending(true);
    setAccountMessage("正在登录云账号...");

    try {
      const session = await createCloudAccountSession(getSettings(), {
        transport: accountTransport
      });
      setAccountSession(session);
      storeAccountSession(session);
      setAccountMessage("已登录云账号，会话已保存在本地。");
    } catch (error) {
      const detail = formatCloudConnectionError(error, {
        controlPlaneEndpoint: getSettings()["models.control_plane_endpoint"]
      });
      setAccountMessage(`云账号登录失败。详细信息：${detail}`);
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
      setAccountSession(session);
      storeAccountSession(session);
      setAccountMessage("已注册并登录云账号，会话已保存在本地。");
    } catch (error) {
      const detail = formatCloudConnectionError(error, {
        controlPlaneEndpoint: getSettings()["models.control_plane_endpoint"]
      });
      setAccountMessage(`云账号注册失败。详细信息：${detail}`);
    } finally {
      setAccountPending(false);
    }
  }

  function logoutFromCloudAccount() {
    setAccountSession(null);
    clearStoredAccountSession();
    setAccountMessage("已断开当前云账号会话。");
  }

  function setSuppressLoginReminder(suppressed: boolean) {
    storeSuppressLoginReminderPreference(suppressed);
    setShouldShowLoginReminder(!suppressed);
  }

  return {
    accountMessage,
    accountPending,
    accountSession,
    loginToCloudAccount,
    logoutFromCloudAccount,
    registerPersonalAccount,
    setSuppressLoginReminder,
    shouldShowLoginReminder
  };
}
