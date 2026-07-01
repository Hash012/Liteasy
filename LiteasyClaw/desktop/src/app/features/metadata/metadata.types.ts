import type { Paper } from "../workspace/workspace.types";

export type DocumentMetadataSyncStatus = "idle" | "unauthenticated" | "syncing" | "success" | "error";

export type DocumentMetadataSyncDocument = Pick<Paper, "id" | "sourcePath" | "title">;

export type DocumentMetadataSyncInput = {
  documents: DocumentMetadataSyncDocument[];
  sessionId: string;
  workspaceRevision: number;
};

export type DocumentMetadataSyncResult = {
  acceptedCount: number;
  rejectedCount: number;
  syncId: string;
  syncedAt: string;
};
