import type { DocumentFormat, ExportReceipt } from "../document-export/documentExport.types";
export type ArtifactDocumentFormat = DocumentFormat;

export type ArtifactExportPayload = {
  artifactId: string;
  content: string;
  contentEncoding: "base64" | "utf8";
  fileName: string;
  format: ArtifactDocumentFormat;
  title: string;
  mimeType?: string;
  container?: "zip";
  receipt?: ExportReceipt;
  protectedPaths?: string[];
  scopeId?: string;
  sessionGeneration?: string;
};

type ArtifactExportRecordBase = {
  artifactId: string;
  exportedAt: string;
  fileName: string;
  format: ArtifactDocumentFormat | "unknown";
  id: string;
  title: string;
  originalFormat?: string;
  receipt?: ExportReceipt;
};

export type ArtifactExportRecord = ArtifactExportRecordBase & (
  | {
      location: "desktop";
      path: string;
      status: "available" | "missing" | "unsupported";
    }
  | {
      location: "browser";
      status: "browser_managed" | "unsupported";
    }
);

export type ArtifactExportOutcome =
  | { status: "cancelled" }
  | { record: ArtifactExportRecord; status: "saved" | "download_started"; warnings?: string[] };

export type ArtifactExportHistoryStatus = "error" | "idle" | "loading" | "ready";
