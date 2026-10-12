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
