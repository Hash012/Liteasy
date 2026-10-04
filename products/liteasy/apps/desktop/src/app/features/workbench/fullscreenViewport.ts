import type { PhysicalSize } from "@tauri-apps/api/dpi";

/** Fit the WebView to the client area, using physical pixels without applying DPI twice.
 * Resize events may arrive before or after setFullscreen resolves. Serialize writes
 * and read the latest bounds again if another event arrives during an IPC request.
 */
export function createFullscreenViewportSync(read: () => Promise<PhysicalSize>, apply: (size: PhysicalSize) => Promise<void>) {
  let running: Promise<void> | undefined;
  let dirty = false;
  let lastSize = "";
  let disposed = false;
  return {
    sync(force = false): Promise<void> {
      if (disposed) return Promise.resolve();
      if (force) lastSize = "";
      dirty = true;
      if (!running) running = (async () => {
        while (dirty && !disposed) {
          dirty = false;
          const size = await read();
          if (disposed || size.width <= 0 || size.height <= 0) continue;
          const key = `${size.width}:${size.height}`;
          if (lastSize === key) continue;
          await apply(size);
          lastSize = key;
        }
      })().finally(() => { running = undefined; });
      return running;
    },
    dispose() { disposed = true; dirty = false; },
  };
}
