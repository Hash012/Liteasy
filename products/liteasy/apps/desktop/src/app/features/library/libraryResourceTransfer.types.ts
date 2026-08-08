import type { RecommendationItem } from "../recommendations/recommendation.types";
import type {
  CloudLibraryEntry,
  CloudLibraryFolder,
  CloudLibraryScope
} from "./cloudLibraryStorageClient";
import type { LocalLibraryEntry, LocalLibraryFolder } from "./localLibrary.types";

export type LibraryResourceArea = "local" | "collection" | "recommendation" | "organization";

export type LibraryResourceEntrySource =
  | { area: "local"; entry: LocalLibraryEntry }
  | {
      area: "collection" | "organization";
      entry: CloudLibraryEntry;
      scope: CloudLibraryScope;
    };

export type LibraryResourceFolderOrigin =
  | { area: "local"; folder: LocalLibraryFolder }
  | {
      area: "collection" | "organization";
      folder: CloudLibraryFolder;
      scope: CloudLibraryScope;
    };

export type LibraryResourceFolderTree = {
  children: LibraryResourceFolderTree[];
  entries: LibraryResourceEntrySource[];
  name: string;
};

export type LibraryResourceFolderSource = LibraryResourceFolderOrigin & {
  tree: LibraryResourceFolderTree;
};

export type LibraryResourceTransferSource =
  | LibraryResourceEntrySource
  | LibraryResourceFolderSource
  | { area: "recommendation"; recommendation: RecommendationItem };

export type LibraryResourceTransferTarget = {
  area: LibraryResourceArea;
  expectedRevision?: number;
  folderId?: string;
  localFolderPath?: string;
  scope?: CloudLibraryScope;
};
