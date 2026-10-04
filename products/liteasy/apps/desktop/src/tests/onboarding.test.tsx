import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useOnboardingController } from "../app/controllers/useOnboardingController";
import { createDefaultDockLayout, moveDockItem, openDockItem, splitDockRegion } from "../app/features/dock/dockLayout";
import { useDockLayout } from "../app/features/dock/useDockLayout";
import { createOnboardingLayout, onboardingSteps, onboardingStorageKey, placeTourCard } from "../app/features/onboarding/onboarding";

beforeEach(() => localStorage.clear());

test("the tour restores useful pages without dropping existing tabs or custom regions", () => {
  let layout = splitDockRegion(createDefaultDockLayout(), "main", "right", "bar-research");
  layout = moveDockItem(openDockItem(layout, "paper-note"), "paper-note", "bar-research");
  layout = moveDockItem(layout, "library", "right");
  layout.regionWidths = { left: 60, main: 8, right: 32 };
  const before = JSON.stringify(layout);
  const result = createOnboardingLayout(layout);
  expect(JSON.stringify(layout)).toBe(before);
  expect(result.regions.left.itemIds).toEqual(["library", "notes", "artifact-library"]);
  expect(result.regions.main.itemIds).toEqual(["help", "settings"]);
  expect(result.regions.bottom.activeItemId).toBe("workflow-runs");
  expect(result.regions["bar-research"].itemIds).toEqual(["paper-note"]);
  const all = Object.values(result.regions).flatMap(region => region.itemIds);
  expect(new Set(all).size).toBe(all.length);
  expect(result.regionWidths).toEqual({});
  expect(createOnboardingLayout(result)).toEqual(result);
});

function fixture() {
  const ports = { resetPaneSizes: vi.fn(), restoreVisibility: vi.fn(), open: vi.fn(), openManual: vi.fn(), leaveFocus: vi.fn(), closeBoard: vi.fn() };
  const hook = renderHook(() => {
    const dock = useDockLayout();
    return { dock, tour: useOnboardingController({ ...ports, dock, activate: dock.activateItem }) };
  });
  return { ...hook, ports };
}

test("first-run invitation is dismissible and manual replay resets layout and progress every time", () => {
  const { result, ports, unmount } = fixture();
  expect(result.current.tour.invitation).toBe(true);
  expect(result.current.tour.index).toBeNull();
  act(() => result.current.tour.dismissInvitation());
  act(() => result.current.dock.closeItem("library"));
  act(() => result.current.dock.moveDynamicItem("unsaved-note", "right"));
  act(() => result.current.tour.start());
  expect(ports.leaveFocus).toHaveBeenCalledTimes(1);
  expect(ports.resetPaneSizes).toHaveBeenCalledTimes(1);
  expect(ports.restoreVisibility).toHaveBeenCalledWith({ collapsed: { left: false, right: false, bottom: false }, hiddenRegions: [] });
  expect(result.current.dock.layout.regions.left.activeItemId).toBe("library");
  expect(result.current.dock.dynamicItemRegions["unsaved-note"]).toBe("right");
  act(() => result.current.tour.next());
  expect(ports.openManual).toHaveBeenLastCalledWith("reading.pdf");
  act(() => result.current.tour.previous());
  expect(ports.open).toHaveBeenLastCalledWith("library");
  for (let i = 0; i < onboardingSteps.length; i++) act(() => result.current.tour.next());
  expect(result.current.tour.index).toBeNull();
  expect(JSON.parse(localStorage.getItem(onboardingStorageKey)!)).toEqual({ version: 1, status: "completed" });
  act(() => result.current.tour.start());
  expect(result.current.tour.index).toBe(0);
  expect(ports.resetPaneSizes).toHaveBeenCalledTimes(2);
  unmount();
  const later = fixture();
  expect(later.result.current.tour.invitation).toBe(false);
  expect(later.result.current.tour.index).toBeNull();
});

test("automatic playback pauses off-window, stops at the final step and cleans up after exit", () => {
  vi.useFakeTimers();
  try {
    const { result, unmount } = fixture();
    act(() => { result.current.tour.start(); result.current.tour.toggleAutomatic(); });
    act(() => vi.advanceTimersByTime(12000));
    expect(result.current.tour.index).toBe(1);
    act(() => window.dispatchEvent(new Event("blur")));
    act(() => vi.advanceTimersByTime(60000));
    expect(result.current.tour.index).toBe(1);
    act(() => window.dispatchEvent(new Event("focus")));
    for (let i = 1; i < onboardingSteps.length; i++) act(() => vi.advanceTimersByTime(12000));
    expect(result.current.tour.index).toBe(onboardingSteps.length - 1);
    act(() => result.current.tour.close());
    act(() => vi.advanceTimersByTime(60000));
    expect(result.current.tour.index).toBeNull();
    expect(result.current.tour.automatic).toBe(false);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test("card placement prefers an unobstructed side and remains inside narrow viewports", () => {
  const size = { width: 360, height: 330 };
  const target = { left: 60, top: 70, width: 280, height: 550 };
  const wide = placeTourCard(target, size, { width: 1440, height: 900 });
  expect(wide.left).toBeGreaterThan(target.left + target.width);
  const narrow = placeTourCard(target, { width: 296, height: 400 }, { width: 320, height: 450 });
  expect(narrow.left).toBeGreaterThanOrEqual(12);
  expect(narrow.left + 296).toBeLessThanOrEqual(308);
  expect(narrow.top + 400).toBeLessThanOrEqual(438);
});
