import { invoke } from "@tauri-apps/api/core";
import type { LocalLibrarySnapshot } from "./localLibrary.types";

type Loader = () => Promise<LocalLibrarySnapshot>;

export function normalizeLocalLibrarySnapshot(
  snapshot: LocalLibrarySnapshot
): LocalLibrarySnapshot {
  return {
    entries: snapshot.entries.map((entry) => ({
      contentHash: entry.contentHash ?? null,
      id: entry.id,
      path: entry.path,
      relativePath: entry.relativePath ?? null,
      title: entry.title
    })),
    folders: snapshot.folders ?? [],
    libraryId: snapshot.libraryId ?? `legacy:${snapshot.rootPath}`,
    revision: snapshot.revision ?? 0,
    rootPath: snapshot.rootPath,
    trashEntries: snapshot.trashEntries ?? []
  };
}

export function createLocalLibraryClient(loader?: Loader) {
  return async function loadLocalLibrary(): Promise<LocalLibrarySnapshot> {
    const snapshot = loader
      ? await loader()
      : await invoke<LocalLibrarySnapshot>("load_local_library_snapshot");

    return normalizeLocalLibrarySnapshot(snapshot);
  };
}
