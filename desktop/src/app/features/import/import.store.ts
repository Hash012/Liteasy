import type { ImportJob, ImportResultPayload } from "./import.types";

export function createImportStore() {
  const jobs = new Map<string, ImportJob>();
  let sequence = 0;

  return {
    startImport(sourcePath: string) {
      sequence += 1;
      const job: ImportJob = {
        id: `job-${sequence}`,
        sourcePath,
        status: "queued",
      };
      jobs.set(job.id, job);
      return job.id;
    },
    markParsing(id: string) {
      const job = jobs.get(id);
      if (!job) return;
      job.status = "parsing";
    },
    markParsed(id: string, payload: ImportResultPayload) {
      const job = jobs.get(id);
      if (!job) return;
      job.status = "parsed";
      job.paperId = payload.paperId;
    },
    markFailed(id: string, error?: string) {
      const job = jobs.get(id);
      if (!job) return;
      job.status = "failed";
      job.error = error ?? "未知错误";
    },
    getJob(id: string) {
      return jobs.get(id);
    },
    getAllJobs(): ImportJob[] {
      return Array.from(jobs.values());
    },
  };
}
