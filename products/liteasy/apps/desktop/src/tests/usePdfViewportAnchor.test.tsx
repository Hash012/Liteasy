import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePdfViewportAnchor } from "../app/features/pdf/usePdfViewportAnchor";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function fixture() {
  vi.useFakeTimers();
  let resize!: () => void;
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  const frames = new Map<number, FrameRequestCallback>(); let next = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.set(++next, callback); return next; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  const flush = () => act(() => { const work = [...frames.values()]; frames.clear(); work.forEach((callback) => callback(0)); });
  const root = document.createElement("div"), page = document.createElement("article");
  page.className = "pdf-page-shell"; page.dataset.page = "1"; root.append(page); root.scrollTop = 1200;
  const dimensions = { top: 1000, width: 400, height: 800 };
  root.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: 400 } as DOMRect);
  page.getBoundingClientRect = () => ({ top: dimensions.top - root.scrollTop, bottom: dimensions.top - root.scrollTop + dimensions.height,
    left: -root.scrollLeft, right: dimensions.width - root.scrollLeft, width: dimensions.width, height: dimensions.height } as DOMRect);
  const stage = { current: root }, frame = { current: root };
  const options = { enabled: true, document: {}, focusedPage: 1, zoom: 100, width: 400, layout: "continuous" };
  const hook = renderHook((props) => usePdfViewportAnchor(stage, frame, props), { initialProps: options });
  return { hook, options, root, dimensions, resize: () => act(() => resize()), flush };
}

test("zoom and a later page-size correction retain the same PDF point at the reading line", () => {
  const view = fixture();
  view.dimensions.top = 2000; view.dimensions.height = 1600; view.dimensions.width = 800;
  view.hook.rerender({ ...view.options, zoom: 200 });
  expect(view.root.scrollTop).toBe(2464); expect(view.root.scrollLeft).toBe(100);
  view.dimensions.top += 250; view.resize(); view.flush();
  expect(view.root.scrollTop).toBe(2714);
});

test("explicit navigation discards a pending layout correction", () => {
  const view = fixture(); view.dimensions.top += 250; view.resize();
  act(() => view.hook.result.current.reset());
  view.root.scrollTop = 1300; act(() => { view.root.dispatchEvent(new Event("scroll")); vi.advanceTimersByTime(180); }); view.flush();
  expect(view.root.scrollTop).toBe(1300);
  view.dimensions.top += 100; view.resize(); view.flush(); expect(view.root.scrollTop).toBe(1400);
});

test("a navigation target is corrected after mixed page sizes settle and wheel input cancels it", () => {
  const view = fixture();
  act(() => view.hook.result.current.reset(1, 0.4));
  view.dimensions.top += 250;
  act(() => vi.advanceTimersByTime(180));
  expect(view.root.scrollTop).toBe(1570);
  act(() => view.hook.result.current.reset(1, 0.8));
  act(() => view.root.dispatchEvent(new Event("wheel")));
  act(() => vi.advanceTimersByTime(180));
  expect(view.root.scrollTop).toBe(1570);
});

test("navigation from an overview retains its target when the document view becomes visible", () => {
  const view = fixture(); view.hook.rerender({ ...view.options, enabled: false });
  act(() => view.hook.result.current.reset(1, 0.5));
  view.hook.rerender(view.options);
  act(() => vi.advanceTimersByTime(180));
  expect(view.root.scrollTop).toBe(1400);
});

test("a large manual scroll captures the newly committed page before a resize", () => {
  const view = fixture(), second = document.createElement("article");
  second.className = "pdf-page-shell"; second.dataset.page = "2"; view.root.append(second);
  let top = 2000;
  second.getBoundingClientRect = () => ({ top: top - view.root.scrollTop, bottom: top + 800 - view.root.scrollTop,
    left: 0, right: 400, width: 400, height: 800 } as DOMRect);
  view.root.scrollTop = 2200; act(() => view.root.dispatchEvent(new Event("scroll"))); view.flush();
  view.hook.rerender({ ...view.options, focusedPage: 2 });
  top += 150; view.resize(); view.flush();
  expect(view.root.scrollTop).toBe(2350);
});
