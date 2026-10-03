import { beforeEach, expect, test, vi } from "vitest";
const bridge = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => bridge);
vi.mock("../app/features/library/localAccountKey", () => ({ resolveLocalAccountKey: () => "guest" }));
import { exportWebDavPreferences, restoreWebDavPreferences, webDavCredentialDescriptors } from "../app/features/webdav/webdavPreferences";
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); bridge.invoke.mockReset(); });
test("exports explicit preferences and current profile without OAuth, tokens, paths or another account", () => {
  for (const key of ["liteasy.view-settings.v1", "liteasy.profile-memory.v1:guest", "liteasy.profile-memory.v1:user:other", "access_token", "liteasy.webdav.password", "liteasy.local-library.path"]) localStorage.setItem(key, "{}");
  expect(exportWebDavPreferences()).toEqual({ "liteasy.view-settings.v1": "{}", "liteasy.profile-memory.v1:guest": "{}" });
  expect(webDavCredentialDescriptors()).toEqual([]);
});
test("restores the allowlist before acknowledging and ignores unexpected keys", async () => {
  localStorage.setItem("liteasy.view-settings.v1", "old");
  bridge.invoke.mockResolvedValueOnce({ pending: true, preferences: { "liteasy.view-settings.v1": "new", access_token: "evil" } });
  await restoreWebDavPreferences();
  expect(localStorage.getItem("liteasy.view-settings.v1")).toBe("new");
  expect(localStorage.getItem("access_token")).toBeNull();
  expect(bridge.invoke).toHaveBeenNthCalledWith(2, "acknowledge_webdav_preferences");
});
test("keeps pending restoration when browser storage cannot save", async () => {
  bridge.invoke.mockResolvedValueOnce({ pending: true, preferences: { "liteasy.view-settings.v1": "new" } });
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
  await expect(restoreWebDavPreferences()).rejects.toThrow("quota");
  expect(bridge.invoke).toHaveBeenCalledTimes(1);
  write.mockRestore();
});


test("does not apply or acknowledge a restore from a departed account", async () => {
  localStorage.setItem("liteasy.view-settings.v1", "B settings");
  let resolve!: (value: unknown) => void;
  bridge.invoke.mockImplementation(() => new Promise((done) => { resolve = done; }));
  let current = true;
  const restore = restoreWebDavPreferences(() => current);
  current = false;
  resolve({ pending: true, preferences: { "liteasy.view-settings.v1": "private A settings" }, message: "A notice" });
  await restore;
  expect(localStorage.getItem("liteasy.view-settings.v1")).toBe("B settings");
  expect(sessionStorage.getItem("liteasy.webdav-restore-notice")).toBeNull();
  expect(bridge.invoke).toHaveBeenCalledTimes(1);
});
