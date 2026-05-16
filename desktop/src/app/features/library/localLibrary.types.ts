export type LocalLibraryEntry = {
  id: string;
  path: string;
  title: string;
};

export type LocalLibrarySnapshot = {
  entries: LocalLibraryEntry[];
  rootPath: string;
};
