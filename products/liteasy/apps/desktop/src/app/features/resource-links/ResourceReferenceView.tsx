import { BoardScenePreview } from "../boards/BoardScenePreview";
import type { BoardViewSnapshot } from "../resource-filesystem/resourcePresentation";
import { useUiTranslation } from "../../shared/i18n/useUiTranslation";
import { lazy, Suspense, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Popover, PopoverSurface, PopoverTrigger, Tooltip } from "@fluentui/react-components";
import { ArrowExpandRegular, DismissRegular } from "@fluentui/react-icons";
import { IconAction } from "../../shared/ui/productPrimitives";
import { ContentView } from "../markdown/ContentView";
import { selectContentRange } from "../markdown/contentStructure";
import { previewErrorMessage } from "./previewRequest";
import { AssetImage, VisualResourceContext } from "../visual-blocks/AssetImage";
import { writeAssetContextTransfer } from "../object-transfer/assetContextTransfer";
import { ReferenceDepthContext, ReferenceSourceContext, ResourceReferencesContext } from "./ResourceReferencesContext";
import { referenceFragment, splitReference } from "./referenceText";
import type { ReferenceCandidate, ReferenceDocument } from "./resourceReferenceService";
import type { ReferencePdf, PdfPreviewIntent, PreviewViewport, PdfSourceMember } from "./referencePdfSource";
import "./resourceReferences.css";
const PdfSourcePreview = lazy(() => import("../pdf/PdfSourcePreview"));

