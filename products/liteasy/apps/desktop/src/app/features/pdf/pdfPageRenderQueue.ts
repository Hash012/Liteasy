type Job = { priority: number; abort: AbortController; run(signal: AbortSignal): Promise<void> };
type Queue = { running: number; scheduled: boolean; jobs: Job[] };
const queues = new WeakMap<object, Queue>();
export const PDF_PAGE_RENDER_CONCURRENCY = 2;

/** Batch requests from one React commit before choosing the visible/target page. */
export function schedulePdfPageRender(document: object, priority: number, run: Job["run"]) {
  let queue = queues.get(document);
  if (!queue) { queue = { running: 0, scheduled: false, jobs: [] }; queues.set(document, queue); }
  const state = queue;
  const job: Job = { priority, run, abort: new AbortController() };
  const schedule = () => {
    if (state.scheduled) return;
    state.scheduled = true;
    queueMicrotask(() => {
      state.scheduled = false;
      state.jobs.sort((a, b) => a.priority - b.priority);
      while (state.running < PDF_PAGE_RENDER_CONCURRENCY && state.jobs.length) {
        const next = state.jobs.shift()!;
        if (next.abort.signal.aborted) continue;
        state.running++;
        void Promise.resolve().then(() => next.abort.signal.aborted ? undefined : next.run(next.abort.signal))
          .catch(() => {}).finally(() => { state.running--; schedule(); });
      }
    });
  };
  state.jobs.push(job); schedule();
  return {
    cancel() { job.abort.abort(); const index = state.jobs.indexOf(job); if (index >= 0) state.jobs.splice(index, 1); },
    setPriority(value: number) { job.priority = value; schedule(); }
  };
}
