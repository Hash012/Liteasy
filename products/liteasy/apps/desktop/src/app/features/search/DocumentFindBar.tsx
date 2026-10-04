import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Tooltip } from "@fluentui/react-components";
import { ArrowDownRegular, ArrowUpRegular, DismissRegular } from "@fluentui/react-icons";
import { ReferenceSourceContext } from "../resource-links/ResourceReferencesContext";
import { parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import { createObjectStorage, subscribeObjectStorage } from "../objects/objectStorage";
import { createObjectRepository } from "../objects/objectRepository";
import { createReadingLibraryRepository } from "../reading-library/readingLibraryRepository";
import { createNotesRepository } from "../notes/notesRepository";
import { applyBibliographicMetadata } from "../library/bibliographicFields";
import { noteLabelKey } from "../notes/noteLabels";
import type { NotesItem } from "../notes/notes.types";
import { catalogSearchMetadata, noteSearchMetadata } from "./searchMetadata";
import { compileSearchQuery, type SearchMetadata, type SearchRange } from "./searchQuery";
import { SearchOptions } from "./SearchOptions";

export function DocumentFindBar({ text, onNavigate, onClose }: { text: string; onNavigate(range: SearchRange): void; onClose(): void }) {
  const path = useContext(ReferenceSourceContext);
  const [query, setQuery] = useState(""), [selected, setSelected] = useState(-1);
  const [metadata, setMetadata] = useState<SearchMetadata>({ format: "markdown", assetType: "note" });
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (!path) return;
    let active = true, revision = 0;
    let off = () => {};
    try {
      const scope = new URL(path).searchParams.get("scope"); if (!scope) return;
      const target = parseLiteasyPath(path, scope);
      const storage = createObjectStorage(scope, () => active ? scope : "");
      const load = async () => {
        const request = ++revision;
        let result: SearchMetadata | undefined;
        if (target.kind === "object") {
          const library = createReadingLibraryRepository(storage, scope);
          const file = (await library.list()).find((entry) => entry.ref.objectId === target.ref.objectId);
          if (file) { const overlay = (await library.metadata())[file.id]; result = catalogSearchMetadata(applyBibliographicMetadata({ ...file, ...overlay }, overlay?.bibliographic)); }
          else {
            const object = await createObjectRepository(storage, scope).resolveLatest(target.ref.objectId);
            const labels = await createNotesRepository(storage).listLabels();
            result = noteSearchMetadata({ target, object } as NotesItem, labels.get(noteLabelKey(target)));
          }
        } else if (target.kind === "external-file") {
          const labels = await createNotesRepository(storage).listLabels();
          result = noteSearchMetadata({ target } as NotesItem, labels.get(noteLabelKey(target)));
        }
        if (active && request === revision && result) setMetadata(result);
      };
      const reload = () => { void load().catch(() => {}); };
      reload(); off = subscribeObjectStorage(scope, (keys) => { if (!keys || keys.some((key) => /^(head\/|notes\/labels\/|reading-library\/metadata\/)/.test(key))) reload(); });
    } catch { /* A standalone Markdown surface can still search its own text. */ }
    return () => { active = false; off(); };
  }, [path]);
  const matches = useMemo(() => { const compiled = compileSearchQuery(query, { phrase: true }); return compiled.hasText && compiled.matches(text, metadata) ? compiled.ranges(text, 2000) : []; }, [text, query, metadata]);
  useEffect(() => setSelected(-1), [matches]);
  const move = (delta: number) => { if (!matches.length) return; const next = selected < 0 ? delta < 0 ? matches.length - 1 : 0 : (selected + delta + matches.length) % matches.length; setSelected(next); onNavigate(matches[next]); };
  return <div className="document-find-bar" role="search" aria-label="Markdown 正文检索">
    <Input ref={input} aria-label="查找 Markdown 正文" placeholder="查找正文，支持 /正则/" value={query} onChange={(_, data) => setQuery(data.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); move(event.shiftKey ? -1 : 1); } if (event.key === "Escape") { event.stopPropagation(); onClose(); } }} />
    <SearchOptions query={query} onChange={setQuery} tags={metadata.tags} />
    <small role="status">{selected + 1} / {matches.length}{matches.length === 2000 ? "（前 2000 处）" : ""}</small>
    <Tooltip content="上一个匹配" relationship="label"><Button size="small" icon={<ArrowUpRegular />} aria-label="上一个匹配" disabled={!matches.length} onClick={() => move(-1)} /></Tooltip>
    <Tooltip content="下一个匹配" relationship="label"><Button size="small" icon={<ArrowDownRegular />} aria-label="下一个匹配" disabled={!matches.length} onClick={() => move(1)} /></Tooltip>
    <Tooltip content="关闭正文检索" relationship="label"><Button size="small" icon={<DismissRegular />} aria-label="关闭正文检索" onClick={onClose} /></Tooltip>
  </div>;
}
