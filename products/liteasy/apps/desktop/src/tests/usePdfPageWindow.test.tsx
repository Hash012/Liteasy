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

test("a hidden or not-yet-sized page never checkpoints a synthetic zero offset", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frame = callback; return 1; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const root = document.createElement("div");
  root.getBoundingClientRect = () => ({ top: 0, bottom: 0, height: 0 } as DOMRect);
  const onVisiblePage = vi.fn();
  const stage = { current: root };
  const hook = renderHook(() => usePdfPageWindow(stage, stage, {
    enabled: true, document: {}, focusedPage: 6, pageCount: 12, layout: "continuous", zoom: 100, width: 0, onVisiblePage
  }));
  act(() => { root.dispatchEvent(new Event("scroll")); frame?.(0); });
  expect(onVisiblePage).not.toHaveBeenCalled();
  hook.unmount(); vi.unstubAllGlobals();
});


test("native scroll anchoring cannot reuse page bounds from before a page-size correction", () => {
  let resize!: () => void;
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  const frames = new Map<number, FrameRequestCallback>(); let next = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++next, callback); return next; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  const flush = () => act(() => { const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback(0)); });
  const root = document.createElement("div");
  let extraHeight = 0;
  Object.defineProperty(root, "scrollHeight", { get: () => 12 * 854 + extraHeight });
  root.getBoundingClientRect = () => ({ top: 0, bottom: 797, height: 797 } as DOMRect);
  for (let index = 0; index < 12; index++) {
    const page = document.createElement("div"); page.className = "pdf-page-shell"; page.dataset.page = String(index + 1);
    page.getBoundingClientRect = () => ({ top: index * 854 + (index >= 6 ? extraHeight : 0) - root.scrollTop,
      bottom: (index + 1) * 854 + (index >= 5 ? extraHeight : 0) - root.scrollTop, width: 600 } as DOMRect);
    root.append(page);
  }
  root.scrollTop = 5500;
  const onVisiblePage = vi.fn(), stage = { current: root }, pdfDocument = {};
  const hook = renderHook(() => usePdfPageWindow(stage, stage, { enabled: true, document: pdfDocument, focusedPage: 7, pageCount: 12, layout: "continuous", zoom: 100, width: 600, onVisiblePage }));
  act(() => root.dispatchEvent(new Event("scroll"))); flush();
  expect(onVisiblePage).toHaveBeenLastCalledWith(7, 0.44028);
  // A late render discovers page 6 is taller. Browser scroll anchoring keeps the
  // same text on screen, but scroll events/rAF may run before ResizeObserver.
  extraHeight = 284; root.scrollTop += extraHeight;
  act(() => root.dispatchEvent(new Event("scroll"))); flush();
  expect(onVisiblePage).toHaveBeenLastCalledWith(7, 0.44028);
  act(() => resize()); flush();
  expect(onVisiblePage).toHaveBeenLastCalledWith(7, 0.44028);
  hook.unmount(); vi.unstubAllGlobals();
});
