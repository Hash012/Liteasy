import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { usePdfReaderFeedback } from "../app/features/pdf/usePdfReaderFeedback";

afterEach(() => vi.useRealTimers());
test("navigation expires separately and a later error cancels the old announcement", () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(usePdfReaderFeedback);
  act(() => result.current.announceNavigation("已转到第 2 页。"));
  expect(result.current.status).toBe("");
  act(() => vi.advanceTimersByTime(1500));
  act(() => result.current.announceNavigation("已转到第 3 页。"));
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.announcement.text).toBe("已转到第 3 页。");
  act(() => result.current.setStatus("批注保存失败，请重试。"));
  expect(result.current.announcement.text).toBe("");
  act(() => vi.advanceTimersByTime(3000));
  expect(result.current.status).toBe("批注保存失败，请重试。");
  act(() => result.current.announceNavigation("已转到第 4 页。"));
  act(() => vi.advanceTimersByTime(2000));
  expect(result.current.announcement.text).toBe("");
  expect(result.current.status).toBe("批注保存失败，请重试。");
  act(() => result.current.announceNavigation("已转到第 5 页。"));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
