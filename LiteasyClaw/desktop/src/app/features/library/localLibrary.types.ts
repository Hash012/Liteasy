export type LocalLibraryEntry = {
  contentHash: string | null;
  id: string;
  /** `null` for an entry with no body on disk — listable and citable, but not openable.
   *  A non-open-access record can never be more than this. */
  path: string | null;
  relativePath: string | null;
  title: string;
};

export type LocalLibraryFolder = {
  name: string;
  parentPath: string | null;
  path: string;
};

export type LocalLibraryTrashEntry = {
  byteLength: number;
  documentCount: number;
  name: string;
  nodeType: "document" | "folder" | "metadata_entry";
  originalRelativePath: string;
  purgeAfter: number;
  trashId: string;
  trashedAt: number;
};

export type LocalLibrarySnapshot = {
  entries: LocalLibraryEntry[];
  folders: LocalLibraryFolder[];
  libraryId: string;
  revision: number;
  rootPath: string;
  trashEntries: LocalLibraryTrashEntry[];
};

export type LocalLibraryChangedEvent = {
  externalDeletion: boolean;
  fullRescan: boolean;
  operationId?: string;
  paths: string[];
  revision: number;
  snapshot: LocalLibrarySnapshot;
};

export type LocalLibraryWatchErrorEvent = {
  code: "local_library_rescan_failed" | "local_library_watch_failed";
  message: string;
  traceId: string;
};

export type DuplicateLocalPdf = {
  contentHash: string;
  existingDocumentIds: string[];
  name: string;
};

export type LocalLibraryImportResult = {
  duplicates: DuplicateLocalPdf[];
  snapshot: LocalLibrarySnapshot;
  status: "cancelled" | "duplicate" | "imported";
};

export type ZoteroPdfDirectoryImportResult = {
  duplicateCount: number;
  importedCount: number;
  snapshot: LocalLibrarySnapshot;
  status: "cancelled" | "imported";
};
