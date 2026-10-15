export type PdfPositionCheckpoint = { page: number; topRatio?: number };

/** Keep one in-flight write and one newest checkpoint, never a backlog of scroll events. */
export function createPdfPositionWriter(options: {
  save(value: PdfPositionCheckpoint): Promise<void>;
  onSaved(): void;
  onError(error: unknown): boolean;
}) {
  let pending: PdfPositionCheckpoint | undefined;
  let failed: PdfPositionCheckpoint | undefined;
  let running = false;
  let blocked = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer); timer = undefined;
    if (running || blocked || !pending) return;
    const value = pending; pending = undefined; running = true;
    // Invoke synchronously so a reopened document's storage load can await this write.
    void options.save(value).then(() => { failed = undefined; options.onSaved(); }, (error: unknown) => {
      failed = value; blocked = options.onError(error);
      if (blocked) pending = undefined;
    }).finally(() => { running = false; if (pending) flush(); });
  };
  return {
    enqueue(value: PdfPositionCheckpoint) {
      if (blocked) return;
      pending = value;
      if (!running) { clearTimeout(timer); timer = setTimeout(flush, 180); }
    },
    flush,
    retry() { if (!blocked && failed) { pending ??= failed; failed = undefined; flush(); } }
  };
}
