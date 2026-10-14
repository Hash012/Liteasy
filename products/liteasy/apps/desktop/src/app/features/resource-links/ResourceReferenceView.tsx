import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Popover, PopoverSurface, PopoverTrigger, Tooltip } from "@fluentui/react-components";
import { ArrowExpandRegular, DismissRegular } from "@fluentui/react-icons";
import { ContentView } from "../markdown/ContentView";
import { sourceContent } from "../markdown/contentStructure";
import { previewErrorMessage } from "./previewRequest";
import { AssetImage, VisualResourceContext } from "../visual-blocks/AssetImage";
import { writeAssetContextTransfer } from "../object-transfer/assetContextTransfer";
import { ReferenceDepthContext, ReferenceSourceContext, ResourceReferencesContext } from "./ResourceReferencesContext";
import { referenceFragment, splitReference } from "./referenceText";
import type { ReferenceCandidate, ReferenceDocument } from "./resourceReferenceService";
import "./resourceReferences.css";

export function ResourceReferenceView({ locator, source, embed = false, onResolved }: { locator: string; source?: string; embed?: boolean; onResolved?(candidate: ReferenceCandidate): void }) {
  const { tChinese } = useUiTranslation();
  const references = useContext(ResourceReferencesContext), inherited = useContext(ReferenceSourceContext), visual = useContext(VisualResourceContext);
  source ??= inherited ?? visual;
  const chain = useContext(ReferenceDepthContext);
  const cancellation = useRef<AbortController>();
  const prepare = useRef(false);
  const [candidate, setCandidate] = useState<ReferenceCandidate>(), [document, setDocument] = useState<ReferenceDocument>();
  const [error, setError] = useState(""), [limit, setLimit] = useState(12000), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!references) return;
    const preparation = prepare.current ? "allow" : "cached"; prepare.current = false;
    const abort = new AbortController(); cancellation.current = abort; setError(""); setDocument(undefined); setCandidate(undefined);
    void references.service.resolve(locator, source, abort.signal).then(async (asset) => {
      if (abort.signal.aborted) return;
      setCandidate(asset); onResolved?.(asset);
      if (chain.length >= 2) return;
      if (chain.includes(asset.path)) throw new Error("此处存在循环引用，点击打开原文件。");
      if (asset.kind === "image" || /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(asset.path)) return;
      const value = await references.service.document(asset.path, limit, abort.signal, preparation);
      if (!abort.signal.aborted) setDocument(value);
    }).catch((e) => { if (!abort.signal.aborted) setError(previewErrorMessage(e)); });
    return () => abort.abort();
  }, [references?.service, locator, source, limit, attempt]);
  useEffect(() => candidate ? references?.service.subscribe(candidate.path, () => setAttempt((value) => value + 1)) : undefined, [references?.service, candidate?.path]);
  const isImage = candidate && (candidate.kind === "image" || /\.(png|jpe?g|webp|gif)(?:\?|$)/i.test(candidate.path));
  let fragment = "", text = document?.text, selectionStart = 0, selectionEnd = document?.text.length ?? 0;
  try {
    fragment = splitReference(locator).fragment;
    if (fragment && document) {
      const selected = referenceFragment(document.text, fragment, document.complete); text = selected.text;
      selectionStart = selected.offsets?.start ?? document.text.split("\n").slice(0, selected.start - 1).reduce((sum, line) => sum + line.length + 1, 0);
      selectionEnd = selected.offsets?.end ?? selectionStart + selected.text.length;
    }
  } catch (e) { text = undefined; if (!error) fragment = e instanceof Error ? e.message : String(e); }
  return <span className={`resource-reference-view${embed ? " is-embed" : ""}`}>
    <span className="resource-reference-heading"><strong>{candidate?.title || "引用内容"}</strong>{candidate && references ? <Tooltip content="打开原文件" relationship="label"><Button size="small" appearance="subtle" icon={<ArrowExpandRegular />} aria-label="打开原文件" onClick={() => { void Promise.resolve(references.open(sourceLocator(candidate.path, locator))).catch((e) => setError(String(e))); }} /></Tooltip> : null}</span>
    {chain.length >= 2 ? <span>嵌套引用已折叠，请打开原文件继续阅读。</span> : error ? <span role="alert">{error}<Button size="small" onClick={() => setAttempt((value) => value + 1)}>重试</Button>{/正文尚未就绪/.test(error) ? <Button size="small" onClick={() => { prepare.current = true; setAttempt((value) => value + 1); }}>{tChinese("preview.prepareText", "解析正文")}</Button> : null}</span> : isImage && candidate ? <AssetImage source={candidate.path} alt={candidate.title} /> : document ? <>
      {!text && fragment ? <span role="status">{fragment}</span> : <ReferenceDepthContext.Provider value={[...chain, candidate!.path]}><ReferenceSourceContext.Provider value={candidate!.path}>
        <ContentView content={sourceContent({ text: document.text, path: candidate!.path, revision: document.asset.revision, scopeId: references?.service.scope ?? "legacy", start: selectionStart, end: selectionEnd })} renderResourceImage={(url, alt) => <AssetImage source={url} basePath={candidate!.path} alt={alt} />} allowRelativeImages />
      </ReferenceSourceContext.Provider></ReferenceDepthContext.Provider>}
      {!document.complete ? <span className="reference-hint">仅载入部分内容。<Button size="small" disabled={limit >= 80000} onClick={() => setLimit((value) => Math.min(value + 12000, 80000))}>继续载入</Button></span> : null}
    </> : <span role="status">正在读取引用…<Button size="small" onClick={() => { cancellation.current?.abort(); setError(tChinese("preview.cancelled", "已取消读取。")); }}>{tChinese("preview.cancelRead", "取消读取")}</Button></span>}
  </span>;
}

