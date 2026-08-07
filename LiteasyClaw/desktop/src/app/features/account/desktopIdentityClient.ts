import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { AccountSession } from "./account.types";

export type DesktopIdentityConfiguration = {
  audience: "liteasy-desktop";
  authorizationFlow: "authorization_code_pkce";
  clientId: string;
  issuer: string;
  revocationUrl: string;
};

export type DesktopIdentityInvoke = <T>(
  command: string,
  args?: Record<string, unknown>
) => Promise<T>;

type DesktopIdentityClientInput = {
  endpoint: string;
  fetchImpl?: typeof fetch;
  invoke?: DesktopIdentityInvoke;
};

function isTauriRuntime() {
  return typeof window !== "undefined" &&
    typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
      .__TAURI_INTERNALS__?.invoke === "function";
}

function requireInvoke(override?: DesktopIdentityInvoke) {
  if (override) return override;
  if (!isTauriRuntime()) {
    throw new Error("oauth_desktop_host_required");
  }
  return tauriInvoke as DesktopIdentityInvoke;
}

function identityConfigurationUrl(endpoint: string) {
  return `${endpoint.replace(/\/+$/, "")}/v1/identity/desktop-config`;
}

function validatePublicIdentityConfiguration(value: unknown): DesktopIdentityConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("oauth_configuration_invalid");
  }
  const candidate = value as Partial<DesktopIdentityConfiguration>;
  if (
    candidate.audience !== "liteasy-desktop" ||
    candidate.authorizationFlow !== "authorization_code_pkce" ||
    typeof candidate.clientId !== "string" ||
    !/^[A-Za-z0-9._~-]{1,200}$/.test(candidate.clientId) ||
    typeof candidate.issuer !== "string" ||
    typeof candidate.revocationUrl !== "string"
  ) {
    throw new Error("oauth_configuration_invalid");
  }
  let issuer: URL;
  let revocation: URL;
  try {
    issuer = new URL(candidate.issuer);
    revocation = new URL(candidate.revocationUrl);
  } catch {
    throw new Error("oauth_configuration_invalid");
  }
  const loopback = new Set(["127.0.0.1", "[::1]", "localhost"]).has(issuer.hostname);
  if (
    issuer.username || issuer.password || issuer.search || issuer.hash ||
    revocation.username || revocation.password || revocation.search || revocation.hash ||
    issuer.origin !== revocation.origin ||
    (issuer.protocol !== "https:" && !(import.meta.env.DEV && issuer.protocol === "http:" && loopback))
  ) {
    throw new Error("oauth_configuration_invalid");
  }
  return candidate as DesktopIdentityConfiguration;
}

export function isLoopbackAccountEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    return parsed.protocol === "http:" &&
      new Set(["127.0.0.1", "[::1]", "localhost"]).has(parsed.hostname);
  } catch {
    return false;
  }
}

export function isDesktopIdentityHostAvailable() {
  return isTauriRuntime();
}

export async function loadDesktopIdentityConfiguration({
  endpoint,
  fetchImpl = fetch
}: Pick<DesktopIdentityClientInput, "endpoint" | "fetchImpl">) {
  const response = await fetchImpl(identityConfigurationUrl(endpoint), {
    cache: "no-store",
    headers: { Accept: "application/json" },
    method: "GET"
  });
  if (!response.ok) {
    throw new Error(response.status === 404
      ? "oauth_configuration_unavailable"
      : `oauth_configuration_failed:${response.status}`);
  }
  return validatePublicIdentityConfiguration(await response.json());
}

export async function loginWithSystemBrowser(input: DesktopIdentityClientInput) {
  const configuration = await loadDesktopIdentityConfiguration(input);
  return requireInvoke(input.invoke)<AccountSession>("begin_desktop_oauth_login", {
    configuration
  });
}

export async function restoreSystemBrowserSession(input: DesktopIdentityClientInput) {
  const configuration = await loadDesktopIdentityConfiguration(input);
  return requireInvoke(input.invoke)<AccountSession>("restore_desktop_oauth_session", {
    configuration
  });
}

export async function revokeSystemBrowserSession(input: DesktopIdentityClientInput) {
  const configuration = await loadDesktopIdentityConfiguration(input);
  await requireInvoke(input.invoke)<void>("revoke_desktop_oauth_session", {
    configuration
  });
}
