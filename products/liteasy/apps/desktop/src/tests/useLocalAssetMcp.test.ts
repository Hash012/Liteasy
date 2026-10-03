import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useLocalAssetMcp } from "../app/controllers/agent/useLocalAssetMcp";
import type { AgentAssetService } from "../app/features/resource-filesystem/agentAssetService";

const native = vi.hoisted(() => ({
  invoke: vi.fn(), callbacks: new Map<string, Set<(event: { payload: any }) => Promise<void> | void>>(), generation: 0,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (name, callback) => {
  const set = native.callbacks.get(name) ?? new Set(); set.add(callback); native.callbacks.set(name, set);
  return () => set.delete(callback);
}) }));
beforeEach(() => {
  native.callbacks.clear(); native.invoke.mockReset();
  native.invoke.mockImplementation(async (command, args) => command === "local_mcp_configure" ? {
    ...args, generation: `g${++native.generation}`, executable: "D:\\Liteasy.exe", connectionFile: "C:\\connection.json",
  } : undefined);
});
async function deliver(payload: unknown) {
  await act(async () => { await Promise.all([...native.callbacks.get("liteasy-local-mcp-request") ?? []].map((callback) => callback({ payload }))); });
}

test("only accepts current scope/generation, exposes read-only tools, and revokes on account switches", async () => {
  const search = vi.fn(async () => []);
  const assets = { search } as unknown as AgentAssetService;
  const { result, rerender, unmount } = renderHook(({ scope }) => useLocalAssetMcp(scope, assets), { initialProps: { scope: "a" } });
  await waitFor(() => expect(result.current.info?.enabled).toBe(false));
  act(() => result.current.configure(true, false));
  await waitFor(() => expect(result.current.info?.enabled).toBe(true));
  const request = { requestId: "r", scopeId: "a", generation: result.current.info!.generation, writable: true,
    line: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "liteasy_search", arguments: { query: "CicN" } } }) };
  await deliver({ ...request, generation: "old" });
  await deliver({ ...request, scopeId: "b" });
  expect(search).not.toHaveBeenCalled();
  await deliver(request);
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: "CicN" }));
  expect(result.current.recent).toMatchObject({ tool: "liteasy_search", failed: false });
  await deliver({ ...request, line: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "liteasy_create", arguments: { kind: "note", title: "X", operationId: "x" } } }) });
  const reply = native.invoke.mock.calls.filter(([command]) => command === "local_mcp_reply").at(-1)![1];
  expect(JSON.parse(reply.response.line).result.structuredContent.error.code).toBe("read_only");
  rerender({ scope: "b" });
  await waitFor(() => expect(result.current.info).toMatchObject({ enabled: false, scopeId: "b" }));
  rerender({ scope: "a" });
  await waitFor(() => expect(result.current.info).toMatchObject({ enabled: false, scopeId: "a" }));
  unmount();
});

test("revoking access aborts an in-flight asset operation", async () => {
  let signal: AbortSignal | undefined;
  let finish!: () => void;
  const assets = { stat: vi.fn(async () => ({ path: "liteasy://objects/a" })), read: vi.fn(async (_path, options) => {
    signal = options.signal;
    await new Promise<void>((resolve) => { finish = resolve; });
    signal!.throwIfAborted();
    return {};
  }) } as unknown as AgentAssetService;
  const { result, unmount } = renderHook(() => useLocalAssetMcp("a", assets));
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.configure(true, true));
  await waitFor(() => expect(result.current.info?.writable).toBe(true));
  const callback = [...native.callbacks.get("liteasy-local-mcp-request")!][0];
  let pending!: Promise<void> | void;
  act(() => { pending = callback({ payload: { requestId: "r", scopeId: "a", generation: result.current.info!.generation, writable: true,
    line: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "liteasy_read", arguments: { path: "liteasy://objects/a" } } }) } }); });
  await waitFor(() => expect(signal?.aborted).toBe(false));
  act(() => result.current.configure(false, false));
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish(); await pending; });
  await waitFor(() => expect(result.current.info?.enabled).toBe(false));
  unmount();
});

test("keeps import jobs across normal renders but aborts them when library scope or write permission changes", async () => {
  const assets = {} as AgentAssetService;
  let signal: AbortSignal | undefined;
  const importPaper = vi.fn((_item, _options, abort: AbortSignal) => {
    signal = abort;
    return new Promise<never>((_resolve, reject) => abort.addEventListener("abort", () => reject(new Error("Stopped")), { once: true }));
  });
  const { result, rerender } = renderHook(({ library }) => useLocalAssetMcp("a", assets, { scopeKey: library, importPaper }), { initialProps: { library: "one" } });
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.configure(true, true));
  await waitFor(() => expect(result.current.info?.writable).toBe(true));
  await deliver({ requestId: "batch", scopeId: "a", generation: result.current.info!.generation, writable: true,
    line: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "liteasy_import_papers", arguments: { operationId: "batch", papers: [{ doi: "10.1234/memory" }] } } }) });
  expect(importPaper).toHaveBeenCalledOnce();
  rerender({ library: "one" });
  expect(signal?.aborted).toBe(false);
  rerender({ library: "two" });
  expect(signal?.aborted).toBe(true);
  await waitFor(() => expect(result.current.busy).toBe(false));
  await deliver({ requestId: "batch2", scopeId: "a", generation: result.current.info!.generation, writable: true,
    line: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "liteasy_import_papers", arguments: { operationId: "batch2", papers: [{ doi: "10.1234/second" }] } } }) });
  expect(signal?.aborted).toBe(false);
  act(() => result.current.configure(true, false));
  expect(signal?.aborted).toBe(true);
  await waitFor(() => expect(result.current.busy).toBe(false));
});


test("same-account session renewal revokes the previous native MCP opt-in", async () => {
  const { clearStoredAccountSession } = await import("../app/features/account/accountSessionStorage");
  const assets = { search: vi.fn(async () => []) } as unknown as AgentAssetService;
  const { result, rerender } = renderHook(() => useLocalAssetMcp("a", assets));
  await waitFor(() => expect(result.current.busy).toBe(false));
  act(() => result.current.configure(true, true));
  await waitFor(() => expect(result.current.info?.enabled).toBe(true));
  const generation = result.current.info!.generation;
  clearStoredAccountSession(); rerender();
  await waitFor(() => expect(result.current.info?.enabled).toBe(false));
  await deliver({ requestId: "old", scopeId: "a", generation, writable: true, line: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "liteasy_search", arguments: {} } }) });
  expect(assets.search).not.toHaveBeenCalled();
});
