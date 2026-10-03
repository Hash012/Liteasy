import { OidcClient, UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import type { IdentityMode, IdentitySession } from "./identity.types";
import { getIdentitySessionGeneration, invalidateIdentitySession } from "./identitySessionGeneration";
export { getIdentitySessionGeneration } from "./identitySessionGeneration";
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
let oauthSessionAllowed = true;
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
  if (readStoredSession(storage, key)?.userId !== session?.userId || readStoredSession(storage, key)?.issuer !== session?.issuer) invalidateIdentitySession();
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
    const userStore = new WebStorageStateStore({ store: sessionStorage });
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
      userStore: {
        set: (key, value) => oauthSessionAllowed ? userStore.set(key, value) : Promise.resolve(),
        get: (key) => userStore.get(key),
        remove: (key) => userStore.remove(key),
        getAllKeys: () => userStore.getAllKeys()
      }
    });
    manager.events.addUserLoaded((value) => {
      if (!oauthSessionAllowed) return;
      storeSession(sessionStorage, oauthSessionProjectionKey, sessionFromOauthUser(value, configuration.issuer));
    });
    manager.events.addUserUnloaded(() => {
      storeSession(sessionStorage, oauthSessionProjectionKey, null);
    });
    return manager;
  })();
  return oauthManagerPromise;
}

function sessionFromOauthUser(user: User, issuer: string): IdentitySession {
  const name = typeof user.profile.name === "string" ? user.profile.name :
    typeof user.profile.preferred_username === "string" ? user.profile.preferred_username : "";
  if (!user.access_token || !user.profile.sub || !name || !user.expires_at) {
    throw new Error("统一身份服务返回了无效会话。");
  }
  return {
    audience,
    issuer,
    email: typeof user.profile.email === "string" ? user.profile.email : "",
    expiresAt: new Date(user.expires_at * 1000).toISOString(),
    name,
    sessionId: user.access_token,
    userId: user.profile.sub
  };
}

async function validOauthSession() {
  if (!oauthSessionAllowed) return null;
  const generation = getIdentitySessionGeneration();
  const manager = await oauthManager();
  let value = await manager.getUser();
  if (!oauthSessionAllowed || generation !== getIdentitySessionGeneration()) return null;
  if (value?.expired) {
    value = await manager.signinSilent().catch(() => null);
  }
  if (!oauthSessionAllowed || generation !== getIdentitySessionGeneration()) return null;
  if (!value || value.expired) {
    storeSession(sessionStorage, oauthSessionProjectionKey, null);
    return null;
  }
  const session = sessionFromOauthUser(value, manager.settings.authority);
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

export async function isIdentitySessionCurrent(
  expected: IdentitySession | null,
  generation = getIdentitySessionGeneration()
) {
  const mode = await identityMode();
  let current = readIdentitySession();
  if (mode === "development" && import.meta.env.DEV) {
    const { developmentIdentity } = await import("./developmentIdentity");
    current = developmentIdentity.read();
  }
  return generation === getIdentitySessionGeneration() &&
    current?.sessionId === expected?.sessionId && current?.userId === expected?.userId;
}

export async function clearRejectedIdentitySession(
  expected: IdentitySession,
  generation = getIdentitySessionGeneration()
) {
  if (!await isIdentitySessionCurrent(expected, generation)) return;
  if (await identityMode() === "development" && import.meta.env.DEV) {
    const { developmentIdentity } = await import("./developmentIdentity");
    // Recheck after the lazy import; a new login must survive an older 401.
    if (generation !== getIdentitySessionGeneration() || developmentIdentity.read()?.sessionId !== expected.sessionId) return;
    developmentIdentity.clear();
  } else {
    if (generation !== getIdentitySessionGeneration() || readIdentitySession()?.sessionId !== expected.sessionId) return;
    oauthSessionAllowed = false;
    storeSession(sessionStorage, oauthSessionProjectionKey, null);
  }
  notifyAuthenticationRequired();
}

export const identityApi = {
  beginOAuthLogin: async () => {
    if (await identityMode() !== "oauth") throw new Error("统一身份登录尚未配置。");
    oauthSessionAllowed = true;
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
    const generation = invalidateIdentitySession();
    oauthSessionAllowed = false;
    const mode = await identityMode();
    if (mode === "oauth") {
      const manager = await oauthManager();
      const user = await manager.getUser();
      if (generation !== getIdentitySessionGeneration()) return;
      manager.stopSilentRenew();
      await manager.removeUser();
      storeSession(sessionStorage, oauthSessionProjectionKey, null);
      // Revoke detached tokens without UserManager.revokeTokens storing the old user again.
      const client = new OidcClient(manager.settings);
      const results = await Promise.allSettled([
        user?.access_token ? client.revokeToken(user.access_token, "access_token") : Promise.resolve(),
        user?.refresh_token ? client.revokeToken(user.refresh_token, "refresh_token") : Promise.resolve()
      ]);
      if (results.some((result) => result.status === "rejected")) throw new Error("远程会话撤销尚未确认。");
      return;
    }
    if (mode !== "development" || !import.meta.env.DEV) return;
    const { developmentIdentity } = await import("./developmentIdentity");
    if (generation === getIdentitySessionGeneration()) await developmentIdentity.logout();
  }
};
