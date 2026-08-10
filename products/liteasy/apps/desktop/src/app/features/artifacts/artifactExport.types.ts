export type ArtifactDocumentFormat = "html" | "markdown" | "pdf";

export type ArtifactExportPayload = {
  artifactId: string;
  content: string;
  contentEncoding: "base64" | "utf8";
  fileName: string;
  format: ArtifactDocumentFormat;
  title: string;
};

type ArtifactExportRecordBase = {
  artifactId: string;
  exportedAt: string;
  fileName: string;
  format: ArtifactDocumentFormat;
  id: string;
  title: string;
};

export type ArtifactExportRecord = ArtifactExportRecordBase & (
  | {
      location: "desktop";
      path: string;
      status: "available" | "missing";
    }
  | {
      location: "browser";
      status: "browser_managed";
    }
);

export type ArtifactExportOutcome =
  | { status: "cancelled" }
  | { record: ArtifactExportRecord; status: "saved" };

export type ArtifactExportHistoryStatus = "error" | "idle" | "loading" | "ready";
