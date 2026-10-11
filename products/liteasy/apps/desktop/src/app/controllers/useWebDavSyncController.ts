import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import { notifyNotesSourcesChanged } from "../features/notes/notesPort";
import { autoSyncWebDav, clearWebDavStatus, webdavStatus } from "../features/webdav/webdavClient";

// Mounted with the application, so closing Settings does not stop automatic sync.
export function useWebDavSyncController(openDocumentIds: string[] = [], libraryRootPath: string | null = null) {
  const currentRoot = useRef(libraryRootPath);
  const openRequest = useRef(0);
  currentRoot.current = libraryRootPath;
  useEffect(() => () => { currentRoot.current = null; openRequest.current += 1; }, []);
  useEffect(() => { openRequest.current += 1; clearWebDavStatus(); }, [libraryRootPath]);
  useEffect(() => {
    let previous = webdavStatus.getSnapshot().result;
    return webdavStatus.subscribe(() => {
      const result = webdavStatus.getSnapshot().result;
      if (result !== previous && result && (result.downloaded || result.deleted)) notifyNotesSourcesChanged();
      previous = result;
    });
  }, []);
  const documentIds = JSON.stringify(openDocumentIds);
  useEffect(() => {
    if (!isTauri()) return;
    void invoke("set_webdav_open_documents", { documentIds: JSON.parse(documentIds) }).catch(() => {});
  }, [documentIds]);
  useEffect(() => {
    const run = () => { if (navigator.onLine) void autoSyncWebDav(); };
    const initial = window.setTimeout(run, 15_000);
    const interval = window.setInterval(run, 5 * 60_000);
    window.addEventListener("online", run);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("online", run);
    };
  }, []);
  return {
    openPaper(sourcePath: string | undefined, ready: () => void, failed: (error: unknown) => void, progress?: (message: string) => void) {
      const ticket = ++openRequest.current;
      if (!isTauri() || !sourcePath || !libraryRootPath ||
        !sourcePath.replace(/\\/g, "/").startsWith(`${libraryRootPath.replace(/\\/g, "/")}/`)) { ready(); return; }
      progress?.("正在获取文献附件…");
      void invoke("ensure_webdav_file", { sourcePath }).then(() => {
        if (currentRoot.current === libraryRootPath && openRequest.current === ticket) { progress?.(""); ready(); }
      }).catch((error) => {
        if (currentRoot.current === libraryRootPath && openRequest.current === ticket) failed(error);
      });
    }
  };
}
