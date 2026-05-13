import { useEffect, useState } from "react";
import { createCloudAccountSession } from "./accountSessionRuntime";
import {
  clearStoredAccountSession,
  loadStoredAccountSession,
  storeAccountSession
} from "./accountSessionStorage";
import type { AccountTransport } from "./accountSessionClient";
import type { AccountSession } from "./account.types";
import type { SettingsState } from "../settings/settings.types";

type UseAccountSessionInput = {
  accountTransport?: AccountTransport;
  getSettings: () => SettingsState;
};

export function useAccountSession({ accountTransport, getSettings }: UseAccountSessionInput) {
  const [accountSession, setAccountSession] = useState<AccountSession | null>(null);
  const [accountPending, setAccountPending] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | undefined>();

  useEffect(() => {
    const storedSession = loadStoredAccountSession();
    if (storedSession) {
      setAccountSession(storedSession);
      setAccountMessage("已恢复本地云账号会话。");
    }
  }, []);

  async function loginToCloudAccount() {
    setAccountPending(true);
    setAccountMessage("正在连接开发云账号...");

    try {
      const session = await createCloudAccountSession(getSettings(), {
        transport: accountTransport
      });
      setAccountSession(session);
      storeAccountSession(session);
      setAccountMessage("已连接开发云账号，会话已保存在本地。");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知错误";
      setAccountMessage(`开发云账号连接失败。详细信息：${detail}`);
    } finally {
      setAccountPending(false);
    }
  }

  function logoutFromCloudAccount() {
    setAccountSession(null);
    clearStoredAccountSession();
    setAccountMessage("已断开当前云账号会话。");
  }

  return {
    accountMessage,
    accountPending,
    accountSession,
    loginToCloudAccount,
    logoutFromCloudAccount
  };
}
