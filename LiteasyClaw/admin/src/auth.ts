import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import type { AdminRuntimeConfig } from "./runtimeConfig";
import type { AdminSession } from "./types";

const audience = "liteasy-admin";

export type AdminIdentityConfiguration = {
  audience: "liteasy-admin";
  authorizationFlow: "authorization_code_pkce";
  clientId: string;
  issuer: string;
};

function safeIssuer(value: string) {
  let issuer: URL;
  try {
    issuer = new URL(value);
  } catch {
    throw new Error("admin_oauth_configuration_invalid");
  }
  const loopback = issuer.protocol === "http:" &&
    new Set(["127.0.0.1", "[::1]", "localhost"]).has(issuer.hostname);
  if (
    issuer.username || issuer.password || issuer.search || issuer.hash ||
    (issuer.protocol !== "https:" && !(import.meta.env.DEV && loopback))
  ) {
    throw new Error("admin_oauth_configuration_invalid");
  }
  return issuer.toString().replace(/\/$/, "");
}

export function validateAdminIdentityConfiguration(value: unknown): AdminIdentityConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("admin_oauth_configuration_invalid");
  }
  const candidate = value as Partial<AdminIdentityConfiguration>;
  if (
    candidate.audience !== audience ||
    candidate.authorizationFlow !== "authorization_code_pkce" ||
    typeof candidate.clientId !== "string" ||
    !/^[A-Za-z0-9._~-]{1,200}$/.test(candidate.clientId) ||
    typeof candidate.issuer !== "string"
  ) {
    throw new Error("admin_oauth_configuration_invalid");
  }
  return { ...candidate, issuer: safeIssuer(candidate.issuer) } as AdminIdentityConfiguration;
}

export async function loadAdminIdentityConfiguration(
  config: AdminRuntimeConfig,
  fetchImpl: typeof fetch = fetch
) {
  const response = await fetchImpl(`${config.cloudUrl}/v1/identity/admin-config`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    method: "GET"
  });
  if (!response.ok) throw new Error(`admin_oauth_configuration_failed:${response.status}`);
  return validateAdminIdentityConfiguration(await response.json());
}

function redirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function manager(configuration: AdminIdentityConfiguration) {
  return new UserManager({
    authority: configuration.issuer,
    automaticSilentRenew: false,
    client_id: configuration.clientId,
    extraQueryParams: { audience },
    loadUserInfo: true,
    monitorSession: false,
    post_logout_redirect_uri: redirectUri(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid profile email",
    stateStore: new WebStorageStateStore({ store: sessionStorage }),
    userStore: new WebStorageStateStore({ store: sessionStorage })
  });
}

function oauthSession(user: User | null): AdminSession | null {
  if (!user?.access_token || !user.profile.sub || !user.expires_at || user.expired) return null;
  return {
    accessToken: user.access_token,
    expiresAt: new Date(user.expires_at * 1000).toISOString(),
    mode: "oauth",
    subjectId: user.profile.sub
  };
}

export async function beginAdminLogin(config: AdminRuntimeConfig, prompt?: "login") {
  const configuration = await loadAdminIdentityConfiguration(config);
  await manager(configuration).signinRedirect({
    ...(prompt ? { prompt } : {})
  });
}

export async function completeAdminLogin(config: AdminRuntimeConfig) {
  if (!new URLSearchParams(window.location.search).has("code")) return null;
  const configuration = await loadAdminIdentityConfiguration(config);
  const session = oauthSession(await manager(configuration).signinRedirectCallback());
  window.history.replaceState({}, document.title, redirectUri());
  return session;
}

export async function restoreAdminSession(config: AdminRuntimeConfig) {
  return oauthSession(await manager(await loadAdminIdentityConfiguration(config)).getUser());
}

export async function logoutAdmin(config: AdminRuntimeConfig) {
  const identityManager = manager(await loadAdminIdentityConfiguration(config));
  await identityManager.revokeTokens(["access_token", "refresh_token"]).catch(() => undefined);
  await identityManager.removeUser();
}
