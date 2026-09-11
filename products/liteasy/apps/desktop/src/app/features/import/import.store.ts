import type { RetrievalChunk } from "../retrieval/retrieval.types";
import type { ImportJob, MineruFigure } from "./import.types";

export function createImportStore() {
  const jobs = new Map<string, ImportJob>();
  let sequence = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    startImport(input: string | { documentId: string; sourcePath: string }) {
      const documentId = typeof input === "string" ? input : input.documentId;
      const sourcePath = typeof input === "string" ? input : input.sourcePath;
      sequence += 1;
      const job: ImportJob = {
        id: `job-${sequence}`,
        documentId,
        sourcePath,
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
