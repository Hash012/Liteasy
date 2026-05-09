export type ImportJobStatus = "queued" | "parsing" | "parsed" | "failed";

export type ImportJob = {
  id: string;
  sourcePath: string;
  status: ImportJobStatus;
  paperId?: string;
};
