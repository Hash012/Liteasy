import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useResearchWorkbenchController } from "../app/controllers/useResearchWorkbenchController";

vi.mock("@tauri-apps/api/core", async importOriginal => ({ ...await importOriginal<typeof import("@tauri-apps/api/core")>(), isTauri: () => true, invoke: vi.fn() }));
test("switching scope clears old busy state and a late completion cannot unlock a new operation", async () => {
  let finishLogin!: (value: unknown) => void, finishRefresh!: (value: unknown) => void;
  let delayRefresh = false;
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === "chatgpt_plan_accounts") return { activeAccount: null, accounts: [] } as any;
    if (command === "codex_backend_capability") return { configured: false, requiredVersion: "0.154.0" } as any;
    if (command === "chatgpt_plan_login") return await new Promise(resolve => { finishLogin = resolve; }) as any;
    if (command === "research_host_command" && args.operation === "list") {
      if (delayRefresh) return await new Promise(resolve => { finishRefresh = resolve; }) as any;
      return [] as any;
    }
    throw new Error("unexpected command " + command);
  });
  const { result, rerender } = renderHook(({ scope }) => useResearchWorkbenchController({
    repository: { scopeId: scope, searchTitles: async () => [] } as any, assets: {} as any, api: { current: null },
  }), { initialProps: { scope: "account-a" } });
  await act(async () => { await Promise.resolve(); });
  let oldOperation!: Promise<void>;
  act(() => { oldOperation = result.current.login(); });
  await waitFor(() => expect(result.current.busy).toBe(true));
  rerender({ scope: "account-b" });
  await waitFor(() => expect(result.current.busy).toBe(false));
  delayRefresh = true;
  let newOperation!: Promise<void>;
  act(() => { newOperation = result.current.refresh(); });
  await waitFor(() => expect(result.current.busy).toBe(true));
  await act(async () => { finishLogin({}); await oldOperation; });
  expect(result.current.busy).toBe(true);
  await act(async () => { finishRefresh([]); await newOperation; });
  expect(result.current.busy).toBe(false);
});

test("connection discovery failures stay visible without blocking research refresh", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "chatgpt_plan_accounts") throw new Error("chatgpt_discovery_failed");
    if (command === "codex_backend_capability") return { configured: false, requiredVersion: "0.154.0" } as any;
    if (command === "research_host_command") return [] as any;
    throw new Error("unexpected command " + command);
  });
  const { result } = renderHook(() => useResearchWorkbenchController({
    repository: { scopeId: "connection-discovery", searchTitles: async () => [] } as any, assets: {} as any, api: { current: null },
  }));
  await waitFor(() => expect(result.current.connectionStatus).toEqual({ intent: "error", message: "chatgpt_discovery_failed" }));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.busy).toBe(false);
  expect(result.current.connectionStatus?.message).toBe("chatgpt_discovery_failed");
  expect(result.current.notice).toBe("");
});

test("failed login reports its own pending state and retry preserves the actual account request", async () => {
  let finishLogin!: () => void;
  let fail = true;
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "chatgpt_plan_accounts") return { activeAccount: null, accounts: [] } as any;
    if (command === "codex_backend_capability") return { configured: false, requiredVersion: "0.154.0" } as any;
    if (command === "research_host_command") return [] as any;
    if (command === "chatgpt_plan_login") {
      await new Promise<void>(resolve => { finishLogin = resolve; });
      if (fail) throw new Error("chatgpt_discovery_failed");
      return {} as any;
    }
    throw new Error("unexpected command " + command);
  });
  const { result } = renderHook(() => useResearchWorkbenchController({
    repository: { scopeId: "connection-retry", searchTitles: async () => [] } as any, assets: {} as any, api: { current: null },
  }));
  await act(async () => {});
  let operation!: Promise<void>;
  act(() => { operation = result.current.login(); });
  expect(result.current.pendingAction).toBe("login");
  expect(result.current.busy).toBe(true);
  await act(async () => { finishLogin(); await operation; });
  expect(result.current.connectionStatus).toEqual({ intent: "error", message: "chatgpt_discovery_failed" });
  expect(result.current.busy).toBe(false);
  expect(result.current.pendingAction).toBeUndefined();
  fail = false;
  act(() => { operation = result.current.login(); });
  expect(result.current.connectionStatus).toBeUndefined();
  await act(async () => { finishLogin(); await operation; });
  expect(invoke).toHaveBeenCalledWith("chatgpt_plan_login", { scope: "connection-retry", accountId: null });
  expect(result.current.connectionStatus).toBeUndefined();
  expect(result.current.busy).toBe(false);
});