type ReferenceViewProps = { locator: string; source?: string; embed?: boolean; intent?: PdfPreviewIntent; sourceMember?: PdfSourceMember; initialViewport?: PreviewViewport; onViewportChange?(viewport: PreviewViewport): void; onResolved?(candidate: ReferenceCandidate): void };
export function ResourceReferenceView(props: ReferenceViewProps) {
  return <ResourceReferenceContent key={`${props.intent ?? "asset"}:${props.locator}:${JSON.stringify(props.sourceMember)}`} {...props} />;
}
function ResourceReferenceContent({ locator, source, embed = false, onResolved, intent = "asset", sourceMember, initialViewport, onViewportChange }: ReferenceViewProps) {
  const { tChinese } = useUiTranslation();
  const references = useContext(ResourceReferencesContext), inherited = useContext(ReferenceSourceContext), visual = useContext(VisualResourceContext);
  source ??= inherited ?? visual;
  const chain = useContext(ReferenceDepthContext);
  const membership = useRef(sourceMember); membership.current = sourceMember;
  const memberKey = JSON.stringify(sourceMember);
  const cancellation = useRef<AbortController>();
  const prepare = useRef(false);
  const [candidate, setCandidate] = useState<ReferenceCandidate>(), [document, setDocument] = useState<ReferenceDocument>();
  const [board, setBoard] = useState<BoardViewSnapshot>();
  const [imagePath, setImagePath] = useState<string>();
  const [retryable, setRetryable] = useState(true);
  const [pdf, setPdf] = useState<ReferencePdf>();
  const [pdfPage, setPdfPage] = useState(1);
  const [error, setError] = useState(""), [limit, setLimit] = useState(12000), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!references) return;
    const preparation = prepare.current ? "allow" : "cached"; prepare.current = false;
    const abort = new AbortController(); cancellation.current = abort; setError(""); setRetryable(true); setBoard(undefined); setImagePath(undefined); setDocument(undefined); setPdf(undefined); setCandidate(undefined);
    void references.service.resolve(locator, source, abort.signal).then(async (asset) => {
      if (abort.signal.aborted) return;
      setCandidate(asset); onResolved?.(asset);
      if (chain.length >= 2) return;
      if (chain.includes(asset.path)) throw new Error("此处存在循环引用，点击打开原文件。");
      const presentation = await references.service.present(asset.path, { intent: intent === "origin" ? "source" : "self", signal: abort.signal, maxCharacters: limit, preparation });
      if (abort.signal.aborted) return;
      if (presentation.kind === "board") { setBoard(presentation.scene); return; }
      if (presentation.kind === "image") { setImagePath(presentation.path); return; }
      if (presentation.kind === "unavailable") { setError(presentation.message); setRetryable(presentation.retryable); return; }
      if (presentation.kind === "pdf") {
        const original = await references.service.pdf(sourceLocator(presentation.path, locator), abort.signal, presentation.intent === "source" ? "origin" : "asset", membership.current);
        if ((await references.service.present(asset.path, { intent: intent === "origin" ? "source" : "self", signal: abort.signal, maxCharacters: 1, preparation: "cached" })).asset.revision !== presentation.asset.revision) throw new Error("引用已修改或删除，请重新选择来源。");
        if (abort.signal.aborted) return;
        if (original) { setPdf(original); setPdfPage(original.page); return; }
        throw new Error("此资源的原始 PDF 暂不可读取，请打开原文件。");
      }
      const value = presentation.read;
      setDocument({ asset: value.asset, content: value.content, text: value.text, source: value.source, complete: !value.truncated, limit, totalCharacters: value.totalCharacters });
    }).catch((e) => { if (!abort.signal.aborted) { setError(previewErrorMessage(e)); const code = e && typeof e === "object" && "code" in e ? e.code : ""; setRetryable(!["unsupported_type", "ambiguous_provider", "not_found", "permission_denied", "revision_unavailable", "scope_changed"].includes(String(code))); } });
    return () => abort.abort();
  }, [references?.service, locator, source, limit, attempt, intent, memberKey]);
  useEffect(() => candidate ? references?.service.subscribe(candidate.path, () => setAttempt((value) => value + 1)) : undefined, [references?.service, candidate?.path]);
  let content = document?.content;
  let fragment = "", text = document?.text, selectionStart = 0, selectionEnd = document?.text.length ?? 0;
  try {
    fragment = splitReference(locator).fragment;
    if (fragment && document) {
      const selected = referenceFragment(document.text, fragment, document.complete); text = selected.text;
      selectionStart = selected.offsets?.start ?? document.text.split("\n").slice(0, selected.start - 1).reduce((sum, line) => sum + line.length + 1, 0);
      selectionEnd = selected.offsets?.end ?? selectionStart + selected.text.length;
      if (content) content = selectContentRange(content, selectionStart, selectionEnd);
    }
  } catch (e) { text = undefined; if (!error) fragment = e instanceof Error ? e.message : String(e); }
  return <span className={`resource-reference-view${embed ? " is-embed" : ""}`}>
    <span className="resource-reference-heading"><strong>{candidate?.title || "引用内容"}</strong>{candidate && references ? <Tooltip content="打开原文件" relationship="label"><Button size="small" appearance="subtle" icon={<ArrowExpandRegular />} aria-label="打开原文件" onClick={() => { void Promise.resolve(references.open(pdf ? `${pdf.path}#page=${pdfPage}` : sourceLocator(candidate.path, locator))).catch((e) => setError(String(e))); }} /></Tooltip> : null}</span>
    {chain.length >= 2 ? <span>嵌套引用已折叠，请打开原文件继续阅读。</span> : error ? <span role="alert">{error}{retryable ? <Button size="small" onClick={() => setAttempt((value) => value + 1)}>重试</Button> : null}{/正文尚未就绪/.test(error) ? <Button size="small" onClick={() => { prepare.current = true; setAttempt((value) => value + 1); }}>{tChinese("preview.prepareText", "解析正文")}</Button> : null}</span> : board ? <BoardScenePreview scene={board} /> : imagePath ? <AssetImage source={imagePath} alt={candidate?.title} /> : document ? <>
      {!text && fragment ? <span role="status">{fragment}</span> : <ReferenceDepthContext.Provider value={[...chain, candidate!.path]}><ReferenceSourceContext.Provider value={candidate!.path}>
        <ContentView content={content!} renderResourceImage={(url, alt) => <AssetImage source={url} basePath={candidate!.path} alt={alt} />} allowRelativeImages />
      </ReferenceSourceContext.Provider></ReferenceDepthContext.Provider>}
      {!document.complete ? <span className="reference-hint">仅载入部分内容。<Button size="small" disabled={limit >= 80000} onClick={() => setLimit((value) => Math.min(value + 12000, 80000))}>继续载入</Button></span> : null}
    </> : pdf ? <Suspense fallback={<span role="status">正在载入 PDF 预览…</span>}><PdfSourcePreview source={pdf} onPageChange={setPdfPage} initialViewport={initialViewport} onViewportChange={onViewportChange} /></Suspense> : <span role="status">正在读取引用…<Button size="small" onClick={() => { cancellation.current?.abort(); setError(tChinese("preview.cancelled", "已取消读取。")); }}>{tChinese("preview.cancelRead", "取消读取")}</Button></span>}
  </span>;
}

function sourceLocator(path: string, locator: string) {
  const fragment = splitReference(locator).fragment;
  return `${splitReference(path).target}${fragment ? `#${fragment}` : splitReference(path).fragment ? `#${splitReference(path).fragment}` : ""}`;
}

