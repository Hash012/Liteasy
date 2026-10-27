import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPdfReaderPositionStore, isPdfPositionReadOnlyError, type PdfReaderViewState } from "./pdfReaderPosition";
import { createPdfPositionWriter } from "./pdfPositionWriter";
import { registerPdfPositionWriter } from "./pdfReaderPersistence";

export type PdfReaderPositionInput = {
  scopeId?: string;
  paperId?: string;
  sourcePath?: string;
  /** Only pass the proxy after its loaded identity matches the current paper. */
  document: object | null;
  contentRevision: string | null;
  pageCount: number;
  page: number;
  topRatio?: number;
  view?: PdfReaderViewState;
  restoreView?: (view: PdfReaderViewState | undefined) => void;
  capturePosition?: () => { page: number; topRatio: number } | undefined;
  hasNavigationTarget?: boolean;
  restorePage: (page: number, stillCurrent: () => boolean, topRatio?: number) => void;
};
type Session = {
  current: () => boolean;
  ready: boolean;
  blocked: boolean;
  restoring: boolean;
  lastPage?: number;
  lastTopRatio?: number;
  lastView?: PdfReaderViewState;
  restoredPage?: number;
  savedIntent: number;
  writer: ReturnType<typeof createPdfPositionWriter>;
  capture(): void;
};

export function usePdfReaderPosition(input: PdfReaderPositionInput) {
  const latest = useRef(input); latest.current = input;
  const opening = useMemo(() => ({ intent: 0, document: input.document, contentRevision: input.contentRevision }), [input.scopeId, input.paperId, input.sourcePath]);
  if (opening.document !== input.document || opening.contentRevision !== input.contentRevision) {
    // Reloading this paper starts a new navigation lifetime; keep choices made during loading.
    if (opening.document !== null && (opening.document !== input.document || opening.contentRevision !== input.contentRevision)) opening.intent = 0;
    opening.document = input.document;
    opening.contentRevision = input.contentRevision;
  }
  const sessionRef = useRef<Session | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);

  useLayoutEffect(() => () => {
    // Layout cleanup still has the reader DOM. Passive cleanup happens after its removal.
    sessionRef.current?.capture();
  }, [input.scopeId, input.paperId, input.sourcePath, input.document, input.contentRevision]);

  useEffect(() => {
    setError(""); setCanRetry(false);
    sessionRef.current = null;
    const { scopeId, paperId, sourcePath, document, contentRevision } = input;
    if (!scopeId || !paperId || !document || !contentRevision) return;
    let active = true;
    let frame = 0;
    const current = () => active && latest.current.scopeId === scopeId && latest.current.paperId === paperId &&
      latest.current.sourcePath === sourcePath && latest.current.document === document && latest.current.contentRevision === contentRevision;
    const store = createPdfReaderPositionStore(scopeId, () => latest.current.scopeId);
    const writer = createPdfPositionWriter({
      save: ({ page, topRatio, pageCount, view }) => store.save(paperId, contentRevision, page, topRatio, { pageCount, view }),
      onSaved: () => { if (current()) { setError(""); setCanRetry(false); } },
      onError: (cause) => {
        const blocked = isPdfPositionReadOnlyError(cause);
        if (current()) {
          session.blocked = blocked; setCanRetry(!blocked);
          setError(`阅读位置尚未保存。${cause instanceof Error ? cause.message : "请检查本地存储。"}`);
        }
        return blocked;
      }
    });
    const capture = () => {
      if (!current() || !session.ready || session.blocked || session.restoring ||
        (session.restoredPage !== undefined && opening.intent === 0)) return;
      const position = latest.current.capturePosition?.();
      if (!position || position.page < 1 || position.page > latest.current.pageCount) return;
      writer.enqueue({ ...position, pageCount: latest.current.pageCount, view: latest.current.view });
    };
    const session: Session = { current, ready: false, blocked: false, restoring: false, savedIntent: 0, writer, capture };
    const releaseWriter = registerPdfPositionWriter({ flushAndWait: () => { capture(); return writer.flushAndWait(); } });
    sessionRef.current = session;
    const initialPage = input.page;
    void store.loadLocation(paperId, contentRevision).then((saved) => {
      if (!current()) return;
      session.ready = true;
      if (opening.intent || latest.current.hasNavigationTarget || latest.current.page !== initialPage) {
        // A user or evidence navigation took precedence while storage was loading.
        setTick((value) => value + 1);
        return;
      }
      session.lastPage = latest.current.page;
      session.lastView = saved?.view ?? latest.current.view;
      latest.current.restoreView?.(saved?.view);
      if (saved !== null || latest.current.page !== 1) {
        const page = saved === null ? 1 : Math.min(saved.page, Math.max(1, latest.current.pageCount));
        session.lastPage = page;
        session.lastTopRatio = saved?.topRatio;
        session.restoredPage = page;
        session.restoring = true;
        const intent = opening.intent;
        const stillCurrent = () => current() && opening.intent === intent;
        if (saved?.topRatio === undefined) latest.current.restorePage(page, stillCurrent);
        else latest.current.restorePage(page, stillCurrent, saved.topRatio);
        // The reader queues its automatic scroll first. Ignore that scroll's intermediate page.
        frame = requestAnimationFrame(() => {
          if (!current()) return;
          session.restoring = false;
          setTick((value) => value + 1);
        });
      } else setTick((value) => value + 1);
    }).catch((cause: unknown) => {
      if (!current()) return;
      session.blocked = true;
      setError(`阅读位置无法恢复，原记录保持不变。${cause instanceof Error ? cause.message : "请检查本地存储。"}`);
    });
    const flush = () => { capture(); writer.flush(); };
    const visibility = () => { if (window.document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    window.document.addEventListener("visibilitychange", visibility);
    return () => {
      releaseWriter(); active = false; cancelAnimationFrame(frame);
      window.removeEventListener("pagehide", flush);
      window.document.removeEventListener("visibilitychange", visibility);
    };
  }, [input.scopeId, input.paperId, input.sourcePath, input.document, input.contentRevision, opening]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session?.current() || !session.ready || session.blocked || session.restoring ||
      !Number.isSafeInteger(input.page) || input.page < 1 || input.page > input.pageCount ||
      (session.lastPage === input.page && session.lastTopRatio === input.topRatio &&
        session.lastView?.zoom === input.view?.zoom && session.lastView?.layoutMode === input.view?.layoutMode &&
        session.savedIntent === opening.intent)) return;
    if (session.restoredPage !== undefined && opening.intent === 0) return;
    session.restoredPage = undefined;
    session.lastPage = input.page;
    session.lastTopRatio = input.topRatio;
    session.lastView = input.view;
    session.savedIntent = opening.intent;
    session.writer.enqueue({ page: input.page, topRatio: input.topRatio, pageCount: input.pageCount, view: input.view });
  }, [input.page, input.topRatio, input.view?.zoom, input.view?.layoutMode, input.pageCount, input.document, input.contentRevision, input.scopeId, input.paperId, opening, tick]);

  return {
    error, canRetry,
    retrySave() { const session = sessionRef.current; if (session?.current() && !session.blocked) session.writer.retry(); },
    markNavigation() {
      opening.intent += 1;
      const session = sessionRef.current;
      if (session?.current()) session.restoring = false;
      setTick((value) => value + 1);
    },
    isRestoring: () => !!sessionRef.current?.current() && !!sessionRef.current?.restoring
  };
}
