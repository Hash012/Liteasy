import { useEffect, useState } from "react";
import { createLocalLibraryClient } from "./localLibraryClient";
import type { LocalLibrarySnapshot } from "./localLibrary.types";

type LocalLibraryLoader = () => Promise<LocalLibrarySnapshot>;

function canUseTauriLocalLibrary(loader?: LocalLibraryLoader) {
  if (loader) {
    return true;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return typeof (window as Window & { __TAURI_INTERNALS__?: { invoke?: unknown } })
    .__TAURI_INTERNALS__?.invoke === "function";
}

export function useLocalLibrary(loader?: LocalLibraryLoader) {
  const [snapshot, setSnapshot] = useState<LocalLibrarySnapshot | null>(null);

  useEffect(() => {
    if (!canUseTauriLocalLibrary(loader)) {
      return;
    }

    const load = async () => {
      const client = createLocalLibraryClient(loader);
      setSnapshot(await client());
    };

    void load();
  }, [loader]);

  return snapshot;
}
