import type { LiteratureRecord } from "./literature.types";

export type Paper = {
  contentHash?: string;
  forumTopicId?: string;
  forumWorkId?: string;
  arxivId?: string;
  authors?: readonly string[] | string;
  doi?: string;
  id: string;
  libraryReference?: {
    documentId: string;
    revision: number;
    scopeId: string;
    scopeType: "organization" | "user";
  };
  literature?: LiteratureRecord;
  semanticScholarId?: string;
  title: string;
  sourcePath?: string;
  year?: number | string;
};
