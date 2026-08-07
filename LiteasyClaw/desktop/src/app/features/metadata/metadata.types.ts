export type DocumentMetadataSyncStatus = "idle" | "unauthenticated" | "syncing" | "success" | "error";

export type DocumentMetadataSyncDocument = {
  authors?: string[];
  contentHash?: string;
  doi?: string;
  publicationYear?: number;
  syncDocumentId: string;
  title: string;
};

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
