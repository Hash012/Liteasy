const owners = new Map<string, number>();
let active = 0;
const queue: Array<{ owner: string; signal: AbortSignal; start(): void; abort(): void }> = [];
/** A window-wide cap shared by manual runs, triggers and nested execution. */
export function acquireExecutionSlot(owner: string, signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted();
  if (queue.length >= 40) return Promise.reject(new Error("后台队列已满，请稍后重试。"));
  return new Promise((resolve, reject) => {
    const entry = { owner, signal, start, abort };
    function abort() { const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); reject(signal.reason); }
    function start() {
      signal.removeEventListener("abort", abort); active++; owners.set(owner, (owners.get(owner) ?? 0) + 1);
      let released = false;
      resolve(() => { if (released) return; released = true; active--; const count = (owners.get(owner) ?? 1) - 1; if (count) owners.set(owner, count); else owners.delete(owner); drain(); });
    }
    queue.push(entry); signal.addEventListener("abort", abort, { once: true }); drain();
  });
}
function drain() {
  for (let index = 0; index < queue.length && active < 4;) {
    const entry = queue[index];
    if ((owners.get(entry.owner) ?? 0) >= 2) { index++; continue; }
    queue.splice(index, 1); entry.start();
  }
}
export const executionQuotaUsage = () => ({ active, queued: queue.length });
