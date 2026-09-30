import { useCallback, useEffect, useRef, useState } from "react";
import type { LibraryItem, LibraryRepository } from "../features/library/library.types";
import { loadPdf, type PDFDocumentProxy } from "../features/pdf/pdfEngine";
import type { OutlineEntry, PdfReaderState } from "../features/pdf/pdfReader.types";

export function usePdfController(item: LibraryItem, scope: string, repository: LibraryRepository): PdfReaderState {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [outline, setOutline] = useState<OutlineEntry[]>([]);
  const [page, setPage] = useState(item.page);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [passwordRequired, setPasswordRequired] = useState(false);
  const passwordCallback = useRef<((value: string) => void)>();
  const progressQueue = useRef(Promise.resolve());
  const initialPage = useRef(item.page);

  useEffect(() => {
    let active = true;
    let task: ReturnType<typeof loadPdf> | undefined;
    setDocument(undefined); setError(""); setOutline([]); setPage(initialPage.current); setZoom(1);
    void (async () => {
      const bytes = await repository.readBytes(scope, item.id);
      if (!active) return;
      task = loadPdf(bytes);
      task.onPassword = (callback: (value: string) => void) => {
        if (active) { passwordCallback.current = callback; setPasswordRequired(true); }
      };
      const pdf = await task.promise;
      if (!active) return;
      setDocument(pdf); setPage(Math.min(Math.max(1, initialPage.current), pdf.numPages));
      const entries: OutlineEntry[] = [];
      const walk = async (nodes: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>, depth: number) => {
        for (const node of nodes ?? []) {
          if (!active || entries.length >= 500 || depth > 12) return;
          const dest = typeof node.dest === "string" ? await pdf.getDestination(node.dest) : node.dest;
          if (dest?.length) {
            const page = typeof dest[0] === "number" ? dest[0] + 1 : await pdf.getPageIndex(dest[0]) + 1;
            entries.push({ title: node.title, page, depth });
          }
          await walk(node.items, depth + 1);
        }
      };
      await walk(await pdf.getOutline(), 0);
      if (active) setOutline(entries);
    })().catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; passwordCallback.current = undefined; if (task) void task.destroy(); };
  }, [item.id, repository, scope]);

  const navigate = useCallback((next: number) => {
    if (!document || !Number.isFinite(next)) return;
    const bounded = Math.min(document.numPages, Math.max(1, Math.trunc(next)));
    setPage(bounded);
    // Serialize progress changes and read the current revision, preserving metadata edited elsewhere.
    progressQueue.current = progressQueue.current.catch(() => {}).then(async () => {
      const latest = (await repository.list(scope)).find((value) => value.id === item.id);
      if (latest) await repository.update(scope, { ...latest, page: bounded, lastReadAt: new Date().toISOString() });
    }).catch((reason) => setError(`阅读位置未保存：${String(reason)}`));
  }, [document, repository, scope, item.id]);

  return { document, outline, page, navigate, zoom, setZoom, error, passwordRequired,
    unlock: (password: string) => { setPasswordRequired(false); passwordCallback.current?.(password); } };
}
