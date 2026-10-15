import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { ImportJob, MineruFigure } from "./import.types";
import type { ObjectStorage } from "../objects/objectStorage";
import { resourceContentRevision } from "../resource-filesystem/resourceFileContent";

export function createImportStore() {
  const jobs = new Map<string, ImportJob>();
  let sequence = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let tail = Promise.resolve();
  const controllers = new Map<string, AbortController>();
  const pending = new Map<string, Promise<unknown>>();

  /** The existing import store owns execution too. A durable account lease bounds multiple windows. */
  function schedule<T>(input: { key: string; storage?: ObjectStorage; active(): boolean }, run: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
    const previous = pending.get(input.key); if (previous) return previous as Promise<T>;
    const controller = new AbortController(); controllers.set(input.key, controller);
    const check = () => { if (!input.active()) controller.abort(); controller.signal.throwIfAborted(); };
    const operation = tail.catch(() => {}).then(async () => {
      const id = crypto.randomUUID(), leaseKey = "imports/processing-lease/v1";
      const storage = input.storage;
      const resultKey = storage ? `imports/results/${await resourceContentRevision(input.key)}` : "";
      const deadline = Date.now() + 300_000;
      let leaseVersion: string | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      try {
        while (storage) {
          check();
          const result = await storage.get(resultKey); check();
          if (result) return result.value as T;
          if (Date.now() >= deadline) throw new Error("等待解析超时，请稍后重试。");
          const row = await storage.get(leaseKey), lease = row?.value as { until: number } | undefined;
          if (!lease || lease.until <= Date.now()) {
            try { await storage.commit([{ key: leaseKey, expected: row?.version ?? null, row: { key: leaseKey, version: id, value: { until: Date.now() + 30_000 } } }]); leaseVersion = id; break; }
            catch (error) { if ((error as { code?: string }).code !== "revision_conflict") throw error; }
          }
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        check();
        let renewing = false;
        heartbeat = setInterval(() => {
          if (Date.now() > deadline) controller.abort();
          if (renewing || !storage || !leaseVersion) return;
          renewing = true;
          void (async () => { check(); await storage.commit([{ key: leaseKey, expected: leaseVersion!, row: { key: leaseKey, version: leaseVersion!, value: { until: Date.now() + 30_000 } } }]); })()
            .catch(() => controller.abort()).finally(() => { renewing = false; });
        }, 5000);
        const value = await run(controller.signal, check); check();
        if (storage) {
          const row = await storage.get(resultKey); check();
          await storage.commit([{ key: resultKey, expected: row?.version ?? null, row: { key: resultKey, version: crypto.randomUUID(), value } }]);
        }
        check(); return value;
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (storage && leaseVersion) {
          const row = await storage.get(leaseKey).catch(() => null);
          if (row?.version === leaseVersion) await storage.commit([{ key: leaseKey, expected: leaseVersion, row: null }]).catch(() => {});
        }
      }
    });
    tail = operation.then(() => {}, () => {});
    pending.set(input.key, operation);
    void operation.finally(() => { if (pending.get(input.key) === operation) pending.delete(input.key); controllers.delete(input.key); }).catch(() => {});
    return operation;
  }

  return {
    schedule,
    cancel(key: string) { controllers.get(key)?.abort(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    startImport(input: string | { documentId: string; sourcePath: string; taskKey?: string }) {
      const documentId = typeof input === "string" ? input : input.documentId;
      const sourcePath = typeof input === "string" ? input : input.sourcePath;
      sequence += 1;
      const job: ImportJob = {
        id: `job-${sequence}`,
        documentId,
        sourcePath,
        taskKey: typeof input === "string" ? undefined : input.taskKey,
        status: "queued"
      };
      jobs.set(job.id, job);
      notify();
      return job.id;
    },
    markParsing(id: string) {
      const job = jobs.get(id);
      if (!job) return;
      job.status = "parsing";
      job.error = undefined;
      notify();
    },
    markParsed(id: string, payload: { paperId: string; chunks?: RetrievalChunk[]; mineruFigures?: MineruFigure[] }) {
      const job = jobs.get(id);
      if (!job) return;
      job.status = "parsed";
      job.error = undefined;
      job.paperId = payload.paperId;
      job.parsedChunks = payload.chunks ?? [];
      job.mineruFigures = payload.mineruFigures ?? [];
      notify();
    },
    markFailed(id: string, error?: string) {
      const job = jobs.get(id);
      if (!job) return;
      job.status = "failed";
      job.error = error;
      notify();
    },
    getJob(id: string) {
      return jobs.get(id);
    },
    getLatestJobByDocumentId(documentId: string) {
      const matchingJobs = Array.from(jobs.values()).filter(
        (job) => job.documentId === documentId
      );
      return matchingJobs[matchingJobs.length - 1];
    },
    getParsedChunksByDocumentId(documentId: string) {
      return this.getLatestJobByDocumentId(documentId)?.parsedChunks ?? [];
    },
    listJobs() {
      return Array.from(jobs.values());
    }
  };
}
