import { afterEach, expect, test, vi } from "vitest";
import { createPdfPositionWriter } from "../app/features/pdf/pdfPositionWriter";
afterEach(() => vi.useRealTimers());
const tick = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };

test("coalesces a fast scroll and retains only the final checkpoint during a slow write", async () => {
  vi.useFakeTimers(); let finish!: () => void;
  const save = vi.fn(async () => {}); save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const writer = createPdfPositionWriter({ save, onSaved: vi.fn(), onError: () => false });
  writer.enqueue({ page: 1 }); writer.enqueue({ page: 2 });
  await vi.advanceTimersByTimeAsync(180); expect(save).toHaveBeenCalledExactlyOnceWith({ page: 2 });
  for (let page = 3; page <= 100; page++) writer.enqueue({ page });
  writer.flush(); expect(save).toHaveBeenCalledTimes(1);
  finish(); await tick(); expect(save).toHaveBeenCalledTimes(2); expect(save).toHaveBeenLastCalledWith({ page: 100 });
});

test("flush commits a trailing location and retry uses the failed checkpoint", async () => {
  vi.useFakeTimers(); const save = vi.fn(async () => {}); save.mockRejectedValueOnce(new Error("disk busy"));
  const onError = vi.fn(() => false), onSaved = vi.fn();
  const writer = createPdfPositionWriter({ save, onSaved, onError });
  writer.enqueue({ page: 4, topRatio: 0.6 }); writer.flush(); await tick();
  expect(onError).toHaveBeenCalledOnce(); writer.retry(); await tick();
  expect(save).toHaveBeenCalledTimes(2); expect(save).toHaveBeenLastCalledWith({ page: 4, topRatio: 0.6 });
  expect(onSaved).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

test("a read-only error prevents queued writes and retries", async () => {
  vi.useFakeTimers(); const save = vi.fn().mockRejectedValue(new Error("unknown schema"));
  const writer = createPdfPositionWriter({ save, onSaved: vi.fn(), onError: () => true });
  writer.enqueue({ page: 2 }); writer.flush(); writer.enqueue({ page: 3 }); await tick();
  writer.retry(); writer.enqueue({ page: 4 }); writer.flush(); await tick();
  expect(save).toHaveBeenCalledOnce();
});
