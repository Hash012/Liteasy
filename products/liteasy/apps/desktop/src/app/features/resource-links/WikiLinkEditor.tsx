import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Popover, PopoverSurface, Tooltip } from "@fluentui/react-components";
import { AddRegular, CheckmarkRegular } from "@fluentui/react-icons";
import { ContextAssetBrowser } from "../assistant/ContextAssetBrowser";
import { ResourceReferencesContext, ReferenceSourceContext } from "./ResourceReferencesContext";
import { ReferenceContentPicker } from "./ReferenceContentPicker";
import { splitReference } from "./referenceText";
import type { ReferenceCandidate } from "./resourceReferenceService";
import "./resourceReferences.css";

/** A source-editor decoration: the button is UI, never a character saved in Markdown. */
export function WikiLinkEditor({ raw, target, onChange, onFinish, onHistory }: {
  raw: string; target: { getBoundingClientRect(): DOMRect };
  onChange(raw: string): void; onFinish(raw: string, beforeLastBracket?: boolean): void; onHistory(undo: boolean): void;
}) {
  const references = useContext(ResourceReferencesContext), source = useContext(ReferenceSourceContext);
  const input = useRef<HTMLInputElement>(null);
  const [browser, setBrowser] = useState(false), [matches, setMatches] = useState<ReferenceCandidate[]>([]);
  const [candidate, setCandidate] = useState<ReferenceCandidate>(), [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const parsed = useMemo(() => splitReference(raw), [raw]);
  useEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.setSelectionRange(raw.length, raw.length); }, []);
  useEffect(() => {
    if (!references || browser) return;
    const abort = new AbortController(); setCandidate(undefined); setError(""); setMatches([]); setLoading(true);
    const timer = setTimeout(() => {
      void references.service.search(parsed.target, abort.signal).then(async (items) => {
        if (abort.signal.aborted) return;
        setMatches(items.slice(0, 12));
        if (parsed.target || parsed.fragment && source) {
          try { const exact = await references.service.resolve(parsed.target, source, abort.signal); if (!abort.signal.aborted) setCandidate(exact); }
          catch (e) { if (!abort.signal.aborted && parsed.fragment) setError(e instanceof Error ? e.message : String(e)); }
        }
      }).catch((e) => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [references?.service, parsed.target, source, browser]);
  if (!references) return null;
  const choose = (asset: ReferenceCandidate, fragment = "") => onFinish(references.service.link(asset, fragment));
  return <>
    <Popover open={!browser} onOpenChange={(_, data) => { if (!data.open && !browser) onFinish(raw); }}
      positioning={{ target, position: "below", align: "start", offset: 4 }} trapFocus={false}>
      <PopoverSurface className="wiki-link-editor" aria-label="编辑文件引用" onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
          event.preventDefault(); event.stopPropagation(); onHistory(event.key.toLowerCase() === "z" && !event.shiftKey);
        }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onFinish(raw); }
      }}>
        <div className="wiki-link-field">
          <span aria-hidden="true">[[</span>
          <Input ref={input} aria-label="引用的文件或论文" placeholder="文件名、论文名或 Liteasy Path" value={raw}
            onChange={(_, data) => { const value = data.value.replace(/[\r\n]/g, ""); if (value.endsWith("]]")) onFinish(value.slice(0, -2)); else onChange(value); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") { event.preventDefault(); onFinish(raw); }
              if (event.key === "]" && !event.ctrlKey && !event.metaKey && input.current?.selectionStart === raw.length) { event.preventDefault(); onFinish(raw, true); }
            }} />
          <Tooltip content="浏览文件并选择引用内容" relationship="label"><Button size="small" icon={<AddRegular />} aria-label="浏览文件并选择引用内容" onClick={() => setBrowser(true)} /></Tooltip>
          <span aria-hidden="true">]]</span>
          <Tooltip content="完成引用" relationship="label"><Button size="small" appearance="subtle" icon={<CheckmarkRegular />} aria-label="完成引用" onClick={() => onFinish(raw)} /></Tooltip>
        </div>
        {loading ? <p role="status" className="reference-hint">正在查找文件…</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {candidate ? <>
          <div className="wiki-reference-selected"><strong>{candidate.title}</strong><Button size="small" onClick={() => choose(candidate)}>引用整个文件</Button></div>
          <ReferenceContentPicker key={candidate.path} path={candidate.path} fragment={parsed.fragment} onChoose={(_, range) => choose(candidate, range.fragment)} />
        </> : <div className="wiki-reference-results" aria-label="文件引用候选">
          {matches.map((asset) => <Button key={asset.path} appearance="subtle" onClick={() => { onChange(references.service.link(asset)); setCandidate(asset); }}>
            <strong>{asset.title}</strong><small>{asset.detail || asset.kind}</small>
          </Button>)}
          {!loading && !matches.length ? <p className="reference-hint">没有匹配项。点击 ＋ 浏览所有文件，或继续输入名称。</p> : null}
        </div>}
        <p className="reference-hint">Enter 完成 · 标题用 #标题 · 行范围用 #L1:3</p>
      </PopoverSurface>
    </Popover>
    {browser ? <ContextAssetBrowser suggestions={references.suggestions} initialQuery={parsed.target.startsWith("liteasy://") ? "" : parsed.target}
      onClose={() => { setBrowser(false); }} onChooseReference={choose} /> : null}
  </>;
}
