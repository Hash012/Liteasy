import { useCallback, useEffect, useRef, useState } from "react";
import { libraryRepository } from "../features/library/libraryRepository";
import type { ImportResource, LibraryItem, LibraryRepository } from "../features/library/library.types";

export function useLibraryController(scope = "local", repository: LibraryRepository = libraryRepository()) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const activeScope = useRef(scope);
  activeScope.current = scope;

  const refresh = useCallback(async () => {
    const list = await repository.list(scope);
    if (activeScope.current === scope) setItems(list);
  }, [scope, repository]);

  useEffect(() => {
    setItems([]); setSelectedId(undefined); setError("");
    void refresh().catch((reason) => { if (activeScope.current === scope) setError(String(reason)); });
    const onFocus = () => void refresh().catch((reason) => setError(String(reason)));
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, scope]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError("");
    let success = true;
    try { await operation(); }
    catch (reason) { success = false; if (activeScope.current === scope) setError(reason instanceof Error ? reason.message : String(reason)); }
    try { await refresh(); }
    catch (reason) { success = false; if (activeScope.current === scope) setError(String(reason)); }
    finally { setBusy(false); }
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
    setSelectedId(item.id);
    void update({ ...item, lastReadAt: new Date().toISOString() });
  };
  return { items, error, busy, refresh, importResource, importFiles, update, open, selectedId,
    selected: items.find((item) => item.id === selectedId), close: () => setSelectedId(undefined), repository, scope };
}
