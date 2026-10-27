import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { useWindowControls } from "../app/controllers/useWindowControls";

const host = vi.hoisted(() => ({ native: true, maximized: false, resized: () => {},
  closeRequested: async (_event: { preventDefault(): void }) => {},
  isMaximized: vi.fn(), onResized: vi.fn(), onCloseRequested: vi.fn(), minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), unlisten: vi.fn(), unlistenClose: vi.fn() }));
const progress = vi.hoisted(() => ({ flush: vi.fn() }));
vi.mock("../app/features/pdf/pdfReaderPersistence", () => ({ flushPdfReaderPositions: progress.flush }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => host.native }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => host }));
beforeEach(() => {
  vi.clearAllMocks(); host.native = true; host.maximized = false;
  progress.flush.mockResolvedValue(undefined);
  host.isMaximized.mockImplementation(async () => host.maximized);
  host.onResized.mockImplementation(async (callback: () => void) => { host.resized = callback; return host.unlisten; });
  host.onCloseRequested.mockImplementation(async (callback: typeof host.closeRequested) => { host.closeRequested = callback; return host.unlistenClose; });
  host.toggleMaximize.mockImplementation(async () => { host.maximized = !host.maximized; });
});

test("custom window controls use native commands and follow external resize state", async () => {
  const { result, unmount } = renderHook(useWindowControls);
  await waitFor(() => expect(host.onResized).toHaveBeenCalledOnce());
  act(() => result.current.toggleMaximize());
  await waitFor(() => expect(result.current.maximized).toBe(true));
  host.maximized = false;
  act(() => host.resized());
  await waitFor(() => expect(result.current.maximized).toBe(false));
  act(() => { result.current.minimize(); result.current.close(); });
  expect(host.minimize).toHaveBeenCalledOnce(); await waitFor(() => expect(host.close).toHaveBeenCalledOnce());
  unmount(); expect(host.unlisten).toHaveBeenCalledOnce(); expect(host.unlistenClose).toHaveBeenCalledOnce();
});

test("native close and title-bar close wait for reading progress and can retry a failed save", async () => {
  const hook = renderHook(useWindowControls);
  await waitFor(() => expect(host.onCloseRequested).toHaveBeenCalledOnce());
  let complete!: () => void;
  progress.flush.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  const event = { preventDefault: vi.fn() };
  let closed = false;
  const nativeClose = host.closeRequested(event).then(() => { closed = true; });
  expect(closed).toBe(false);
  const second = { preventDefault: vi.fn() };
  await host.closeRequested(second);
  expect(second.preventDefault).toHaveBeenCalledOnce();
  await act(async () => { complete(); await nativeClose; });
  expect(event.preventDefault).not.toHaveBeenCalled();

  progress.flush.mockRejectedValueOnce(new Error("disk busy"));
  await act(async () => host.closeRequested(event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(hook.result.current.error).toContain("阅读进度尚未保存");
  progress.flush.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
  act(() => hook.result.current.close());
  expect(host.close).not.toHaveBeenCalled();
  await act(async () => complete());
  await waitFor(() => expect(host.close).toHaveBeenCalledOnce());
});

test("browser preview does not send native IPC and rejected actions remain recoverable", async () => {
  host.native = false;
  const browser = renderHook(useWindowControls);
  expect(browser.result.current.available).toBe(false);
  act(() => browser.result.current.close());
  expect(host.close).not.toHaveBeenCalled(); expect(host.onResized).not.toHaveBeenCalled();
  browser.unmount(); host.native = true;
  host.minimize.mockRejectedValueOnce(new Error("denied"));
  const native = renderHook(useWindowControls);
  act(() => native.result.current.minimize());
  await waitFor(() => expect(native.result.current.error).toContain("未完成"));
  act(() => native.result.current.minimize());
  await waitFor(() => expect(native.result.current.error).toBe(""));
});

test("cleans up an event subscription that resolves after unmount", async () => {
  let resolve!: (cleanup: () => void) => void;
  host.onResized.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { unmount } = renderHook(useWindowControls); unmount();
  await act(async () => resolve(host.unlisten));
  expect(host.unlisten).toHaveBeenCalledOnce();
});

test("the undecorated window grants exactly the commands required by the title bar", () => {
  const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const capability = JSON.parse(readFileSync("src-tauri/capabilities/main.json", "utf8"));
  expect(config.app.windows[0].decorations).toBe(false);
  for (const command of ["inner-size", "is-maximized", "is-fullscreen", "set-fullscreen", "minimize", "toggle-maximize", "internal-toggle-maximize", "close", "destroy", "start-dragging"]) {
    expect(capability.permissions).toContain(`core:window:allow-${command}`);
  }
  expect(capability.permissions).toContain("core:webview:allow-set-webview-size");
  expect(capability.permissions).toContain("core:webview:allow-set-webview-auto-resize");
  expect(capability.windows).toEqual(["main"]);
  expect(capability.permissions).not.toContain("core:window:default");
});
