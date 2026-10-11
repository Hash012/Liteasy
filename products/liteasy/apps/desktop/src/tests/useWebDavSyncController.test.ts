import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useWebDavSyncController } from "../app/controllers/useWebDavSyncController";
const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => native.enabled }));
beforeEach(() => { native.enabled = false; native.invoke.mockReset().mockResolvedValue(undefined); });
const sync = vi.hoisted(() => vi.fn());
vi.mock("../app/features/webdav/webdavClient", () => ({ autoSyncWebDav: sync, clearWebDavStatus: vi.fn(), webdavStatus: { getSnapshot: () => ({ result: null }), subscribe: () => () => {} } }));
afterEach(() => { vi.useRealTimers(); sync.mockClear(); });
test("syncs after startup, periodically and on reconnection, and removes timers when unmounted", () => {
  vi.useFakeTimers();
  const hook = renderHook(() => useWebDavSyncController());
  vi.advanceTimersByTime(15_000); expect(sync).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(285_000); expect(sync).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new Event("online")); expect(sync).toHaveBeenCalledTimes(3);
  hook.unmount();
  vi.advanceTimersByTime(300_000); window.dispatchEvent(new Event("online")); expect(sync).toHaveBeenCalledTimes(3);
});

test("opens a local paper only after its attachment is cached and surfaces download errors", async () => {
  native.enabled = true;
  let finish!: () => void;
  native.invoke.mockImplementation((command) => command === "ensure_webdav_file" ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
  const hook = renderHook(() => useWebDavSyncController([], "/library"));
  const ready = vi.fn(), failed = vi.fn();
  hook.result.current.openPaper("/library/paper.pdf", ready, failed);
  expect(native.invoke).toHaveBeenCalledWith("ensure_webdav_file", { sourcePath: "/library/paper.pdf" });
  expect(ready).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(ready).toHaveBeenCalledTimes(1);
  native.invoke.mockRejectedValueOnce(new Error("下载失败"));
  hook.result.current.openPaper("/library/paper.pdf", ready, failed);
  await waitFor(() => expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: "下载失败" })));
  expect(ready).toHaveBeenCalledTimes(1);
});
test("discards a late attachment download after changing libraries", async () => {
  native.enabled = true;
  let finish!: () => void;
  native.invoke.mockImplementation((command) => command === "ensure_webdav_file" ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
  const hook = renderHook(({ root }) => useWebDavSyncController([], root), { initialProps: { root: "/library" } });
  const ready = vi.fn();
  hook.result.current.openPaper("/library/paper.pdf", ready, vi.fn());
  hook.rerender({ root: "/other" });
  hook.rerender({ root: "/library" });
  await act(async () => finish());
  expect(ready).not.toHaveBeenCalled();
});
