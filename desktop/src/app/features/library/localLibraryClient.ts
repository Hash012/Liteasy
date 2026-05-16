import { invoke } from "@tauri-apps/api/core";
import type { LocalLibrarySnapshot } from "./localLibrary.types";

type Loader = () => Promise<LocalLibrarySnapshot>;

export function createLocalLibraryClient(loader?: Loader) {
  return async function loadLocalLibrary(): Promise<LocalLibrarySnapshot> {
    const snapshot = loader
      ? await loader()
      : await invoke<LocalLibrarySnapshot>("load_local_library_snapshot");

    return {
      entries: snapshot.entries.map((entry) => ({
        id: entry.id,
        path: entry.path,
        title: entry.title
      })),
      rootPath: snapshot.rootPath
    };
  };
}