function sourceLocator(path: string, locator: string) {
  const fragment = splitReference(locator).fragment;
  return `${path}${fragment ? `#${fragment}` : ""}`;
}

export function ResourceLink({ locator, children, source, previewOnClick = false, actions, preview, onOpen, ariaLabel }: { locator: string; children: ReactNode; source?: string; previewOnClick?: boolean; actions?: ReactNode; preview?: ReactNode; onOpen?(): void | Promise<void>; ariaLabel?: string }) {
  const references = useContext(ResourceReferencesContext), inherited = useContext(ReferenceSourceContext), visual = useContext(VisualResourceContext);
  source ??= inherited ?? visual;
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const candidate = useRef<ReferenceCandidate>();
  const opening = useRef<AbortController>();
  const id = useRef(`reference-${Math.random()}`);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { const closeOther = (event: Event) => { if ((event as CustomEvent).detail !== id.current) { clearTimeout(timer.current); opening.current?.abort(); setOpen(false); } }; window.addEventListener("liteasy:reference-hover", closeOther); return () => { clearTimeout(timer.current); opening.current?.abort(); window.removeEventListener("liteasy:reference-hover", closeOther); }; }, []);
  useEffect(() => { candidate.current = undefined; clearTimeout(timer.current); opening.current?.abort(); setOpen(false); }, [locator, source]);
  const close = () => { clearTimeout(timer.current); opening.current?.abort(); setOpen(false); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 200); };
  const show = () => { clearTimeout(timer.current); timer.current = setTimeout(() => { window.dispatchEvent(new CustomEvent("liteasy:reference-hover", { detail: id.current })); setOpen(true); }, 300); };
  if (!references && !preview) return <span>{children}</span>;
  return <><Popover open={open} onOpenChange={(_, data) => { if (data.open) setOpen(true); else close(); }} positioning="below-start" trapFocus={false}>
    <PopoverTrigger disableButtonEnhancement><a href="#" aria-label={ariaLabel} className="resource-reference-link" onMouseEnter={show} onFocus={show} onMouseLeave={hide} onBlur={hide}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }} draggable onDragStart={(event) => { if (candidate.current && references) writeAssetContextTransfer(event.dataTransfer, references.service.scope, { kind: "path", path: candidate.current.path }, candidate.current.title); }}
      onClick={(event) => { event.preventDefault(); clearTimeout(timer.current); if (previewOnClick) { window.dispatchEvent(new CustomEvent("liteasy:reference-hover", { detail: id.current })); setOpen(true); return; } if (onOpen) { void Promise.resolve().then(onOpen).catch((e) => setError(previewErrorMessage(e))); return; } if (!references) return; opening.current?.abort(); const abort = new AbortController(); opening.current = abort; void references.service.resolve(locator, source, abort.signal).then((asset) => { if (!abort.signal.aborted) return references.open(sourceLocator(asset.path, locator)); }).catch((e) => { if (!abort.signal.aborted) setError(previewErrorMessage(e)); }); }}>{children}</a></PopoverTrigger>
    <PopoverSurface className="resource-reference-popover" aria-label="引用内容预览" onKeyDown={(event) => { if (event.key === "Escape") close(); }} onMouseEnter={() => clearTimeout(timer.current)} onFocus={() => clearTimeout(timer.current)} onMouseLeave={hide}>
      <Button className="reference-close" appearance="subtle" size="small" icon={<DismissRegular />} aria-label="关闭引用预览" onClick={close} />
      {open ? actions : null}
      {open ? preview ?? <ResourceReferenceView locator={locator} source={source} onResolved={(asset) => { candidate.current = asset; }} /> : null}
    </PopoverSurface>
  </Popover>{error ? <span role="status">{error}</span> : null}</>;
}

export function ResourceEmbed({ locator, source }: { locator: string; source?: string }) {
  const ref = useRef<HTMLSpanElement>(null), [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => { if (!ref.current || typeof IntersectionObserver === "undefined") return; const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "100px" }); observer.observe(ref.current); return () => observer.disconnect(); }, []);
  return <span ref={ref} className="resource-embed">{visible ? <ResourceReferenceView locator={locator} source={source} embed /> : <span>引用内容将在滚动到此处时载入。</span>}</span>;
}
