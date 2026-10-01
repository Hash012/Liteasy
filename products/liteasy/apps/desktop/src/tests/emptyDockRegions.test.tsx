import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useEmptyDockRegionsController } from "../app/controllers/useEmptyDockRegionsController";
import type { DockRegionId } from "../app/features/dock/dock.types";

test("collapses the last static or dynamic tab, preserving newly split/reopened empty panels", () => {
  const close = vi.fn();
  const initialProps = { counts: { main: 1, left: 2, right: 1, "bar-new": 0 } as Partial<Record<DockRegionId, number>>, bottomOrder: [] as DockRegionId[], enabled: true, close };
  const { result, rerender } = renderHook(useEmptyDockRegionsController, { initialProps });
  expect(close).not.toHaveBeenCalled();
  rerender({ ...initialProps, counts: { main: 1, left: 1, right: 0, "bar-new": 0 } });
  expect(close).toHaveBeenCalledExactlyOnceWith("right");
  expect(result.current.hidden).toEqual(["right"]);
  act(() => result.current.reveal("right"));
  expect(result.current.hidden).toEqual([]);
  rerender({ ...initialProps, counts: { main: 0, left: 1, right: 0, "bar-new": 0 } });
  expect(result.current.hidden).toEqual(["main"]);
  // Reopening a document shows its region again; disabling the preference clears it too.
  rerender(initialProps); expect(result.current.hidden).toEqual([]);
  rerender({ ...initialProps, enabled: false, counts: { main: 0, left: 0, right: 0 } });
  expect(close).toHaveBeenCalledTimes(1); expect(result.current.hidden).toEqual([]);
});

test("closing an empty bottom split never hides occupied siblings", () => {
  const close = vi.fn();
  const initialProps = { counts: { bottom: 1, "bar-bottom": 1 } as Partial<Record<DockRegionId, number>>, bottomOrder: ["bottom", "bar-bottom"] as DockRegionId[], enabled: true, close };
  const { result, rerender } = renderHook(useEmptyDockRegionsController, { initialProps });
  rerender({ ...initialProps, counts: { bottom: 0, "bar-bottom": 1 } });
  expect(close).not.toHaveBeenCalled(); expect(result.current.hidden).toEqual(["bottom"]);
  rerender({ ...initialProps, counts: { bottom: 0, "bar-bottom": 0 } });
  expect(close.mock.calls).toEqual([["bar-bottom"], ["bottom"]]);
});
