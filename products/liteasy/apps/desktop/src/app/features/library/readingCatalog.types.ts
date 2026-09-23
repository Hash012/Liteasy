export type ReadingCatalogFormat = "pdf" | "epub" | "markdown" | "txt" | "other";

export type ReadingCatalogStatus = "unread" | "reading" | "finished";

/** A presentation record: original papers and imported books keep their own storage identities. */
export type ReadingCatalogEntry = {
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
};

export type ReadingCatalogMetadataPatch = {
  tags?: string[];
  collection?: string;
  readingStatus?: ReadingCatalogStatus;
};

export const readingCatalogFormatLabels: Record<ReadingCatalogFormat, string> = {
  pdf: "PDF",
  epub: "EPUB",
  markdown: "Markdown",
  txt: "TXT",
  other: "其他"
};

export const readingCatalogStatusLabels: Record<ReadingCatalogStatus, string> = {
  unread: "未读",
  reading: "在读",
  finished: "已读"
};
