import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { useDockLayout } from "../app/features/dock/useDockLayout";
import { loadDockLayout } from "../app/features/dock/dockLayout.storage";
import type { DockBoundaryResize } from "../app/features/dock/dockLayout";

beforeEach(() => localStorage.clear());

const boundary: DockBoundaryResize = {
  before: "left", after: "main", deltaPixels: 4, containerPixels: 1008,
  visibleRegions: ["left", "main", "right"],
  defaultWeights: { left: 24, main: 52, right: 24 },
};

test("accumulates all pointer moves even before React renders, persisting both widths", () => {
  const { result } = renderHook(useDockLayout);
  const resize = result.current.resizeBoundary;
  act(() => { for (let i = 0; i < 30; i++) resize(boundary); });
  expect(result.current.layout.regionWidths.left).toBeCloseTo(36);
  expect(result.current.layout.regionWidths.main).toBeCloseTo(40);
  expect(result.current.layout.regionWidths.right).toBeUndefined();
  expect(loadDockLayout().regionWidths).toEqual(result.current.layout.regionWidths);
});

test("clamps the pair together at a limit and immediately responds when dragging back", () => {
  const { result } = renderHook(useDockLayout);
  act(() => result.current.resizeBoundary({ ...boundary, deltaPixels: 10000 }));
  expect(result.current.layout.regionWidths).toEqual({ left: 68, main: 8 });
  act(() => result.current.resizeBoundary({ ...boundary, deltaPixels: -10 }));
  expect(result.current.layout.regionWidths).toEqual({ left: 67, main: 9 });
});

test("uses only visible columns when a sidebar is collapsed", () => {
  const { result } = renderHook(useDockLayout);
  act(() => result.current.resizeBoundary({ ...boundary, before: "main", after: "right",
    containerPixels: 1004, deltaPixels: 100, visibleRegions: ["main", "right"] }));
  expect(result.current.layout.regionWidths.main).toBeCloseTo(59.6);
  expect(result.current.layout.regionWidths.right).toBeCloseTo(16.4);
  expect(result.current.layout.regionWidths.left).toBeUndefined();
});
