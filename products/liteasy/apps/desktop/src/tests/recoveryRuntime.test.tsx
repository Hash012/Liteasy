import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { initializeRuntimeProfile, localWorkspaceScope } from "../app/features/local-recovery/runtimeProfile";
import { resolveLocalAccountKey } from "../app/features/library/localAccountKey";
import { clearStoredAccountSession, loadStoredAccountSession } from "../app/features/account/accountSessionStorage";
import { useAccountSession } from "../app/features/account/useAccountSession";
import { createSettingsStore } from "../app/features/settings/settings.store";
const native = (value: unknown) => vi.fn().mockResolvedValue(value);
beforeEach(async () => { await initializeRuntimeProfile(native(null), true); clearStoredAccountSession(); });
test("archived partition supplies local repository/catalog keys without inventing a login", async () => {
  await initializeRuntimeProfile(native({ scopeId: "user:archived-fixture", localOnly: true, recovery: true }), true);
  expect(localWorkspaceScope()).toBe("user:archived-fixture");
  expect(localWorkspaceScope("another-login")).toBe("user:archived-fixture");
  expect(resolveLocalAccountKey()).toBe("user:archived-fixture");
  expect(loadStoredAccountSession()).toBeNull();
  expect(createSettingsStore().getState()["network.recommendation.enabled"]).toBe(false);
});
test("guest recovery and normal workspace preserve existing account namespace behavior", async () => {
  await initializeRuntimeProfile(native({ scopeId: "local", localOnly: true, recovery: true }), true);
  expect(resolveLocalAccountKey()).toBe("guest");
  await initializeRuntimeProfile(native(null), true);
  expect(localWorkspaceScope("normal")).toBe("user:normal");
  expect(localWorkspaceScope()).toBe("local");
});
test("invalid native bootstrap fails closed rather than opening a different partition", async () => {
  for (const value of [{ scopeId: "user:x", localOnly: false, recovery: true }, { scopeId: "user:", localOnly: true, recovery: true }, { scopeId: "user:x\n", localOnly: true, recovery: true }, undefined]) {
    await expect(initializeRuntimeProfile(native(value), true)).rejects.toThrow("恢复配置");
  }
  const call = native(null); await initializeRuntimeProfile(call, false); expect(call).not.toHaveBeenCalled();
});
test("recovery account hook never restores system credentials or starts an interactive login", async () => {
  await initializeRuntimeProfile(native({ scopeId: "user:archived-fixture", localOnly: true, recovery: true }), true);
  const invoke = vi.fn(), store = createSettingsStore();
  const { result } = renderHook(() => useAccountSession({ desktopIdentityHostAvailable: true, desktopIdentityInvoke: invoke, getSettings: () => store.getState() }));
  await waitFor(() => expect(result.current.shouldShowLoginReminder).toBe(false));
  await act(async () => { await result.current.loginPersonalAccountWithSystemBrowser(); });
  expect(invoke).not.toHaveBeenCalled();
  expect(result.current.accountSession).toBeNull();
  expect(result.current.accountMessage).toContain("保持离线");
});
