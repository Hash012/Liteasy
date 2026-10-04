import { PAPER_FILE_METADATA_SAVED_EVENT } from "../features/library/paperFileMetadata";
import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { createSemanticIndex } from "../features/semantic-index/semanticIndexClient";
import { createGlobalSearchService } from "../features/global-search/globalSearchService";
import { createWorkspaceSearchSource, paperSearchSignature } from "../features/global-search/workspaceSearchSource";
import type { SearchCoverage, SearchGroup, SearchHit } from "../features/global-search/globalSearch.types";
import { createNoteFileService, subscribeNoteFiles } from "../features/note-files/noteFileService";
import { createObjectStorage, subscribeObjectStorage } from "../features/objects/objectStorage";
import type { ObjectRepository } from "../features/objects/objectRepository";
import type { Paper } from "../features/workspace/workspace.types";
import { PAPER_ANNOTATIONS_SAVED_EVENT, PAPER_FULLTEXT_SAVED_EVENT } from "../features/library/userPaperArtifactClient";

type SavedSearch = { query: string; group?: SearchGroup };
export function useGlobalSearchController(input: { repository: ObjectRepository; papers: Paper[]; open(hit: SearchHit): Promise<void> }) {
  const latest = useRef(input); latest.current = input;
  const scope = input.repository.scopeId;
  const papersSignature = paperSearchSignature(input.papers);
  const [stateScope, setStateScope] = useState(scope);
  const [visible, setVisible] = useState(false), [query, setQuery] = useState(""), [group, setGroup] = useState<SearchGroup>();
  const [hits, setHits] = useState<SearchHit[]>([]), [coverage, setCoverage] = useState<SearchCoverage>();
  const [nextOffset, setNextOffset] = useState<number | null>(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState(""), [saved, setSaved] = useState<SavedSearch[]>([]), [revision, setRevision] = useState(0);
  const abort = useRef<AbortController>(), dirty = useRef(true), serial = useRef(Promise.resolve());
  const indexTask = useRef<{ service: ReturnType<typeof createGlobalSearchService>; request: AbortController; ready: Promise<void> }>();
  const service = useMemo(() => {
    const active = () => latest.current.repository.scopeId === scope;
    return createGlobalSearchService({ active, capacity: isTauri() ? 48000 : 450,
      index: createSemanticIndex({ scope, workspace: "global-search-v1", model: "literal-v1", active }),
      source: createWorkspaceSearchSource({ repository: input.repository, files: createNoteFileService(scope, () => latest.current.repository.scopeId), active, getPapers: () => latest.current.papers }),
    });
  }, [input.repository, scope]);
  const completed = useRef<{ service: typeof service; query: string; group?: SearchGroup; revision: number }>();
  // The admissible source set belongs to the service instance, even when the
  // replacement repository still represents the same account scope.
  useEffect(() => { dirty.current = true; indexTask.current?.request.abort(); }, [service]);
  const storage = useMemo(() => createObjectStorage(scope, () => latest.current.repository.scopeId), [scope]);
  useEffect(() => {
    let active = true; setStateScope(scope); dirty.current = true; abort.current?.abort(); indexTask.current?.request.abort(); setHits([]); setCoverage(undefined); setSaved([]); setQuery(""); setNextOffset(null); setBusy(false); completed.current = undefined;
    void storage.get("global-search/saved/v1").then((row) => {
      if (!active || !Array.isArray(row?.value)) return;
      setSaved((row.value as SavedSearch[]).filter((item) => item && typeof item.query === "string" && item.query.length <= 2048 && (!item.group || ["metadata", "body", "note", "annotation", "artifact"].includes(item.group))).slice(0, 20));
    }).catch(() => { /* Saved queries are optional; searching remains available. */ });
    return () => { active = false; abort.current?.abort(); indexTask.current?.request.abort(); };
  }, [storage]);
  useEffect(() => {
    const changed = () => { dirty.current = true; abort.current?.abort(); indexTask.current?.request.abort(); setHits([]); setNextOffset(null); setRevision((value) => value + 1); };
    const offObjects = subscribeObjectStorage(scope, (keys) => { if (!keys || keys.some((key) => /^(head\/|reading-library\/(file|metadata)\/|notes\/labels\/)/.test(key))) changed(); });
    const offFiles = subscribeNoteFiles(scope, changed);
    const paperChanged = (event: Event) => {
      const paperId = (event as CustomEvent<unknown>).detail;
      if (typeof paperId === "string" && latest.current.papers.some((paper) => paper.id === paperId)) changed();
    };
    window.addEventListener(PAPER_FILE_METADATA_SAVED_EVENT, paperChanged); window.addEventListener(PAPER_FULLTEXT_SAVED_EVENT, paperChanged); window.addEventListener(PAPER_ANNOTATIONS_SAVED_EVENT, paperChanged);
    return () => { offObjects(); offFiles(); window.removeEventListener(PAPER_FILE_METADATA_SAVED_EVENT, paperChanged); window.removeEventListener(PAPER_FULLTEXT_SAVED_EVENT, paperChanged); window.removeEventListener(PAPER_ANNOTATIONS_SAVED_EVENT, paperChanged); };
  }, [scope]);
  useEffect(() => { dirty.current = true; abort.current?.abort(); indexTask.current?.request.abort(); setRevision((value) => value + 1); setHits([]); setNextOffset(null); }, [papersSignature]);
  const ensureReady = () => {
    if (!dirty.current) return Promise.resolve();
    const previous = indexTask.current;
    if (previous?.service === service && !previous.request.signal.aborted) return previous.ready;
    const request = new AbortController();
    // Only source changes cancel indexing. Typing, pagination and closing the dialog
    // share the same preparation rather than repeatedly throwing away its progress.
    const ready = serial.current.catch(() => {}).then(async () => {
      request.signal.throwIfAborted(); setProgress(0);
      let updatedAt = 0;
      const value = await service.refresh(request.signal, (count) => {
        if (!request.signal.aborted && performance.now() - updatedAt >= 80) { updatedAt = performance.now(); setProgress(count); }
      });
      request.signal.throwIfAborted(); setCoverage(value); dirty.current = false;
    });
    indexTask.current = { service, request, ready };
    serial.current = ready;
    void ready.catch(() => { request.abort(); }); // A failed attempt can be retried.
    return ready;
  };
  const prepareRef = useRef(ensureReady); prepareRef.current = ensureReady;
  useEffect(() => {
    if (!dirty.current) return;
    // Warm during idle, or immediately when search opens, without delaying input.
    const timer = window.setTimeout(() => { void prepareRef.current().catch(() => {}); }, visible ? 0 : 1200);
    return () => window.clearTimeout(timer);
  }, [service, revision, visible]);
  const run = (offset = 0) => {
    abort.current?.abort(); const request = new AbortController(); abort.current = request;
    setBusy(true); setError(""); if (!offset) { completed.current = undefined; setHits([]); setNextOffset(null); }
    void (async () => {
      request.signal.throwIfAborted();
      await ensureReady(); request.signal.throwIfAborted();
      const value = await service.search(query, group, offset, request.signal); request.signal.throwIfAborted();
      setHits((previous) => offset ? [...previous, ...value.hits] : value.hits); setNextOffset(value.nextOffset); setCoverage(value.coverage);
      completed.current = { service, query, group, revision };
    })().catch((cause) => { if (!request.signal.aborted) { setError(cause instanceof Error ? cause.message : String(cause)); } })
      .finally(() => { if (abort.current === request) setBusy(false); });
  };
  const runRef = useRef(run); runRef.current = run;
  useEffect(() => {
    if (!visible) { abort.current?.abort(); setBusy(false); return; }
    const previous = completed.current;
    if (!dirty.current && previous?.service === service && previous.query === query && previous.group === group && previous.revision === revision) return;
    completed.current = undefined; setHits([]); setNextOffset(null); abort.current?.abort(); setBusy(false); setError("");
    if (!query.trim()) return;
    setBusy(true);
    const timer = window.setTimeout(() => runRef.current(), 80);
    return () => { window.clearTimeout(timer); abort.current?.abort(); };
  }, [visible, query, group, revision, service]);
  return { tags: stateScope === scope ? service.tags() : [], visible: stateScope === scope && visible, query, group, hits: stateScope === scope ? hits : [], coverage: stateScope === scope ? coverage : undefined, nextOffset, busy, progress, error, saved: stateScope === scope ? saved : [],
    show() { setVisible(true); },
    close() { abort.current?.abort(); setVisible(false); },
    setQuery, setGroup,
    refresh() { dirty.current = true; abort.current?.abort(); indexTask.current?.request.abort(); setRevision((value) => value + 1); },
    loadMore() { if (nextOffset !== null) run(nextOffset); },
    cancel() { abort.current?.abort(); indexTask.current?.request.abort(); setBusy(false); },
    async open(hit: SearchHit) {
      const request = new AbortController(); abort.current?.abort(); abort.current = request; setError("");
      try { await service.verify(hit, request.signal); await latest.current.open(hit); request.signal.throwIfAborted(); setVisible(false); }
      catch (cause) { if (!request.signal.aborted) { setHits((value) => value.filter((item) => item.documentId !== hit.documentId)); setError(cause instanceof Error ? cause.message : String(cause)); } }
    },
    async saveQuery(remove?: SavedSearch) {
      try {
        const next = remove ? saved.filter((item) => item !== remove) : [{ query: query.trim(), group }, ...saved.filter((item) => item.query !== query.trim() || item.group !== group)].slice(0, 20);
        if (!remove && !query.trim()) return;
        const key = "global-search/saved/v1", previous = await storage.get(key);
        await storage.commit([{ key, expected: previous?.version ?? null, row: { key, version: crypto.randomUUID(), value: next } }]);
        if (latest.current.repository.scopeId === scope) setSaved(next);
      } catch (cause) { setError(`保存查询失败：${String(cause)}`); }
    },
  };
}
export type GlobalSearchController = ReturnType<typeof useGlobalSearchController>;
