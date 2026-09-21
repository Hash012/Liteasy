import { renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useWebDavSyncController } from "../app/controllers/useWebDavSyncController";
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
