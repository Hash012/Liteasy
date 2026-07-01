import { act, renderHook } from "@testing-library/react";
import { usePaneLayout } from "../app/layout/usePaneLayout";

test("starts with the confirmed default layout and persists user changes", () => {
  const { result } = renderHook(() => usePaneLayout());

  expect(result.current.layout).toEqual({
    center: 52,
    left: 24,
    right: 24
  });
  expect(result.current.collapsed).toEqual({
    bottom: false,
    left: false,
    right: false
  });

  act(() => {
    result.current.setLayout({ center: 58, left: 22, right: 20 });
  });

  expect(result.current.layout).toEqual({
    center: 58,
    left: 22,
    right: 20
  });

  act(() => {
    result.current.setCollapsed("bottom", true);
  });

  expect(result.current.collapsed.bottom).toBe(true);
});
