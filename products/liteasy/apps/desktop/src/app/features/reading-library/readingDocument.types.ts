export type ReadingFormat = "epub" | "markdown" | "text";

export type ReadingChapter = {
  id: string;
  title: string;
  content: string;
  plainText: string;
  format: "html" | "markdown" | "text";
  sourcePath?: string;
};

export type ReadingTocEntry = {
  id: string;
  label: string;
  chapterId: string;
  anchor?: string;
  depth: number;
};

export type ReadingResource = { path: string; mimeType: string; bytes: Uint8Array };

/** Persist the original file and parse again on opening; object URLs belong to the reader lifetime. */
export type ParsedReadingDocument = {
  format: ReadingFormat;
  title: string;
  authors: string[];
  language?: string;
  publisher?: string;
  publishedAt?: string;
  identifier?: string;
  description?: string;
  chapters: ReadingChapter[];
  toc: ReadingTocEntry[];
  resources: ReadingResource[];
  warnings: string[];
};
