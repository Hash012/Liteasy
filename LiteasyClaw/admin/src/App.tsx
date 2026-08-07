import { useEffect, useMemo, useState } from "react";
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
      <FluentProvider className="admin-provider" theme={webLightTheme}>
        <main className="admin-loading"><Spinner label="正在验证管理员身份" /></main>
      </FluentProvider>
    );
  }

  if (sessionState.kind === "anonymous") {
    return (
      <FluentProvider className="admin-provider" theme={webLightTheme}>
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
              <Button appearance="primary" disabled={submitting} type="submit">
                {submitting ? "正在登录" : "登录"}
              </Button>
            </form>
          </section>
        </main>
      </FluentProvider>
    );
  }

  const api = createAdminApiClient({
    accessToken: sessionState.session.accessToken,
    cloudUrl: config.cloudUrl,
    forumUrl: config.forumUrl
  });
  return (
    <FluentProvider className="admin-provider" theme={webLightTheme}>
      <AdminWorkspace
        api={api}
        onLogout={logout}
        onReauthenticate={() => beginAdminLogin(config, "login")}
        session={sessionState.session}
      />
    </FluentProvider>
  );
}
