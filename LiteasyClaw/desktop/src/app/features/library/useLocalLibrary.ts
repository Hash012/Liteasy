import { useCallback, useEffect, useState } from "react";
import { createLocalLibraryClient } from "./localLibraryClient";
import type { LocalLibrarySnapshot } from "./localLibrary.types";
import { resolveLocalAccountKey } from "./localAccountKey";

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
  const accountKey = resolveLocalAccountKey();
  const [snapshot, setSnapshot] = useState<LocalLibrarySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canUseTauriLocalLibrary(loader)) {
      return;
    }
    try {
      const client = createLocalLibraryClient(loader);
      setSnapshot(await client());
      setError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw cause;
    }
  }, [accountKey, loader]);

  useEffect(() => {
    void refresh().catch(() => {
      // The caller can surface the retained error state without an unhandled rejection.
    });
  }, [refresh]);

  return { error, refresh, snapshot };
}
