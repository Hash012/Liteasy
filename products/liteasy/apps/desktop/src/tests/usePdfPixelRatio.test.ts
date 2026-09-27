import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePdfPixelRatio } from "../app/features/pdf/usePdfPixelRatio";

afterEach(() => vi.restoreAllMocks());

test("tracks resolution changes without a resize and re-arms the query for the new monitor", () => {
  let ratio = 1;
  vi.spyOn(window, "devicePixelRatio", "get").mockImplementation(() => ratio);
  const queries: { query: string; listeners: Set<() => void> }[] = [];
  vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const listeners = new Set<() => void>();
    queries.push({ query, listeners });
    return { addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
    } as unknown as MediaQueryList;
  });
  const { result, unmount } = renderHook(usePdfPixelRatio);
  expect(result.current).toBe(1);
  for (const next of [1.25, 2, 1]) {
    const previous = queries.at(-1)!;
    act(() => { ratio = next; [...previous.listeners].forEach((listener) => listener()); });
    expect(result.current).toBe(next);
    expect(previous.listeners.size).toBe(0);
    expect(queries.at(-1)?.query).toBe(`(resolution: ${next}dppx)`);
  }
  unmount();
  expect(queries.at(-1)?.listeners.size).toBe(0);
});
