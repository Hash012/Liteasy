import { PhysicalSize } from "@tauri-apps/api/dpi";
import { expect, test, vi } from "vitest";
import { createFullscreenViewportSync } from "../app/features/workbench/fullscreenViewport";

test("fits the latest physical client bounds after overlapping fullscreen and resize events", async () => {
  let bounds = new PhysicalSize(2560, 1380);
  let release!: () => void;
  const apply = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(undefined);
  const sync = createFullscreenViewportSync(async () => bounds, apply);
  const first = sync.sync();
  await Promise.resolve();
  expect(apply).toHaveBeenCalledWith(bounds);
  bounds = new PhysicalSize(2560, 1440);
  const second = sync.sync();
  release();
  await Promise.all([first, second]);
  expect(apply).toHaveBeenLastCalledWith(bounds);
  expect(apply).toHaveBeenCalledTimes(2);
  await sync.sync();
  expect(apply).toHaveBeenCalledTimes(2);
  await sync.sync(true);
  expect(apply).toHaveBeenCalledTimes(3);
});

test("ignores minimized bounds and cancels a late read after disposal", async () => {
  let finish!: (size: PhysicalSize) => void;
  const read = vi.fn().mockResolvedValueOnce(new PhysicalSize(0, 0))
    .mockImplementationOnce(() => new Promise<PhysicalSize>(resolve => { finish = resolve; }));
  const apply = vi.fn();
  const sync = createFullscreenViewportSync(read, apply);
  await sync.sync();
  const pending = sync.sync();
  sync.dispose();
  finish(new PhysicalSize(1920, 1080));
  await pending;
  expect(apply).not.toHaveBeenCalled();
});
