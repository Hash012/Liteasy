import { type PropsWithChildren, useEffect, useMemo, useState } from "react";
import {
  Button,
  FluentProvider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  webLightTheme
} from "@fluentui/react-components";
import { ShieldLockRegular } from "@fluentui/react-icons";
import {
  beginAdminLogin,
  completeAdminLogin,
  logoutAdmin,
  restoreAdminSession
} from "./auth";
import { createAdminApiClient } from "./api";
import { AdminWorkspace } from "./AdminWorkspace";
import {
  loadAdminRuntimeConfig
} from "./runtimeConfig";
import type { AdminSession } from "./types";
import "./styles.css";

type SessionState =
  | { kind: "loading" }
  | { error?: string; kind: "anonymous" }
  | { kind: "authenticated"; session: AdminSession };

export function AdminProvider({ children }: PropsWithChildren) {
  return <FluentProvider applyStylesToPortals={false} className="admin-provider" theme={webLightTheme}>{children}</FluentProvider>;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "身份请求失败。";
}

export function App() {
  const config = useMemo(() => loadAdminRuntimeConfig(), []);
  const [sessionState, setSessionState] = useState<SessionState>({ kind: "loading" });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const callbackSession = await completeAdminLogin(config);
        const session = callbackSession ?? await restoreAdminSession(config);
        if (active) {
          setSessionState(session
            ? { kind: "authenticated", session }
            : { kind: "anonymous" });
        }
      } catch (error) {
        if (active) setSessionState({ error: message(error), kind: "anonymous" });
      }
    })();
    return () => {
      active = false;
    };
  }, [config]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await beginAdminLogin(config);
    } catch (error) {
      setSessionState({ error: message(error), kind: "anonymous" });
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    if (sessionState.kind !== "authenticated") return;
    setSessionState({ kind: "loading" });
    await logoutAdmin(config);
    setSessionState({ kind: "anonymous" });
  }

  if (sessionState.kind === "loading") {
    return (
      <AdminProvider>
        <main className="admin-loading"><Spinner label="正在验证管理员身份" /></main>
      </AdminProvider>
    );
  }

  if (sessionState.kind === "anonymous") {
    return (
      <AdminProvider>
        <main className="admin-signin">
          <section className="admin-signin-panel" aria-labelledby="admin-signin-title">
            <ShieldLockRegular aria-hidden className="admin-signin-icon" />
            <h1 id="admin-signin-title">Liteasy 管理后台</h1>
            {sessionState.error ? (
              <MessageBar intent="error">
                <MessageBarBody><MessageBarTitle>登录失败</MessageBarTitle>{sessionState.error}</MessageBarBody>
              </MessageBar>
            ) : null}
            <form className="admin-signin-form" onSubmit={login}>
              <Button appearance="primary" disabled={submitting} icon={<ShieldLockRegular />} type="submit">
                {submitting ? "正在跳转" : "使用统一账号登录"}
              </Button>
            </form>
          </section>
        </main>
      </AdminProvider>
    );
  }

  const api = createAdminApiClient({
    accessToken: sessionState.session.accessToken,
    cloudUrl: config.cloudUrl,
    forumUrl: config.forumUrl
  });
  return (
    <AdminProvider>
      <AdminWorkspace
        api={api}
        onLogout={logout}
        onReauthenticate={() => beginAdminLogin(config)}
        session={sessionState.session}
      />
    </AdminProvider>
  );
}
