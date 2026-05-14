export type ImportJobStatus = "queued" | "parsing" | "parsed" | "failed";

export type ImportResultPayload = {
  paperId: string;
  title: string;
  content: string;
  pageCount: number;
};

export type ImportJob = {
  id: string;
  sourcePath: string;
  status: ImportJobStatus;
  paperId?: string;
  error?: string;
};
