import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePdfPageWindow } from "../app/features/pdf/usePdfPageWindow";

afterEach(() => vi.restoreAllMocks());

test("coalesces scroll events and reuses page offsets until layout changes", () => {
  let resize!: () => void;
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  const frames = new Map<number, FrameRequestCallback>(); let next = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.set(++next, callback); return next; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  const flush = () => act(() => { const work = [...frames.values()]; frames.clear(); work.forEach((callback) => callback(0)); });
  const root = document.createElement("div");
  root.getBoundingClientRect = vi.fn(() => ({ top: 0, bottom: 600, height: 600 } as DOMRect));
  const reads = Array.from({ length: 180 }, (_, index) => {
    const page = document.createElement("div"); page.className = "pdf-page-shell"; page.dataset.page = String(index + 1);
    page.getBoundingClientRect = vi.fn(() => ({ top: index * 800 - root.scrollTop, bottom: (index + 1) * 800 - root.scrollTop, width: 600 } as DOMRect));
    root.append(page); return page.getBoundingClientRect;
  });
  const onVisiblePage = vi.fn();
  const options = { enabled: true, document: {}, focusedPage: 1, pageCount: 180, layout: "continuous", zoom: 100, width: 600, onVisiblePage };
  const stage = { current: root }, frame = { current: root };
  const hook = renderHook(() => usePdfPageWindow(stage, frame, options));
  expect(reads[0]).toHaveBeenCalledTimes(1);
  act(() => { root.scrollTop = 169 * 800; for (let index = 0; index < 20; index++) root.dispatchEvent(new Event("scroll")); });
  expect(onVisiblePage).not.toHaveBeenCalled(); flush();
  expect(onVisiblePage).toHaveBeenCalledExactlyOnceWith(170, 0);
  expect(hook.result.current.has(170)).toBe(true);
  expect(hook.result.current.size).toBeLessThanOrEqual(6);
  expect(reads[0]).toHaveBeenCalledTimes(1);
  act(() => resize()); flush(); expect(reads[0]).toHaveBeenCalledTimes(2);
  hook.unmount(); vi.unstubAllGlobals();
});
