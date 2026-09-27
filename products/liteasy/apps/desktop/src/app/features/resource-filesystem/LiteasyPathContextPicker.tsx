import { useEffect, useId, useRef, useState } from "react";
import { Button, Input } from "@fluentui/react-components";
import type { ResourcePathCandidate } from "./resourcePathSearch";

export function LiteasyPathContextPicker({ scopeId, search, onAdd, busy }: {
  scopeId?: string;
  search?: (query: string) => Promise<ResourcePathCandidate[]>;
  onAdd(path: string): Promise<boolean>;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [candidates, setCandidates] = useState<ResourcePathCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const listId = useId();
  const searchRef = useRef(search);
  searchRef.current = search;
  const scopeRef = useRef(scopeId);
  scopeRef.current = scopeId;
  useEffect(() => { setQuery(""); setCandidates([]); }, [scopeId]);
  useEffect(() => {
    setCandidates([]); setIndex(0); setError("");
    if (!open || !focused || !searchRef.current) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void searchRef.current!(query).then((items) => { if (active) setCandidates(items); })
        .catch((e) => { if (active) setError(e instanceof Error ? e.message : "搜索失败，请重试。"); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 150 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [query, scopeId, open, focused]);
  const visible = open && focused;
  async function add(path: string) {
    if (busy) return;
    const scope = scopeId;
    if (await onAdd(path) && scope === scopeRef.current) { setQuery(""); setFocused(false); }
  }
  return <details className="assistant-path-context" onToggle={(event) => {
    setOpen(event.currentTarget.open);
    if (event.currentTarget.open) { setFocused(true); event.currentTarget.querySelector("input")?.focus(); }
  }}>
    <summary>通过 Liteasy Path 添加上下文</summary>
    <div className="assistant-path-search" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
      <Input aria-label="添加上下文的 Liteasy Path" placeholder="搜索论文、笔记、白板，或粘贴 liteasy://…" value={query}
        role="combobox" aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible && candidates.length ? `${listId}-${index}` : undefined}
        onFocus={() => setFocused(true)}
        onChange={(_, data) => { setQuery(data.value); setFocused(true); }} style={{ width: "100%" }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); setFocused(false); }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setFocused(true);
            if (candidates.length) setIndex((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length);
          }
          if (event.key === "Enter" && !busy) {
            event.preventDefault();
            if (query.trim().startsWith("liteasy://")) void add(query.trim());
            else if (visible && candidates[index]) void add(candidates[index].path);
          }
        }} />
      {visible ? <div className="assistant-path-candidates">
        {loading ? <p role="status">正在搜索…</p> : error ? <p role="alert">{error}</p> : null}
        <div role="listbox" id={listId} aria-label="Liteasy Path 候选资源">
          {candidates.map((candidate, position) => <button type="button" role="option" key={candidate.path}
            id={`${listId}-${position}`} aria-selected={position === index} disabled={busy}
            className="assistant-path-candidate" title={candidate.path}
            onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setIndex(position)}
            onClick={() => void add(candidate.path)}>
            <strong>{candidate.title}</strong><span>{candidate.kind}</span><small>{candidate.path}</small>
          </button>)}
        </div>
        {!loading && !error && !candidates.length ? <p role="status">没有匹配的资源，可粘贴 Liteasy Path。</p> : null}
      </div> : null}
      <Button size="small" disabled={!query.trim().startsWith("liteasy://") || busy} onClick={() => void add(query.trim())}>读取并加入上下文</Button>
    </div>
  </details>;
}
