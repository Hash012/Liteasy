export type LocalLibraryEntry = {
  id: string;
  /** `null` for an entry with no body on disk — listable and citable, but not openable.
   *  A non-open-access record can never be more than this. */
  path: string | null;
  title: string;
};

export type LocalLibrarySnapshot = {
  entries: LocalLibraryEntry[];
  rootPath: string;
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
