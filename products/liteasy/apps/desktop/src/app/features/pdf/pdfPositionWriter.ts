import type { PdfReaderViewState } from "./pdfReaderPosition";

export type PdfPositionCheckpoint = { page: number; topRatio?: number; pageCount?: number; view?: PdfReaderViewState };

/** Keep one in-flight write and one newest checkpoint, never a backlog of scroll events. */
export function createPdfPositionWriter(options: {
  save(value: PdfPositionCheckpoint): Promise<void>;
  onSaved(): void;
  onError(error: unknown): boolean;
}) {
  let pending: PdfPositionCheckpoint | undefined;
  let failed: PdfPositionCheckpoint | undefined;
  let running: Promise<void> | undefined;
  let lastError: unknown;
  let blocked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    if (running || blocked || !pending) return;
    const value = pending; pending = undefined;
    // Invoke synchronously so a reopened document's storage load can await this write.
    running = options.save(value).then(() => { failed = undefined; lastError = undefined; options.onSaved(); }, (error: unknown) => {
      failed = value; lastError = error; blocked = options.onError(error);
      if (blocked) pending = undefined;
    }).finally(() => { running = undefined; if (pending) flush(); });
  };
  return {
    enqueue(value: PdfPositionCheckpoint) {
      if (blocked) return;
      pending = value;
      if (!running) { clearTimeout(timer); timer = setTimeout(flush, 180); }
    },
    flush,
    async flushAndWait() {
      // Retry a transient failure once when closing, and wait for the newest queued checkpoint.
      if (!blocked && failed) { pending ??= failed; failed = undefined; }
      flush();
      while (running) await running;
      if (failed && !blocked) throw lastError;
    },
    retry() { if (!blocked && failed) { pending ??= failed; failed = undefined; flush(); } }
  };
}
