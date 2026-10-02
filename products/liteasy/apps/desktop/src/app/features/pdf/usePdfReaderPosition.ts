import { useEffect, useMemo, useRef, useState } from "react";
import { createPdfReaderPositionStore } from "./pdfReaderPosition";

export type PdfReaderPositionInput = {
  scopeId?: string;
  paperId?: string;
  sourcePath?: string;
  /** Only pass the proxy after its loaded identity matches the current paper. */
  document: object | null;
  contentRevision: string | null;
  pageCount: number;
  page: number;
  hasNavigationTarget?: boolean;
  restorePage: (page: number, stillCurrent: () => boolean) => void;
};
type Session = {
  current: () => boolean;
  ready: boolean;
  blocked: boolean;
  restoring: boolean;
  lastPage?: number;
  restoredPage?: number;
  savedIntent: number;
  save: (page: number) => Promise<void>;
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

  useEffect(() => {
    setError("");
    sessionRef.current = null;
    const { scopeId, paperId, sourcePath, document, contentRevision } = input;
    if (!scopeId || !paperId || !document || !contentRevision) return;
    let active = true;
    let frame = 0;
    const current = () => active && latest.current.scopeId === scopeId && latest.current.paperId === paperId &&
      latest.current.sourcePath === sourcePath && latest.current.document === document && latest.current.contentRevision === contentRevision;
    const store = createPdfReaderPositionStore(scopeId, () => latest.current.scopeId);
    const session: Session = { current, ready: false, blocked: false, restoring: false, savedIntent: 0,
      save: (page) => store.save(paperId, contentRevision, page) };
    sessionRef.current = session;
    const initialPage = input.page;
    void store.load(paperId, contentRevision).then((saved) => {
      if (!current()) return;
      session.ready = true;
      if (opening.intent || latest.current.hasNavigationTarget || latest.current.page !== initialPage) {
        // A user or evidence navigation took precedence while storage was loading.
        setTick((value) => value + 1);
        return;
      }
      session.lastPage = latest.current.page;
      if (saved !== null || latest.current.page !== 1) {
        const page = saved === null ? 1 : Math.min(saved, Math.max(1, latest.current.pageCount));
        session.lastPage = page;
        session.restoredPage = page;
        session.restoring = true;
        const intent = opening.intent;
        const stillCurrent = () => current() && opening.intent === intent;
        latest.current.restorePage(page, stillCurrent);
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
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [input.scopeId, input.paperId, input.sourcePath, input.document, input.contentRevision, opening]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session?.current() || !session.ready || session.blocked || session.restoring ||
      !Number.isSafeInteger(input.page) || input.page < 1 || input.page > input.pageCount ||
      (session.lastPage === input.page && session.savedIntent === opening.intent)) return;
    if (session.restoredPage !== undefined && input.page !== session.restoredPage && opening.intent === 0) return;
    session.restoredPage = undefined;
    session.lastPage = input.page;
    session.savedIntent = opening.intent;
    void session.save(input.page).catch((cause: unknown) => {
      if (!session.current()) return;
      session.blocked = true;
      setError(`阅读位置尚未保存。${cause instanceof Error ? cause.message : "请检查本地存储。"}`);
    });
  }, [input.page, input.pageCount, input.document, input.contentRevision, input.scopeId, input.paperId, opening, tick]);

  return {
    error,
    markNavigation() {
      opening.intent += 1;
      const session = sessionRef.current;
      if (session?.current()) session.restoring = false;
      setTick((value) => value + 1);
    },
    isRestoring: () => !!sessionRef.current?.current() && !!sessionRef.current?.restoring
  };
}
