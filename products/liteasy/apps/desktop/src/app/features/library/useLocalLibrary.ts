import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  createLocalLibraryClient,
  normalizeLocalLibrarySnapshot
} from "./localLibraryClient";
import type {
  LocalLibraryChangedEvent,
  LocalLibrarySnapshot,
  LocalLibraryWatchErrorEvent
} from "./localLibrary.types";

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
  const [error, setError] = useState<string | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const revisionRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!canUseTauriLocalLibrary(loader)) {
      return;
    }
    try {
      const client = createLocalLibraryClient(loader);
      const nextSnapshot = await client();
      revisionRef.current = nextSnapshot.revision;
      setSnapshot(nextSnapshot);
      setError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw cause;
    }
  }, [loader]);

  useEffect(() => {
    void refresh().catch(() => {
      // The caller can surface the retained error state without an unhandled rejection.
    });
  }, [refresh]);

  useEffect(() => {
    if (loader || !canUseTauriLocalLibrary()) {
      return;
    }
    let active = true;
    let unlistenChanged: UnlistenFn | undefined;
    let unlistenError: UnlistenFn | undefined;
    void listen<LocalLibraryChangedEvent>("local-library-changed", (event) => {
      if (!active || event.payload.revision <= revisionRef.current) {
        return;
      }
      if (event.payload.externalDeletion) {
        setNotice("文件已在系统外删除，本地文献库已从磁盘更新。");
      }
      const nextSnapshot = normalizeLocalLibrarySnapshot(event.payload.snapshot);
      revisionRef.current = nextSnapshot.revision;
      setSnapshot(nextSnapshot);
      setError(null);
      setWatchError(null);
    }).then((cleanup) => {
      if (active) {
        unlistenChanged = cleanup;
      } else {
        cleanup();
      }
    });
    void listen<LocalLibraryWatchErrorEvent>("local-library-watch-error", (event) => {
      if (!active) return;
      setWatchError(`${event.payload.message}（错误编号：${event.payload.traceId}）`);
    }).then((cleanup) => {
      if (active) {
        unlistenError = cleanup;
      } else {
        cleanup();
      }
    });
    return () => {
      active = false;
      unlistenChanged?.();
      unlistenError?.();
    };
  }, [loader, refresh]);

  return { error: watchError ?? error, notice, refresh, snapshot };
}
