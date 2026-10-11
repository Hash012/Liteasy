import { useCallback, useEffect, useRef, useState } from "react";
import { libraryRepository } from "../features/library/libraryRepository";
import type { ImportResource, LibraryItem, LibraryRepository } from "../features/library/library.types";
import { hasNativeHost, nativeRequest } from "../platform/native";
import { subscribeLibraryChanged } from "../features/library/libraryEvents";

export function useLibraryController(scope = "local", repository: LibraryRepository = libraryRepository()) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const activeScope = useRef(scope);
  const loadedScope = useRef(scope);
  const mounted = useRef(false);
  const openRequest = useRef(0);
  activeScope.current = scope;
  useEffect(() => {
    if (!hasNativeHost()) return;
    void nativeRequest("setOpenDocument", { scope, id: selectedId ?? null }).catch(() => {});
    return () => { void nativeRequest("setOpenDocument", { scope, id: null }).catch(() => {}); };
  }, [scope, selectedId]);

  const refresh = useCallback(async () => {
    const list = await repository.list(scope);
    if (mounted.current && activeScope.current === scope) { loadedScope.current = scope; setItems(list); }
  }, [scope, repository]);

  useEffect(() => {
    mounted.current = true;
    openRequest.current += 1;
    setItems([]); setSelectedId(undefined); setError(""); setBusy(false);
    const onError = (reason: unknown) => { if (mounted.current && activeScope.current === scope) setError(String(reason)); };
    void refresh().catch(onError);
    const onFocus = () => void refresh().catch(onError);
    const unsubscribe = subscribeLibraryChanged(scope, onFocus);
    window.addEventListener("focus", onFocus);
    return () => { mounted.current = false; unsubscribe(); window.removeEventListener("focus", onFocus); };
  }, [refresh, scope]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError("");
    let success = true;
    try { await operation(); }
    catch (reason) { success = false; if (mounted.current && activeScope.current === scope) setError(reason instanceof Error ? reason.message : String(reason)); }
    try { await refresh(); }
    catch (reason) { success = false; if (mounted.current && activeScope.current === scope) setError(String(reason)); }
    finally { if (mounted.current && activeScope.current === scope) setBusy(false); }
    return success;
  };

  const importResource = (input: ImportResource) => run(async () => { await repository.importResource(scope, input); });
  const importFiles = (files: File[]) => run(async () => {
    for (const file of files) {
      if (file.size > 256 * 1024 * 1024) throw new Error(`${file.name} 超过 256 MiB。`);
      await repository.importResource(scope, { title: file.name, filename: file.name, mimeType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()) });
    }
  });
  const update = (item: LibraryItem) => run(async () => { await repository.update(scope, item); });
  const open = (item: LibraryItem) => {
    const ticket = ++openRequest.current;
    void run(async () => {
      const available = repository.ensureAvailable ? await repository.ensureAvailable(scope, item.id, item.contentHash) : item;
      if (activeScope.current !== scope || ticket !== openRequest.current) return;
      const saved = await repository.update(scope, { ...available, lastReadAt: new Date().toISOString() });
      if (activeScope.current !== scope || ticket !== openRequest.current) return;
      setItems((previous) => previous.map((value) => value.id === saved.id ? saved : value));
      setSelectedId(item.id);
    });
  };
  const visibleItems = loadedScope.current === scope ? items : [];
  return { items: visibleItems, error, busy, refresh, importResource, importFiles, update, open, selectedId,
    selected: visibleItems.find((item) => item.id === selectedId), close: () => {
      openRequest.current += 1; setSelectedId(undefined); void refresh().catch((reason) => { if (mounted.current) setError(String(reason)); });
    }, repository, scope };
}
