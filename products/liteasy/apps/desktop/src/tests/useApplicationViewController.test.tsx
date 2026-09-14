import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useApplicationViewController } from "../app/controllers/useApplicationViewController";

const native = vi.hoisted(() => ({
  enabled: false,
  setZoom: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ setZoom: native.setZoom }),
}));

beforeEach(() => {
  native.enabled = false;
  native.setZoom.mockClear();
});

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-app-css-zoom");
});

function zoomKey(key: string, extras: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    ...extras,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

test("handles physical plus/minus keys, keypad, reset and limits without browser double zoom", () => {
  const onUpdateSetting = vi.fn();
  const { unmount } = renderHook(() =>
    useApplicationViewController({
      settings: { "view.display_scale": "100", "view.font_size": "14" },
      onUpdateSetting,
    }),
  );
  expect(zoomKey("=", { code: "Equal" }).defaultPrevented).toBe(true);
  expect(onUpdateSetting).toHaveBeenLastCalledWith({
    intent: "update_setting",
    target: "view.display_scale",
    value: "110",
  });
  zoomKey("+", { shiftKey: true });
  expect(onUpdateSetting).toHaveBeenLastCalledWith(
    expect.objectContaining({ value: "125" }),
  );
  zoomKey("Unidentified", { code: "NumpadSubtract" });
  expect(onUpdateSetting).toHaveBeenLastCalledWith(
    expect.objectContaining({ value: "110" }),
  );
  zoomKey("0");
  expect(onUpdateSetting).toHaveBeenLastCalledWith(
    expect.objectContaining({ value: "100" }),
  );
  for (let index = 0; index < 10; index++) zoomKey("-", { code: "Minus" });
  expect(onUpdateSetting).toHaveBeenLastCalledWith(
    expect.objectContaining({ value: "75" }),
  );
  for (let index = 0; index < 12; index++)
    zoomKey("Unidentified", { code: "NumpadAdd" });
  expect(onUpdateSetting).toHaveBeenLastCalledWith(
    expect.objectContaining({ value: "200" }),
  );
  const calls = onUpdateSetting.mock.calls.length;
  expect(zoomKey("+", { ctrlKey: false }).defaultPrevented).toBe(false);
  zoomKey("+", { altKey: true });
  zoomKey("+", { isComposing: true });
  expect(onUpdateSetting).toHaveBeenCalledTimes(calls);
  unmount();
  expect(zoomKey("+").defaultPrevented).toBe(false);
});

test("applies independent font and browser scale preferences and restores document state on unmount", () => {
  const root = document.documentElement;
  root.style.zoom = "1";
  const { rerender, unmount } = renderHook(
    ({ scale, font }) =>
      useApplicationViewController({
        settings: { "view.display_scale": scale, "view.font_size": font },
        onUpdateSetting: vi.fn(),
      }),
    { initialProps: { scale: "125", font: "18" } },
  );
  expect(root.style.zoom).toBe("1.25");
  expect(root.style.getPropertyValue("--app-display-scale")).toBe("1.25");
  expect(root.style.getPropertyValue("--app-font-size")).toBe("18px");
  expect(root.dataset.appCssZoom).toBe("true");
  rerender({ scale: "90", font: "16" });
  expect(root.style.zoom).toBe("0.9");
  expect(root.style.getPropertyValue("--app-font-size")).toBe("16px");
  unmount();
  expect(root.style.zoom).toBe("1");
  expect(root.style.getPropertyValue("--app-display-scale")).toBe("");
  expect(root.dataset.appCssZoom).toBeUndefined();
});

test("uses native webview zoom without a second CSS zoom and falls back if the host rejects it", async () => {
  native.enabled = true;
  const { rerender, unmount } = renderHook(
    ({ scale }) =>
      useApplicationViewController({
        settings: { "view.display_scale": scale, "view.font_size": "14" },
        onUpdateSetting: vi.fn(),
      }),
    { initialProps: { scale: "125" } },
  );
  await waitFor(() => expect(native.setZoom).toHaveBeenCalledWith(1.25));
  await waitFor(() => expect(document.documentElement.style.zoom).toBe("1"));
  expect(document.documentElement.dataset.appCssZoom).toBeUndefined();
  native.setZoom.mockRejectedValueOnce(
    new Error("Host temporarily unavailable"),
  );
  rerender({ scale: "150" });
  await waitFor(() => expect(document.documentElement.style.zoom).toBe("1.5"));
  expect(document.documentElement.dataset.appCssZoom).toBe("true");
  unmount();
  await waitFor(() => expect(native.setZoom).toHaveBeenLastCalledWith(1));
});