test("switching to an account with a failed catalog clears the previous account's model choices", async () => {
  let account = "first-account";
  vi.mocked(invoke).mockImplementation(async (command, args: any) => {
    if (command === "chatgpt_plan_accounts") return { activeAccount: account, accounts: [] } as any;
    if (command === "chatgpt_plan_select") { account = args.accountId; return undefined as any; }
    if (command === "chatgpt_plan_models") {
      if (account === "second-account") throw new Error("chatgpt_discovery_failed");
      return [{ slug: "first-model", displayName: "First model" }] as any;
    }
    if (command === "codex_backend_capability") return { configured: false, requiredVersion: "0.154.0" } as any;
    if (command === "research_host_command") return [] as any;
    throw new Error("unexpected command " + command);
  });
  const { result } = renderHook(() => useResearchWorkbenchController({
    repository: { scopeId: "catalog-switch", searchTitles: async () => [] } as any, assets: {} as any, api: { current: null },
  }));
  await waitFor(() => expect(result.current.model).toBe("first-model"));
  await act(async () => { await result.current.selectAccount("second-account"); });
  expect(result.current.connections.activeAccount).toBe("second-account");
  expect(result.current.models).toEqual([]);
  expect(result.current.model).toBe("");
  expect(result.current.connectionStatus?.intent).toBe("error");
  expect(invoke).toHaveBeenCalledWith("chatgpt_plan_models", { scope: "catalog-switch", accountId: "second-account" });
});

test("canceling authorization sends the host cancellation and releases the pending login", async () => {
  let rejectLogin!: (error: Error) => void;
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "chatgpt_plan_accounts") return { activeAccount: null, accounts: [] } as any;
    if (command === "codex_backend_capability") return { configured: false, requiredVersion: "0.154.0" } as any;
    if (command === "research_host_command") return [] as any;
    if (command === "chatgpt_plan_login") return await new Promise((_, reject) => { rejectLogin = reject; }) as any;
    if (command === "chatgpt_plan_cancel") { rejectLogin(new Error("授权已取消")); return undefined as any; }
    throw new Error("unexpected command " + command);
  });
  const { result } = renderHook(() => useResearchWorkbenchController({
    repository: { scopeId: "cancel-login", searchTitles: async () => [] } as any, assets: {} as any, api: { current: null },
  }));
  await act(async () => {});
  let operation!: Promise<void>;
  act(() => { operation = result.current.login(); });
  expect(result.current.pendingAction).toBe("login");
  await act(async () => { await result.current.cancelLogin(); await operation; });
  expect(invoke).toHaveBeenCalledWith("chatgpt_plan_cancel");
  expect(result.current.busy).toBe(false);
  expect(result.current.pendingAction).toBeUndefined();
  expect(result.current.connectionStatus).toEqual({ intent: "error", message: "授权已取消" });
});

test("engine and validation configuration keep failure and retry feedback in the connection card", async () => {
  let fail = true;
  vi.mocked(invoke).mockClear();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "chatgpt_plan_accounts") return { activeAccount: null, accounts: [] } as any;
    if (command === "codex_backend_capability") return { configured: !fail, requiredVersion: "0.154.0" } as any;
    if (command === "research_host_command") return [] as any;
    if (["codex_backend_configure", "research_harness_configure", "research_harness_check"].includes(command)) {
      if (fail) throw new Error("连接配置失败");
      return { valid: true } as any;
    }
    throw new Error("unexpected command " + command);
  });
  const { result } = renderHook(() => useResearchWorkbenchController({
    repository: { scopeId: "configure-services", searchTitles: async () => [] } as any, assets: {} as any, api: { current: null },
  }));
  await act(async () => {});
  const configure = [
    () => result.current.configureBackend("C:\\Tools\\codex.exe"),
    () => result.current.configureHarness("python", "kit", "workspace"),
    () => result.current.checkHarness("verify", "record-one"),
  ];
  for (const operation of configure) {
    await act(async () => { await operation(); });
    expect(result.current.connectionStatus).toEqual({ intent: "error", message: "连接配置失败" });
    expect(result.current.notice).toBe("");
    expect(result.current.busy).toBe(false);
  }
  fail = false;
  await act(async () => { await configure[0](); });
  expect(result.current.connectionStatus).toEqual({ intent: "success", message: "研究引擎已连接。" });
  expect(result.current.backend.configured).toBe(true);
  expect(invoke).toHaveBeenCalledWith("codex_backend_configure", { executable: "C:\\Tools\\codex.exe" });
  await act(async () => { await configure[1](); });
  expect(result.current.connectionStatus?.intent).toBe("success");
  expect(invoke).toHaveBeenCalledWith("research_harness_configure", {
    scope: "configure-services", config: { python: "python", kitRoot: "kit", workspace: "workspace", fingerprint: null },
  });
  await act(async () => { await configure[2](); });
  expect(result.current.connectionStatus).toBeUndefined();
  expect(JSON.parse(result.current.harnessReceipt)).toEqual({ valid: true });
  expect(invoke).toHaveBeenCalledWith("research_harness_check", {
    scope: "configure-services", operation: "verify", recordId: "record-one", packet: null, taskId: null,
  });
});
