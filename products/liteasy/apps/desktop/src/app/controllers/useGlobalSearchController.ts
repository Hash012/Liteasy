import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { createSemanticIndex } from "../features/semantic-index/semanticIndexClient";
import { createGlobalSearchService } from "../features/global-search/globalSearchService";
import { createWorkspaceSearchSource } from "../features/global-search/workspaceSearchSource";
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
  const [stateScope, setStateScope] = useState(scope);
  const [visible, setVisible] = useState(false), [query, setQuery] = useState(""), [group, setGroup] = useState<SearchGroup>();
  const [hits, setHits] = useState<SearchHit[]>([]), [coverage, setCoverage] = useState<SearchCoverage>();
  const [nextOffset, setNextOffset] = useState<number | null>(null), [busy, setBusy] = useState(false), [progress, setProgress] = useState(0);
  const [error, setError] = useState(""), [saved, setSaved] = useState<SavedSearch[]>([]), [revision, setRevision] = useState(0);
  const abort = useRef<AbortController>(), dirty = useRef(true), serial = useRef(Promise.resolve());
  const service = useMemo(() => {
    const active = () => latest.current.repository.scopeId === scope;
    return createGlobalSearchService({ active, capacity: isTauri() ? 48000 : 450,
      index: createSemanticIndex({ scope, workspace: "global-search-v1", model: "literal-v1", active }),
      source: createWorkspaceSearchSource({ repository: input.repository, files: createNoteFileService(scope, () => latest.current.repository.scopeId), active, getPapers: () => latest.current.papers }),
    });
  }, [input.repository, scope]);
  const storage = useMemo(() => createObjectStorage(scope, () => latest.current.repository.scopeId), [scope]);
  useEffect(() => {
    let active = true; setStateScope(scope); dirty.current = true; abort.current?.abort(); setHits([]); setCoverage(undefined); setSaved([]); setQuery("");
    void storage.get("global-search/saved/v1").then((row) => {
      if (!active || !Array.isArray(row?.value)) return;
      setSaved((row.value as SavedSearch[]).filter((item) => item && typeof item.query === "string" && item.query.length <= 2048 && (!item.group || ["metadata", "body", "note", "annotation", "artifact"].includes(item.group))).slice(0, 20));
    }).catch(() => { /* Saved queries are optional; searching remains available. */ });
    return () => { active = false; abort.current?.abort(); };
  }, [storage]);
  useEffect(() => {
    const changed = () => { dirty.current = true; abort.current?.abort(); setHits([]); setNextOffset(null); setRevision((value) => value + 1); };
    const offObjects = subscribeObjectStorage(scope, (keys) => { if (!keys || keys.some((key) => /^(head\/|reading-library\/)/.test(key))) changed(); });
    const offFiles = subscribeNoteFiles(scope, changed);
    window.addEventListener("focus", changed);
    window.addEventListener(PAPER_FULLTEXT_SAVED_EVENT, changed); window.addEventListener(PAPER_ANNOTATIONS_SAVED_EVENT, changed);
    return () => { offObjects(); offFiles(); window.removeEventListener("focus", changed); window.removeEventListener(PAPER_FULLTEXT_SAVED_EVENT, changed); window.removeEventListener(PAPER_ANNOTATIONS_SAVED_EVENT, changed); };
  }, [scope]);
  useEffect(() => { dirty.current = true; setRevision((value) => value + 1); setHits([]); }, [input.papers]);
  const run = (offset = 0) => {
    abort.current?.abort(); const request = new AbortController(); abort.current = request;
    setBusy(true); setError(""); if (!offset) { setHits([]); setNextOffset(null); }
    // Serialize refresh writes after the canceled predecessor settles; no older index pass can win.
    serial.current = serial.current.catch(() => {}).then(async () => {
      request.signal.throwIfAborted();
      if (dirty.current) { setProgress(0); const value = await service.refresh(request.signal, (count) => { if (count % 10 === 0 || count < 10) setProgress(count); }); request.signal.throwIfAborted(); setCoverage(value); dirty.current = false; }
      const value = await service.search(query, group, offset, request.signal); request.signal.throwIfAborted();
      setHits((previous) => offset ? [...previous, ...value.hits] : value.hits); setNextOffset(value.nextOffset); setCoverage(value.coverage);
    }).catch((cause) => { if (!request.signal.aborted) { setError(cause instanceof Error ? cause.message : String(cause)); dirty.current = true; } })
      .finally(() => { if (abort.current === request) setBusy(false); });
  };
  const runRef = useRef(run); runRef.current = run;
  useEffect(() => {
    if (!visible) { abort.current?.abort(); return; }
    setHits([]); setNextOffset(null); abort.current?.abort();
    const timer = window.setTimeout(() => runRef.current(), 250);
    return () => { window.clearTimeout(timer); abort.current?.abort(); };
  }, [visible, query, group, revision, service]);
  return { visible: stateScope === scope && visible, query, group, hits: stateScope === scope ? hits : [], coverage: stateScope === scope ? coverage : undefined, nextOffset, busy, progress, error, saved: stateScope === scope ? saved : [],
    show() { dirty.current = true; setVisible(true); setRevision((value) => value + 1); },
    close() { abort.current?.abort(); setVisible(false); },
    setQuery, setGroup,
    refresh() { dirty.current = true; run(); },
    loadMore() { if (nextOffset !== null) run(nextOffset); },
    cancel() { abort.current?.abort(); dirty.current = true; setBusy(false); },
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
