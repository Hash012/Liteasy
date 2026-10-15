import { expect, test, vi } from "vitest";
import { schedulePdfPageRender } from "../app/features/pdf/pdfPageRenderQueue";

const tick = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
test("bounds render work and promotes the target ahead of earlier prefetch requests", async () => {
  const document = {}, started: number[] = [], finish: (() => void)[] = [];
  const add = (page: number, priority: number) => schedulePdfPageRender(document, priority, async () => {
    started.push(page); await new Promise<void>((resolve) => finish.push(resolve));
  });
  add(1, 5); const stale = add(2, 4); add(3, 3); const target = add(4, 2);
  target.setPriority(0); stale.cancel(); await tick();
  expect(started).toEqual([4, 3]);
  finish.shift()!(); await tick(); expect(started).toEqual([4, 3, 1]);
  finish.forEach((resolve) => resolve()); await tick();
});

test("cancellation reaches active work and does not block another document", async () => {
  const first = {}, second = {}; let activeSignal!: AbortSignal; let finish!: () => void;
  const job = schedulePdfPageRender(first, 0, async (signal) => { activeSignal = signal; await new Promise<void>((resolve) => { finish = resolve; }); });
  const run = vi.fn(async () => {}); schedulePdfPageRender(second, 0, run);
  await tick(); expect(run).toHaveBeenCalledOnce(); expect(activeSignal.aborted).toBe(false);
  job.cancel(); expect(activeSignal.aborted).toBe(true); finish(); await tick();
});
