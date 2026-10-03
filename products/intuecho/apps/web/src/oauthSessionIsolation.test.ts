import { afterEach, beforeEach, expect, test, vi } from "vitest";

const oidc = vi.hoisted(() => ({
  options: null as unknown as { userStore: { set: (key: string, value: string) => Promise<void> } },
  loaded: null as unknown as (user: unknown) => void,
  unloaded: null as unknown as () => void,
  getUser: vi.fn(), removeUser: vi.fn(), revokeToken: vi.fn(), stopSilentRenew: vi.fn()
}));
vi.mock("oidc-client-ts", () => ({
  WebStorageStateStore: class {
    set(key: string, value: string) { sessionStorage.setItem(key, value); return Promise.resolve(); }
    get(key: string) { return Promise.resolve(sessionStorage.getItem(key)); }
    remove(key: string) { const value = sessionStorage.getItem(key); sessionStorage.removeItem(key); return Promise.resolve(value); }
    getAllKeys() { return Promise.resolve(Object.keys(sessionStorage)); }
  },
  UserManager: class {
    settings = {};
    events = {
      addUserLoaded: (callback: typeof oidc.loaded) => { oidc.loaded = callback; },
      addUserUnloaded: (callback: typeof oidc.unloaded) => { oidc.unloaded = callback; }
    };
    getUser = oidc.getUser;
    removeUser = oidc.removeUser;
    stopSilentRenew = oidc.stopSilentRenew;
    constructor(options: typeof oidc.options) { oidc.options = options; }
  },
  OidcClient: class { revokeToken = oidc.revokeToken; }
}));
const oauthUser = { access_token: "synthetic-a-token", refresh_token: "synthetic-a-refresh", expires_at: 4_000_000_000, expired: false, profile: { name: "A", sub: "a" } };

beforeEach(() => {
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
  oidc.getUser.mockReset().mockResolvedValue(oauthUser);
  oidc.removeUser.mockReset().mockImplementation(async () => oidc.unloaded());
  oidc.revokeToken.mockReset();
  oidc.stopSilentRenew.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ audience: "intuecho-web", authorizationFlow: "authorization_code_pkce", clientId: "intuecho-web-public", issuer: "https://identity.example.test" }), { status: 200 })));
});
afterEach(() => vi.unstubAllGlobals());

test("removes local OAuth identity before remote revocation and fences a late renewal", async () => {
  const identity = await import("./identityClient");
  await identity.identityApi.initialize();
  expect(identity.readIdentitySession()?.userId).toBe("a");
  let finish!: () => void;
  const remote = new Promise<void>((resolve) => { finish = resolve; });
  oidc.revokeToken.mockReturnValue(remote);
  const logout = identity.identityApi.logout();
  await vi.waitFor(() => expect(oidc.revokeToken).toHaveBeenCalledTimes(2));
  expect(identity.readIdentitySession()).toBeNull();
  expect(await identity.resolveIdentitySession()).toBeNull();
  await oidc.options.userStore.set("oidc-stale-user", "private old token");
  oidc.loaded(oauthUser);
  expect(sessionStorage.getItem("oidc-stale-user")).toBeNull();
  expect(identity.readIdentitySession()).toBeNull();
  finish();
  await logout;
});

test("reports remote revocation failure after keeping the local account signed out", async () => {
  const identity = await import("./identityClient");
  await identity.identityApi.initialize();
  oidc.revokeToken.mockRejectedValue(new Error("offline"));
  await expect(identity.identityApi.logout()).rejects.toThrow("远程会话撤销尚未确认");
  expect(identity.readIdentitySession()).toBeNull();
  expect(await identity.resolveIdentitySession()).toBeNull();
});
