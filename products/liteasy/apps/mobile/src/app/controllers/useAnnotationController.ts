import { useEffect, useMemo, useRef, useState } from "react";
import { AnnotationDocument, type AnnotationInput } from "../features/annotations/annotationDocument";
import type { LibraryItem, LibraryRepository } from "../features/library/library.types";
import type { AnnotationControls } from "../features/annotations/annotation.types";

export function useAnnotationController(item: LibraryItem, scope: string, repository: LibraryRepository): AnnotationControls {
  const document = useMemo(() => new AnnotationDocument(repository, scope, item), [repository, scope, item.id, item.contentHash]);
  const [snapshot, setSnapshot] = useState(document.snapshot);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const currentDocument = useRef(document);
  currentDocument.current = document;
  const pending = useRef(0);
  useEffect(() => {
    let current = true; active.current = true; setReady(false); setError("");
    void document.load().then(() => { if (current) { setSnapshot(document.snapshot); setReady(true); } })
      .catch((reason) => { if (current) setError(String(reason)); });
    return () => { current = false; active.current = false; };
  }, [document]);
  const run = async (operation: () => Promise<void>) => {
    if (!ready) return false;
    pending.current += 1;
    setBusy(true); setError("");
    try { await operation(); if (active.current && currentDocument.current === document) setSnapshot(document.snapshot); return true; }
    catch (reason) { if (active.current && currentDocument.current === document) setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { pending.current -= 1; if (active.current && currentDocument.current === document) setBusy(pending.current > 0); }
  };
  return { annotations: snapshot.annotations, ready, busy, error, canUndo: document.canUndo, canRedo: document.canRedo,
    add: (input: AnnotationInput) => run(() => document.add(input)), edit: (id, text) => run(() => document.edit(id, text)),
    remove: (id) => run(() => document.remove(id)), undo: () => run(() => document.undo()), redo: () => run(() => document.redo()) };
}