let pinnedReference: string | undefined;
export function ResourceLink({ locator, children, source, previewOnClick = false, actions, preview, onOpen, ariaLabel, presentation = "reference", intent = "asset", sourceMember }: { locator: string; children: ReactNode; source?: string; previewOnClick?: boolean; actions?: ReactNode; preview?: ReactNode; onOpen?(): void | Promise<void>; ariaLabel?: string; presentation?: "reference" | "picker"; intent?: PdfPreviewIntent; sourceMember?: PdfSourceMember }) {
  const references = useContext(ResourceReferencesContext), inherited = useContext(ReferenceSourceContext), visual = useContext(VisualResourceContext);
  source ??= inherited ?? visual;
  const [open, setOpen] = useState(false), [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const pinned = useRef(false), returningFocus = useRef(false), trigger = useRef<HTMLAnchorElement>(null);
  const candidate = useRef<ReferenceCandidate>();
  const opening = useRef<AbortController>();
  const id = useRef(`reference-${Math.random()}`);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { const closeOther = (event: Event) => { if ((event as CustomEvent).detail !== id.current) { clearTimeout(timer.current); opening.current?.abort(); pinned.current = false; setExpanded(false); setOpen(false); } }; window.addEventListener("liteasy:reference-hover", closeOther); return () => { if (pinnedReference === id.current) pinnedReference = undefined; clearTimeout(timer.current); opening.current?.abort(); window.removeEventListener("liteasy:reference-hover", closeOther); }; }, []);
  useEffect(() => { candidate.current = undefined; clearTimeout(timer.current); opening.current?.abort(); setOpen(false); }, [locator, source]);
  const close = () => { clearTimeout(timer.current); opening.current?.abort(); if (pinnedReference === id.current) pinnedReference = undefined; pinned.current = false; setExpanded(false); setOpen(false); returningFocus.current = true; trigger.current?.focus({ preventScroll: true }); };
  const hide = () => { if (pinned.current) return; clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 200); };
  const show = () => { if (pinnedReference || pinned.current) return; clearTimeout(timer.current); timer.current = setTimeout(() => { window.dispatchEvent(new CustomEvent("liteasy:reference-hover", { detail: id.current })); setOpen(true); }, 300); };
  if (!references && !preview) return <span>{children}</span>;
  return <><Popover open={open} onOpenChange={(_, data) => { if (data.open) setOpen(true); else close(); }} positioning={{ position: "below", align: "start", overflowBoundary: document.body }} trapFocus={expanded}>
    <PopoverTrigger disableButtonEnhancement><a ref={trigger} href="#" aria-label={ariaLabel} title={ariaLabel} className="resource-reference-link" onMouseEnter={() => { returningFocus.current = false; show(); }} onFocus={() => { if (returningFocus.current) returningFocus.current = false; else show(); }} onMouseLeave={hide} onBlur={hide}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }} draggable onDragStart={(event) => { if (candidate.current && references) writeAssetContextTransfer(event.dataTransfer, references.service.scope, { kind: "path", path: candidate.current.path }, candidate.current.title); }}
      onClick={(event) => { event.preventDefault(); clearTimeout(timer.current); if (previewOnClick) { pinned.current = true; pinnedReference = id.current; window.dispatchEvent(new CustomEvent("liteasy:reference-hover", { detail: id.current })); setOpen(true); return; } if (onOpen) { void Promise.resolve().then(onOpen).catch((e) => setError(previewErrorMessage(e))); return; } if (!references) return; opening.current?.abort(); const abort = new AbortController(); opening.current = abort; void references.service.resolve(locator, source, abort.signal).then((asset) => { if (!abort.signal.aborted) return references.open(sourceLocator(asset.path, locator)); }).catch((e) => { if (!abort.signal.aborted) setError(previewErrorMessage(e)); }); }}>{children}</a></PopoverTrigger>
    <PopoverSurface className={`resource-reference-popover${presentation === "picker" ? " is-picker-preview" : ""}${expanded ? " is-expanded" : ""}`} aria-label="引用内容预览" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (expanded) setExpanded(false); else close(); } }} onMouseEnter={() => clearTimeout(timer.current)} onFocus={() => clearTimeout(timer.current)} onMouseLeave={hide}>
      <div className="reference-preview-actions">
        {presentation === "picker" ? <IconAction label={expanded ? "缩回预览" : "放大预览"} appearance="subtle" icon={<ArrowExpandRegular />} onClick={() => { pinned.current = true; pinnedReference = id.current; setExpanded(value => !value); }} /> : null}
        <IconAction label="关闭引用预览" appearance="subtle" icon={<DismissRegular />} onClick={close} />
      </div>
      {open ? actions : null}
      {open ? preview ?? <ResourceReferenceView locator={locator} source={source} intent={intent} sourceMember={sourceMember} onResolved={(asset) => { candidate.current = asset; }} /> : null}
    </PopoverSurface>
  </Popover>{error ? <span role="status">{error}</span> : null}</>;
}

export function ResourceEmbed({ locator, source }: { locator: string; source?: string }) {
  const ref = useRef<HTMLSpanElement>(null), [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => { if (!ref.current || typeof IntersectionObserver === "undefined") return; const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "100px" }); observer.observe(ref.current); return () => observer.disconnect(); }, []);
  return <span ref={ref} className="resource-embed">{visible ? <ResourceReferenceView locator={locator} source={source} embed /> : <span>引用内容将在滚动到此处时载入。</span>}</span>;
}
