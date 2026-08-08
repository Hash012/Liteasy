import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import type { IdentityMode, IdentitySession } from "./identity.types";
import { intuechoApiBaseUrl } from "./runtimeConfig";

const oauthSessionProjectionKey = "intuecho.auth.oauth-session.v1";
const audience = "intuecho-web";

type WebIdentityConfiguration = {
  audience: "intuecho-web";
  authorizationFlow: "authorization_code_pkce";
  clientId: string;
  issuer: string;
};

let identityModePromise: Promise<IdentityMode> | null = null;
let oauthManagerPromise: Promise<UserManager> | null = null;
let authRequiredHandler: (() => void) | null = null;

export function setAuthRequiredHandler(handler: (() => void) | null) {
  authRequiredHandler = handler;
}

export function notifyAuthenticationRequired() {
  authRequiredHandler?.();
}

export function readIdentitySession(): IdentitySession | null {
  return readStoredSession(sessionStorage, oauthSessionProjectionKey);
}

function readStoredSession(storage: Storage, key: string) {
  try {
    const value = storage.getItem(key);
    if (!value) return null;
    const session = JSON.parse(value) as IdentitySession;
    return session.audience === audience && session.sessionId && session.userId ? session : null;
  } catch {
    return null;
  }
}

function storeSession(storage: Storage, key: string, session: IdentitySession | null) {
  if (session) storage.setItem(key, JSON.stringify(session));
  else storage.removeItem(key);
}

function loopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname);
  } catch {
    return false;
  }
}

function validateWebIdentityConfiguration(value: unknown): WebIdentityConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("身份服务配置无效。");
  }
  const candidate = value as Partial<WebIdentityConfiguration>;
  if (
    candidate.audience !== audience ||
    candidate.authorizationFlow !== "authorization_code_pkce" ||
    typeof candidate.clientId !== "string" ||
    !/^[A-Za-z0-9._~-]{1,200}$/.test(candidate.clientId) ||
    typeof candidate.issuer !== "string"
  ) {
    throw new Error("身份服务配置无效。");
  }
  const issuer = new URL(candidate.issuer);
  if (
    issuer.username || issuer.password || issuer.search || issuer.hash ||
    (issuer.protocol !== "https:" && !(import.meta.env.DEV && loopbackUrl(candidate.issuer)))
  ) {
    throw new Error("身份服务配置无效。");
  }
  return candidate as WebIdentityConfiguration;
}

async function identityMode() {
  identityModePromise ??= (async () => {
    let response;
    try {
      response = await fetch(`${intuechoApiBaseUrl}/v1/identity/web-config`, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
    } catch {
      return "unavailable" as const;
    }
    if (response.ok) {
      validateWebIdentityConfiguration(await response.json());
      return "oauth" as const;
    }
    if (response.status === 404 && import.meta.env.DEV) {
      const { developmentIdentity } = await import("./developmentIdentity");
      if (developmentIdentity.available(intuechoApiBaseUrl)) return "development" as const;
    }
    return "unavailable" as const;
  })();
  return identityModePromise;
}

async function loadWebIdentityConfiguration() {
  const response = await fetch(`${intuechoApiBaseUrl}/v1/identity/web-config`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error("统一身份服务暂时不可用。");
  return validateWebIdentityConfiguration(await response.json());
}

async function oauthManager() {
  oauthManagerPromise ??= (async () => {
    const configuration = await loadWebIdentityConfiguration();
    const redirectUri = `${window.location.origin}${window.location.pathname}`;
    const manager = new UserManager({
      authority: configuration.issuer,
      automaticSilentRenew: true,
      client_id: configuration.clientId,
      extraQueryParams: { audience },
      loadUserInfo: true,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile email",
      stateStore: new WebStorageStateStore({ store: sessionStorage }),
      userStore: new WebStorageStateStore({ store: sessionStorage })
    });
    manager.events.addUserLoaded((value) => {
      storeSession(sessionStorage, oauthSessionProjectionKey, sessionFromOauthUser(value));
    });
    manager.events.addUserUnloaded(() => {
      storeSession(sessionStorage, oauthSessionProjectionKey, null);
    });
    return manager;
  })();
  return oauthManagerPromise;
}

function sessionFromOauthUser(user: User): IdentitySession {
  const name = typeof user.profile.name === "string" ? user.profile.name :
    typeof user.profile.preferred_username === "string" ? user.profile.preferred_username : "";
  if (!user.access_token || !user.profile.sub || !name || !user.expires_at) {
    throw new Error("统一身份服务返回了无效会话。");
  }
  return {
    audience,
    email: typeof user.profile.email === "string" ? user.profile.email : "",
    expiresAt: new Date(user.expires_at * 1000).toISOString(),
    name,
    sessionId: user.access_token,
    userId: user.profile.sub
  };
}

async function validOauthSession() {
  const manager = await oauthManager();
  let value = await manager.getUser();
  if (value?.expired) {
    value = await manager.signinSilent().catch(() => null);
  }
  if (!value || value.expired) {
    storeSession(sessionStorage, oauthSessionProjectionKey, null);
    return null;
  }
  const session = sessionFromOauthUser(value);
  storeSession(sessionStorage, oauthSessionProjectionKey, session);
  return session;
}

export async function resolveIdentitySession() {
  const mode = await identityMode();
  if (mode === "oauth") return validOauthSession();
  if (mode === "development" && import.meta.env.DEV) {
    const { developmentIdentity } = await import("./developmentIdentity");
    return developmentIdentity.read();
  }
  return null;
}

export async function clearRejectedIdentitySession() {
  storeSession(sessionStorage, oauthSessionProjectionKey, null);
  if (import.meta.env.DEV) {
    const { developmentIdentity } = await import("./developmentIdentity");
    developmentIdentity.clear();
  }
  notifyAuthenticationRequired();
}

export const identityApi = {
  beginOAuthLogin: async () => {
    if (await identityMode() !== "oauth") throw new Error("统一身份登录尚未配置。");
    await (await oauthManager()).signinRedirect();
  },
  initialize: async (): Promise<{ mode: IdentityMode; session: IdentitySession | null }> => {
    const mode = await identityMode();
    if (mode === "oauth") {
      const callback = new URLSearchParams(window.location.search);
      if (callback.has("code") && callback.has("state")) {
        await (await oauthManager()).signinRedirectCallback(window.location.href);
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
      }
      return { mode, session: await validOauthSession() };
    }
    if (mode === "development" && import.meta.env.DEV) {
      const { developmentIdentity } = await import("./developmentIdentity");
      return { mode, session: await developmentIdentity.restore() };
    }
    return { mode, session: null };
  },
  logout: async () => {
    const mode = await identityMode();
    if (mode === "oauth") {
      const manager = await oauthManager();
      await manager.revokeTokens(["access_token", "refresh_token"]).catch(() => undefined);
      await manager.removeUser();
      storeSession(sessionStorage, oauthSessionProjectionKey, null);
      return;
    }
    if (mode !== "development" || !import.meta.env.DEV) return;
    const { developmentIdentity } = await import("./developmentIdentity");
    await developmentIdentity.logout();
  }
};
