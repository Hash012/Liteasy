export type ReadingCatalogFormat = "pdf" | "epub" | "mobi" | "fb2" | "html" | "markdown" | "txt" | "other";

export type ReadingCatalogStatus = "unread" | "reading" | "finished";

/** A presentation record: original papers and imported books keep their own storage identities. */
export type ReadingCatalogEntry = import("./libraryAssetMetadata").LibraryAssetMetadata & Partial<Record<import("./bibliographicFields").BibliographicField, string>> & {
  id: string;
  title: string;
  format: ReadingCatalogFormat;
  authors?: string[];
  year?: number;
  publication?: string;
  doi?: string;
  identifier?: string;
  language?: string;
  publishedAt?: string;
  abstract?: string;
  tags?: string[];
  collection?: string;
  /** Directory relative to the local library root, separate from category metadata. */
  folderPath?: string;
  readingStatus?: ReadingCatalogStatus;
  addedAt?: string;
  updatedAt?: string;
  fileSize?: number;
  fileName?: string;
  physicalPath?: string;
  liteasyPath?: string;
  available?: boolean;
  canExport?: boolean;
  canRemove?: boolean;
  bibliographicRevision?: number;
};

export type ReadingCatalogMetadataPatch = import("./libraryAssetMetadata").LibraryAssetMetadata & {
  tags?: string[];
  collection?: string;
  /** Directory relative to the local library root, separate from category metadata. */
  folderPath?: string;
  readingStatus?: ReadingCatalogStatus;
};

export const readingCatalogFormatLabels: Record<ReadingCatalogFormat, string> = {
  pdf: "PDF",
  epub: "EPUB",
  mobi: "MOBI",
  fb2: "FB2",
  html: "HTML",
  markdown: "Markdown",
  txt: "TXT",
  other: "其他"
};

export const readingCatalogStatusLabels: Record<ReadingCatalogStatus, string> = {
  unread: "未读",
  reading: "在读",
  finished: "已读"
};
