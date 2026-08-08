import { expect, test, vi } from "vitest";
import {
  isLoopbackAccountEndpoint,
  loadDesktopIdentityConfiguration,
  loginWithSystemBrowser,
  restoreSystemBrowserSession,
  revokeSystemBrowserSession
} from "../app/features/account/desktopIdentityClient";

const configuration = {
  audience: "liteasy-desktop" as const,
  authorizationFlow: "authorization_code_pkce" as const,
  clientId: "liteasy-desktop-public",
  issuer: "https://identity.example.com",
  revocationUrl: "https://identity.example.com/oauth2/revoke"
};

function configurationFetch(value: unknown = configuration, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status
  })) as unknown as typeof fetch;
}

test("loads a bounded public desktop identity configuration without credentials", async () => {
  const fetchImpl = configurationFetch();
  await expect(loadDesktopIdentityConfiguration({
    endpoint: "https://api.liteasy.example/",
    fetchImpl
  })).resolves.toEqual(configuration);
  expect(fetchImpl).toHaveBeenCalledWith(
    "https://api.liteasy.example/v1/identity/desktop-config",
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
      method: "GET"
    }
  );
});

test("uses only Tauri host commands for login, restore, and revocation", async () => {
  const session = {
    email: "ada@example.com",
    expiresAt: "2026-08-07T00:00:00.000Z",
    name: "Ada",
    sessionId: "access-token",
    userId: "user-1"
  };
  const invoke = vi.fn(async (command: string) => command === "revoke_desktop_oauth_session"
    ? undefined
    : session);
  const input = {
    endpoint: "https://api.liteasy.example",
    fetchImpl: configurationFetch(),
    invoke
  };

  await expect(loginWithSystemBrowser(input)).resolves.toEqual(session);
  await expect(restoreSystemBrowserSession(input)).resolves.toEqual(session);
  await expect(revokeSystemBrowserSession(input)).resolves.toBeUndefined();
  expect(invoke.mock.calls).toEqual([
    ["begin_desktop_oauth_login", { configuration }],
    ["restore_desktop_oauth_session", { configuration }],
    ["revoke_desktop_oauth_session", { configuration }]
  ]);
});

test("rejects audience confusion, insecure issuers, and cross-origin revocation", async () => {
  for (const invalid of [
    { ...configuration, audience: "intuecho-web" },
    { ...configuration, issuer: "http://identity.example.com" },
    { ...configuration, revocationUrl: "https://other.example.com/revoke" }
  ]) {
    await expect(loadDesktopIdentityConfiguration({
      endpoint: "https://api.liteasy.example",
      fetchImpl: configurationFetch(invalid)
    })).rejects.toThrow("oauth_configuration_invalid");
  }
});

test("exposes password login only for an explicit HTTP loopback development endpoint", () => {
  expect(isLoopbackAccountEndpoint("http://127.0.0.1:8787")).toBe(true);
  expect(isLoopbackAccountEndpoint("http://localhost:8787")).toBe(true);
  expect(isLoopbackAccountEndpoint("https://api.liteasy.example")).toBe(false);
  expect(isLoopbackAccountEndpoint("http://api.liteasy.example")).toBe(false);
});
