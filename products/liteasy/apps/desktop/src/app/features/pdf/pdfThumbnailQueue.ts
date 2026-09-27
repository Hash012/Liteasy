/** One bounded queue per PDF, shared by sidebar and overview canvases. */
type Job = { controller: AbortController; run(signal: AbortSignal): Promise<void> };
const queues = new WeakMap<object, { running: number; pending: Job[] }>();
export function schedulePdfThumbnail(document: object, run: Job["run"]) {
  let queue = queues.get(document);
  if (!queue) { queue = { running: 0, pending: [] }; queues.set(document, queue); }
  const state = queue;
  const job = { controller: new AbortController(), run };
  function pump() {
    while (state.running < 2 && state.pending.length) {
      const next = state.pending.shift()!;
      if (next.controller.signal.aborted) continue;
      state.running += 1;
      void Promise.resolve().then(() => next.controller.signal.aborted ? undefined : next.run(next.controller.signal))
        .catch(() => {}).finally(() => { state.running -= 1; pump(); });
    }
  }
  state.pending.push(job); pump();
  return () => { job.controller.abort(); const index = state.pending.indexOf(job); if (index >= 0) state.pending.splice(index, 1); };
}
