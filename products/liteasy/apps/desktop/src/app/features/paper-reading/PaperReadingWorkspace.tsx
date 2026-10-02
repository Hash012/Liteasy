import { MarkdownEditor } from "../markdown/MarkdownEditor";
import { GenerationPromptEditor } from "../ai-prompts/GenerationPromptEditor";
import { SelectionLookupCard } from "../selection-lookup/SelectionLookupCard";
import { selectionLookupContext } from "../selection-lookup/selectionLookupText";
import { PaperSelectionTools } from "../pdf/PaperSelectionTools";
import { SystemFontPicker } from "../settings/SystemFontPicker";
import { defaultReadingFontCss, readingFontOptions } from "../settings/readingFonts";
import { useReadingHighlights } from "./useReadingHighlights";
import { ReadingMarginComments } from "./ReadingMarginComments";
import type { PdfAnnotationV2 } from "../pdf/pdfAnnotationStorage";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Field, Popover, PopoverSurface, PopoverTrigger, Select, Slider, Textarea, Tooltip, useFocusFinders, useModalAttributes } from "@fluentui/react-components";
import { AddRegular, ArrowUndoRegular, BookOpenRegular, BookmarkRegular, CommentRegular, CommentNoteRegular, DismissRegular, FullScreenMaximizeRegular, FullScreenMinimizeRegular, SearchRegular, TextFontSizeRegular } from "@fluentui/react-icons";
import { guideCategories } from "./literatureGuide.types";
import type { PdfReadingAnnotations, ReadingMarkStyle } from "../pdf/pdfReadingAnnotations";
import type { RetrievalChunk } from "../retrieval/retrieval.types";
import { compactPdfTextForSearch } from "../pdf/pdfTextSearch";
import { PdfAnnotationMarkdown } from "../pdf/PdfAnnotationMarkdown";
import { resolveLocalAccountKey } from "../library/localAccountKey";
import { defaultPaperReadingPreferences, loadPaperReadingPreferences, paperReadingFonts, type PaperReadingPreferences } from "./paperReadingPreferences";
import { usePaperReadingNavigation } from "./usePaperReadingNavigation";
import { PaperReadingNavigator, type ReadingPanel } from "./PaperReadingNavigator";
import { readingMinutes } from "./paperReadingNavigation";
import "./paperReading.css";
import "./literatureGuide.css";

export function readingQuotePages(quote: string, pageTexts: Record<number, string>, chunks: readonly RetrievalChunk[]) {
  const needle = compactPdfTextForSearch(quote);
  if (!needle) return [];
  const pages = new Map<number, string[]>();
  for (const [page, text] of Object.entries(pageTexts)) pages.set(Number(page), [text]);
  for (const chunk of chunks) pages.set(chunk.page, [...(pages.get(chunk.page) ?? []), chunk.snippet]);
  return [...pages].filter(([, texts]) => texts.some((text) => compactPdfTextForSearch(text).includes(needle))).map(([page]) => page);
}

function locateQuote(root: HTMLElement, quote: string) {
  const needle = compactPdfTextForSearch(quote);
  if (!needle) return false;
  const matches: HTMLElement[] = [];
  for (const body of root.querySelectorAll<HTMLElement>(".mineru-markdown")) {
    const pane = body.closest(".paper-resource-tab__reading-pane");
    if (pane && pane.getAttribute("aria-label") !== "原文") continue;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    const offsets: number[] = [];
    let text = "";
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const folded = compactPdfTextForSearch(node.data);
      for (let index = 0; index < folded.length; index += 1) offsets.push(nodes.length);
      nodes.push(node); text += folded;
    }
    const index = text.indexOf(needle);
    if (index >= 0 && text.indexOf(needle, index + 1) < 0) {
      const element = nodes[offsets[index]]?.parentElement;
      if (element) matches.push(element.closest<HTMLElement>("p, li, blockquote, td, h1, h2, h3") ?? element);
    }
  }
  if (matches.length !== 1) return false;
  matches[0].dataset.readingCommentMatch = "true";
  matches[0].scrollIntoView?.({ block: "center", behavior: "smooth" });
  return true;
}

export function PaperReadingWorkspace(props: { session: PdfReadingAnnotations; chunks: readonly RetrievalChunk[]; children: ReactNode }) {
  return <ReadingSession key={props.session.scopeKey} {...props} />;
}

function ReadingSession({ session, chunks, children }: { session: PdfReadingAnnotations; chunks: readonly RetrievalChunk[]; children: ReactNode }) {
  const preferenceKey = `liteasy.paper-reading.preferences.v1:${encodeURIComponent(resolveLocalAccountKey())}`;
  const [preferences, setPreferences] = useState(() => loadPaperReadingPreferences(preferenceKey));
  const [commentsVisible, setCommentsVisible] = useState(!preferences.marginComments);
  const [marginSelectedId, setMarginSelectedId] = useState<string>();
  const [panel, setPanel] = useState<ReadingPanel | null>(null);
  const [focus, setFocus] = useState(false);
  const [guideId, setGuideId] = useState<string>();
  const explanation = session.annotations.find((annotation) => annotation.id === guideId && annotation.aiGuide);
  useEffect(() => {
    const releaseLocalFocus = () => setFocus(false);
    window.addEventListener("liteasy:immersive-reading-enter", releaseLocalFocus);
    return () => window.removeEventListener("liteasy:immersive-reading-enter", releaseLocalFocus);
  }, []);
  const { modalAttributes } = useModalAttributes({ trapFocus: focus, legacyTrapFocus: true });
  const { findFirstFocusable } = useFocusFinders();
  const [draft, setDraft] = useState<{ excerpt: string; page: string; context?: string; id?: string; revision?: number }>();
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookupMode, setLookupMode] = useState<"auto" | "explain">("auto");
  const [lookupDismissed, setLookupDismissed] = useState(false);
  const [note, setNote] = useState("");
  const [markStyle, setMarkStyle] = useState<ReadingMarkStyle>();
  const [systemPrompt, setSystemPrompt] = useState<string>();
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const askAbort = useRef<AbortController>();
  useEffect(() => () => askAbort.current?.abort(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const navigation = usePaperReadingNavigation(contentRef, session.scopeKey);
  const mounted = useRef(true);
  const showComments = commentsVisible && !panel && !focus;
  const showMargins = preferences.marginComments && !showComments && !panel;
  const totalMinutes = useMemo(() => readingMinutes(navigation.blocks), [navigation.blocks]);
  const minutes = Math.max(1, Math.ceil(totalMinutes * (1 - navigation.progress)));
  const pages = [...new Set([...Array.from({ length: session.pageCount }, (_, index) => index + 1), ...chunks.map((chunk) => chunk.page)])].sort((a, b) => a - b);
  useEffect(() => { mounted.current = true; rootRef.current?.focus({ preventScroll: true }); return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (focus && rootRef.current) findFirstFocusable(rootRef.current)?.focus({ preventScroll: true }); }, [focus, findFirstFocusable]);
  useEffect(() => {
    try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Keep session preferences. */ }
  }, [preferenceKey, preferences]);

  function changePreferences(next: PaperReadingPreferences) {
    navigation.rememberPosition();
    setPreferences(next);
  }
  useLayoutEffect(() => {
    navigation.restorePosition();
  }, [preferences, panel, commentsVisible, focus]);
  function openPanel(next: ReadingPanel) { navigation.rememberPosition(); setPanel(next); }
  function closePanel() {
    navigation.rememberPosition(); setPanel(null);
    if (rootRef.current) (focus ? findFirstFocusable(rootRef.current) : rootRef.current)?.focus({ preventScroll: true });
  }
  function toggleFocus() { navigation.rememberPosition(); setFocus(!focus); setPanel(null); }
  function openComments() { setPanel(null); setFocus(false); setCommentsVisible(true); }

  function locate(id: string) {
    const annotation = session.annotations.find((item) => item.id === id);
    const root = contentRef.current;
    if (!annotation || !root) return false;
    root.querySelectorAll("[data-reading-comment-match]").forEach((node) => node.removeAttribute("data-reading-comment-match"));
    openComments();
    setMarginSelectedId(id);
    const matched = locateQuote(root, annotation.excerpt);
    if (matched) setMessage(`已定位第 ${annotation.page} 页批注的原文。`);
    else {
      const page = root.querySelector<HTMLElement>(`[data-reading-page="${annotation.page}"]`);
      page?.scrollIntoView?.({ block: "start", behavior: "smooth" });
      setMessage(`此批注属于第 ${annotation.page} 页，当前文字未能精确对应。可切换原文或查看 PDF 定位。`);
    }
    Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-reading-annotation-id]") ?? [])
      .find((element) => element.dataset.readingAnnotationId === id)?.scrollIntoView?.({ block: "nearest" });
    return matched;
  }
  useEffect(() => {
    const id = session.selectedId, root = contentRef.current;
    if (!id || !root || !session.ready) return;
    let frame = 0, disposed = false, attempted = false;
    // The extracted document can mount after the PDF requests a jump. Resolve
    // when its text arrives or is replaced. An existing mark leaves normal
    // scrolling alone; asynchronous Markdown hydration can replace that node.
    const attempt = () => {
      frame = 0;
      if (!disposed && (!attempted || !root.querySelector("[data-reading-comment-match]"))) {
        attempted = true; locate(id);
      }
    };
    const observer = new MutationObserver(() => { if (!disposed && !frame) frame = requestAnimationFrame(attempt); });
    observer.observe(root, { childList: true, characterData: true, subtree: true });
    attempt();
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); };
  }, [session.selectedId, session.ready]);

  useReadingHighlights(contentRef, session.annotations, (id) => {
    if (showMargins) setMarginSelectedId(id);
    else if (session.annotations.some((annotation) => annotation.id === id && annotation.aiGuide)) setGuideId(id);
    else locate(id);
  });

  function captureSelection() {
    if (draft?.id || busy) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !contentRef.current?.contains(selection.anchorNode) || !contentRef.current.contains(selection.focusNode)) return;
    const start = selection.anchorNode?.parentElement?.closest(".mineru-markdown");
    const end = selection.focusNode?.parentElement?.closest(".mineru-markdown");
    if (!start || start !== end) return;
    const pane = start.closest(".paper-resource-tab__reading-pane");
    if (pane && pane.getAttribute("aria-label") !== "原文") { setMessage("请在原文侧选择批注位置；已有批注可在右侧查看。"); return; }
    const excerpt = selection.toString().trim();
    if (!excerpt) return;
    if (excerpt.length > 4000) { setMessage("选段过长，请缩小范围后添加批注。"); return; }
    const candidates = readingQuotePages(excerpt, session.pageTexts, chunks);
    const page = candidates.length === 1 ? String(candidates[0]) : start.closest<HTMLElement>("[data-reading-page]")?.dataset.readingPage ?? "";
    const paragraph = selection.anchorNode?.parentElement?.closest("p, li, blockquote, td")?.textContent ?? "";
    setDraft({ excerpt, page, context: selectionLookupContext(paragraph || session.pageTexts[Number(page)] || "", excerpt) });
    setLookupOpen(false); setLookupDismissed(false); setLookupMode("auto"); setAsking(false); askAbort.current?.abort();
    setMarkStyle({ kind: "highlight", color: "yellow" }); setNote(""); openComments(); setError("");
    setMessage(page ? `已选择第 ${page} 页原文。` : "请选择选段所在的 PDF 页码；保存后可在两种模式中查看。");
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true); setError("");
    try {
      if (draft.id) await session.update(draft.id, draft.revision!, note, markStyle);
      else await session.create({ page: Number(draft.page), excerpt: draft.excerpt, note, ...markStyle });
      if (mounted.current) { setDraft(undefined); setNote(""); if (preferences.marginComments) setCommentsVisible(false); setMessage("批注已保存，PDF 与阅读模式共用同一份内容。"); }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "保存失败，请重试。"); }
    finally { if (mounted.current) setBusy(false); }
  }

  function editAnnotation(annotation: PdfAnnotationV2) {
    setMarkStyle(annotation.kind === "highlight" || annotation.kind === "underline" ? { kind: annotation.kind, color: annotation.color } : undefined);
    setDraft({ id: annotation.id, revision: annotation.revision, page: String(annotation.page), excerpt: annotation.excerpt });
    setNote(annotation.note ?? ""); setError(""); openComments();
  }

  async function selectionAction(action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); if (mounted.current) setMessage(success); }
    catch (failure) { if (mounted.current) setError(String(failure)); }
    finally { if (mounted.current) setBusy(false); }
  }
  const fontOverride = preferences.fontFamily ?? (preferences.font === "serif" ? "" : paperReadingFonts[preferences.font].family);
  const styles = { "--paper-reading-font": fontOverride || defaultReadingFontCss, "--paper-reading-size": `${preferences.fontSize}px`,
    "--paper-reading-width": preferences.width ? `${preferences.width}px` : "100%", "--paper-reading-line-height": preferences.lineHeight,
    "--paper-reading-alignment": preferences.alignment, "--paper-reading-paragraph-spacing": `${preferences.paragraphSpacing}em` } as CSSProperties;
  return <div className={`paper-reading-workspace${focus ? " is-focused" : ""}`} ref={rootRef} style={styles} data-reading-theme={preferences.theme} tabIndex={-1}
    {...modalAttributes} role={focus ? "dialog" : undefined} aria-modal={focus || undefined} aria-label={focus ? "专注阅读" : undefined}
    onKeyDown={(event) => {
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "f") {
        event.preventDefault(); event.stopPropagation();
        if (event.shiftKey) toggleFocus(); else openPanel("search");
      } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "b") {
        event.preventDefault(); event.stopPropagation(); navigation.addBookmark(); openPanel("bookmarks");
      } else if (event.key === "Escape" && !((event.target as HTMLElement).closest("textarea, [contenteditable=true]"))) {
        if (explanation) { event.preventDefault(); event.stopPropagation(); setGuideId(undefined); }
        else if (panel) { event.preventDefault(); event.stopPropagation(); closePanel(); }
        else if (focus) { event.preventDefault(); event.stopPropagation(); toggleFocus(); }
      }
    }}>
    <div className="paper-reading-toolbar" role="toolbar" aria-label="阅读排版与批注">
      {session.readerControls}
      <Tooltip content="章节目录" relationship="description"><Button aria-label="阅读目录" aria-pressed={panel === "contents"} icon={<BookOpenRegular />} onClick={() => panel === "contents" ? closePanel() : openPanel("contents")} /></Tooltip>
      <Tooltip content="查找正文（Ctrl / ⌘ + F）" relationship="description"><Button aria-label="查找阅读正文" aria-pressed={panel === "search"} icon={<SearchRegular />} onClick={() => panel === "search" ? closePanel() : openPanel("search")} /></Tooltip>
      <Tooltip content="查看书签；Ctrl / ⌘ + Shift + B 收藏当前位置" relationship="description"><Button aria-label="阅读书签" aria-pressed={panel === "bookmarks"} icon={<BookmarkRegular />} onClick={() => panel === "bookmarks" ? closePanel() : openPanel("bookmarks")} /></Tooltip>
      <Popover positioning="below-start">
        <PopoverTrigger disableButtonEnhancement><Tooltip content="调整字号、字体与版面" relationship="description">
          <Button icon={<TextFontSizeRegular />}>阅读排版</Button>
        </Tooltip></PopoverTrigger>
        <PopoverSurface aria-label="阅读排版设置" className="paper-reading-preferences">
          <Field label={`字号 ${preferences.fontSize} px`}><Slider aria-label="阅读字号" min={14} max={30} step={1} value={preferences.fontSize}
            onChange={(_, data) => changePreferences({ ...preferences, fontSize: data.value })} /></Field>
          <Field label="字体"><SystemFontPicker label="阅读字体" value={fontOverride}
            options={[{ label: "跟随阅读设置", value: "" }, ...readingFontOptions]}
            onChange={(fontFamily) => changePreferences({ ...preferences, fontFamily: fontFamily || undefined, font: "serif" })} /></Field>
          <Field label="页面宽度"><Select aria-label="阅读页面宽度" value={preferences.width} onChange={(_, data) => changePreferences({ ...preferences, width: Number(data.value) })}>
            <option value="640">窄版</option><option value="800">适中</option><option value="1080">宽版</option><option value="0">填满窗口</option>
          </Select></Field>
          <Field label="行距"><Select aria-label="阅读行距" value={preferences.lineHeight} onChange={(_, data) => changePreferences({ ...preferences, lineHeight: Number(data.value) })}>
            <option value="1.5">紧凑</option><option value="1.85">舒适</option><option value="2.2">宽松</option>
          </Select></Field>
          <Field label="对齐"><Select aria-label="阅读对齐" value={preferences.alignment} onChange={(_, data) => changePreferences({ ...preferences, alignment: data.value as "left" | "justify" })}>
            <option value="left">左对齐</option><option value="justify">两端对齐</option>
          </Select></Field>
          <Field label="段间距"><Select aria-label="阅读段间距" value={preferences.paragraphSpacing} onChange={(_, data) => changePreferences({ ...preferences, paragraphSpacing: Number(data.value) })}>
            <option value="0.6">紧凑</option><option value="1">舒适</option><option value="1.5">宽松</option>
          </Select></Field>
          <Field label="阅读主题"><Select aria-label="阅读主题" value={preferences.theme} onChange={(_, data) => changePreferences({ ...preferences, theme: data.value as PaperReadingPreferences["theme"] })}>
            <option value="auto">跟随应用</option><option value="paper">纸白</option><option value="warm">暖纸</option><option value="night">夜读</option>
          </Select></Field>
          <Button onClick={() => changePreferences(defaultPaperReadingPreferences)}>恢复默认排版</Button>
        </PopoverSurface>
      </Popover>
      <Button icon={<AddRegular />} disabled={!session.ready || Boolean(draft)} onClick={() => {
        setDraft({ page: String(session.focusedPage), excerpt: "" }); setMarkStyle(undefined); setNote(""); openComments(); setError("");
      }}>添加页批注</Button>
      <Button icon={<CommentRegular />} aria-pressed={showComments} onClick={() => { navigation.rememberPosition(); if (showComments) setCommentsVisible(false); else openComments(); }}>批注（{session.annotations.length}）</Button>
      <Tooltip content="在正文右侧显示批注，虚线连接原文" relationship="description"><Button icon={<CommentNoteRegular />} aria-pressed={showMargins}
        onClick={() => {
          navigation.rememberPosition(); setPanel(null); setCommentsVisible(false); setGuideId(undefined);
          setPreferences({ ...preferences, marginComments: !showMargins });
        }}>页边批注</Button></Tooltip>
      <Tooltip content="专注阅读（Ctrl / ⌘ + Shift + F）；Esc 退出" relationship="description"><Button icon={focus ? <FullScreenMinimizeRegular /> : <FullScreenMaximizeRegular />} aria-pressed={focus} onClick={toggleFocus}>{focus ? "退出专注" : "专注阅读"}</Button></Tooltip>
      {session.guideControls}
    </div>
    <div className={`paper-reading-body${showComments || panel ? " with-comments" : ""}`}>
      <div className="paper-reading-content" ref={contentRef} onMouseUp={captureSelection} onKeyUp={(event) => { if (event.key === "Shift") captureSelection(); }}>{children}
        {showMargins ? <ReadingMarginComments contentRef={contentRef} annotations={session.annotations} selectedId={marginSelectedId}
          width={preferences.marginWidth} onWidthChange={(marginWidth) => changePreferences({ ...preferences, marginWidth })}
          disabled={busy || !session.ready || Boolean(draft)} onSelect={setMarginSelectedId} onEdit={editAnnotation}
          onOpenPdf={session.openPdf} onShowList={openComments} /> : null}
      </div>
      {explanation?.aiGuide ? <aside className="literature-guide-explanation" aria-label="AI 讲解">
        <header><strong>{explanation.text || guideCategories[explanation.aiGuide.category]}</strong>
          <Tooltip content="关闭讲解（Esc）" relationship="description"><Button appearance="subtle" icon={<DismissRegular />} aria-label="关闭 AI 讲解" onClick={() => setGuideId(undefined)} /></Tooltip>
        </header>
        <PdfAnnotationMarkdown value={explanation.note ?? ""} />
        <small>AI 讲解 · {guideCategories[explanation.aiGuide.category]} · 请结合原文判断</small>
        <Button appearance="subtle" size="small" onClick={() => { setGuideId(undefined); locate(explanation.id); }}>查看或编辑批注</Button>
      </aside> : null}
      {panel ? <PaperReadingNavigator panel={panel} onPanelChange={openPanel} onClose={closePanel} navigation={navigation} /> : null}
      {showComments ? <aside aria-label="阅读模式批注" className="paper-reading-comments">
        <strong>批注 · 与 PDF 共用</strong>
        {!session.ready ? <p role="status">正在恢复批注…</p> : null}
        {session.error || error ? <p role="alert">{error || session.error}</p> : null}
        {message ? <p role="status">{message}</p> : null}
        {draft ? <div className="paper-reading-comment-editor">
          <strong>{draft.id ? "编辑批注" : "新建批注"}</strong>
          {draft.excerpt ? <blockquote>{draft.excerpt}</blockquote> : null}
          {draft.excerpt && !draft.id ? <>
            <PaperSelectionTools extensionActions={session.extensionActions?.({ page: Number(draft.page), excerpt: draft.excerpt })} disabled={busy || !session.ready || !draft.page}
              lookup={session.lookup ? () => { setLookupMode("auto"); setLookupOpen(true); setLookupDismissed(false); } : undefined} lookupDisabled={false}
              aiLookup={session.lookup ? () => { setLookupMode("explain"); setLookupOpen(true); setLookupDismissed(false); } : undefined}
              highlight={() => void selectionAction(() => session.create({ page: Number(draft.page), excerpt: draft.excerpt, note, kind: "highlight", color: markStyle?.color ?? "yellow" }), "高亮已保存。")}
              underline={() => void selectionAction(() => session.create({ page: Number(draft.page), excerpt: draft.excerpt, note, kind: "underline", color: markStyle?.color ?? "blue" }), "划线已保存。")}
              copy={() => void selectionAction(() => navigator.clipboard.writeText(draft.excerpt), "已复制选段。")}
              board={session.capture ? () => void selectionAction(() => session.capture!({ page: Number(draft.page), excerpt: draft.excerpt }, "board"), "摘录已加入白板。") : undefined}
              tray={session.capture ? () => void selectionAction(() => session.capture!({ page: Number(draft.page), excerpt: draft.excerpt }, "tray"), "摘录已加入所选内容对话。") : undefined}
              conversation={session.capture ? () => void selectionAction(() => session.capture!({ page: Number(draft.page), excerpt: draft.excerpt }, "conversation"), "选段已加入对话。") : undefined}
              quickAsk={session.quickAsk ? () => { setSystemPrompt(undefined); setAsking(true); } : undefined} />
            {session.lookup && !lookupDismissed && (lookupOpen || session.lookup.autoQuery) ? <SelectionLookupCard
              key={draft.excerpt} lookup={session.lookup} text={draft.excerpt} context={draft.context}
              initialMode={lookupMode}
              paperId={session.paperId} paperTitle={session.paperTitle}
              onClose={() => { setLookupOpen(false); setLookupDismissed(true); }}
              onSave={session.ready && draft.page ? (translation) => session.create({ page: Number(draft.page), excerpt: draft.excerpt, note: translation }) : undefined}
              onExplain={session.quickAsk && draft.page ? () => { setSystemPrompt(undefined); setQuestion("请结合所在句子解释这个单词或短语在论文中的具体含义，说明它与常见释义的关系。"); setAsking(true); setLookupOpen(false); setLookupDismissed(true); } : undefined} /> : null}
            {asking && session.quickAsk ? <form aria-label="阅读速问" onSubmit={(event) => {
              event.preventDefault(); if (!question.trim() || busy) return;
              const abort = new AbortController(); askAbort.current = abort;
              void selectionAction(() => session.quickAsk!({ page: Number(draft.page), excerpt: draft.excerpt, question, ...(systemPrompt !== undefined ? { systemPrompt } : {}) }, abort.signal), "速问已保存到批注。PDF 与阅读模式均可查看。");
            }}><Field label="速问问题"><Textarea aria-label="速问问题" value={question} disabled={busy} onChange={(_, data) => setQuestion(data.value)} maxLength={4000} /></Field>
              <GenerationPromptEditor task="selection_explanation" value={systemPrompt} onChange={setSystemPrompt} disabled={busy} />
              <small>上下文：当前页全文与论文摘要</small>
              <Button type="submit" disabled={busy || !question.trim() || !draft.page}>提问</Button>
              <Button onClick={() => { askAbort.current?.abort(); setAsking(false); }}>取消速问</Button></form> : null}
          </> : null}
          <Field label="PDF 页码"><Select aria-label="批注页码" value={draft.page} disabled={busy || Boolean(draft.id)} onChange={(_, data) => setDraft({ ...draft, page: data.value })}>
            <option value="">请选择页码</option>{pages.map((page) => <option key={page} value={page}>第 {page} 页</option>)}
          </Select></Field>
          {markStyle ? <>
            <Field label="标记"><Select aria-label="标记类型" value={markStyle.kind} onChange={(_, data) => setMarkStyle({ ...markStyle, kind: data.value as ReadingMarkStyle["kind"] })}>
              <option value="highlight">高亮</option><option value="underline">下划线</option>{!draft.id ? <option value="note">页批注</option> : null}
            </Select></Field>
            {markStyle.kind !== "note" ? <Field label="颜色"><Select aria-label="标记颜色" value={markStyle.color ?? (markStyle.kind === "underline" ? "blue" : "yellow")} onChange={(_, data) => setMarkStyle({ ...markStyle, color: data.value as ReadingMarkStyle["color"] })}>
              <option value="yellow">黄色</option><option value="red">红色</option><option value="blue">蓝色</option><option value="green">绿色</option><option value="pink">粉色</option>
            </Select></Field> : null}
          </> : null}
          <Field label="批注内容"><MarkdownEditor documentKey={draft.id ?? "new-reading-comment"} label="阅读批注内容" value={note} readOnly={busy} onChange={setNote} /></Field>
          <div className="paper-reading-comment-actions"><Button appearance="primary" disabled={busy || !session.ready || !draft.page || (!draft.id && !note.trim() && !draft.excerpt)} onClick={() => void save()}>保存批注</Button>
            <Button disabled={busy} onClick={() => { setDraft(undefined); setNote(""); setError(""); if (preferences.marginComments) setCommentsVisible(false); }}>取消</Button></div>
        </div> : null}
        {!session.annotations.length && !draft && session.ready ? <p>选中原文后添加批注，或记录整页想法。</p> : null}
        {session.annotations.map((annotation) => <article className="paper-reading-comment" key={annotation.id} data-reading-annotation-id={annotation.id}>
          {annotation.aiGuide ? <Button size="small" appearance="subtle" onClick={() => setGuideId(annotation.id)}>AI 讲解 · {annotation.text || guideCategories[annotation.aiGuide.category]}</Button> : null}
          <button type="button" className="paper-reading-comment-source" onClick={() => locate(annotation.id)}>第 {annotation.page} 页 · {annotation.excerpt || (annotation.kind === "ink" ? "手绘批注" : "页批注")}</button>
          <PdfAnnotationMarkdown value={annotation.quickAsk ? `${annotation.quickAsk.question}\n\n${annotation.quickAsk.answer}` : annotation.note || (annotation.kind === "text" ? annotation.text : "")}
            images={annotation.images} emptyLabel={annotation.kind === "ink" ? "手绘笔迹可在 PDF 原页查看。" : "尚无补充评论"} />
          {session.annotationTools ? session.annotationTools(annotation) : annotation.review ? <PdfAnnotationMarkdown value={annotation.review.text} /> : null}
          <div className="paper-reading-comment-actions">
            <Button size="small" onClick={() => session.openPdf(annotation.id)}>查看 PDF</Button>
            <Button size="small" disabled={busy || !session.ready || Boolean(draft)} onClick={() => editAnnotation(annotation)}>编辑</Button>
            <Button size="small" disabled={busy || !session.ready || Boolean(draft)} onClick={() => {
              setBusy(true); setError("");
              void session.remove(annotation.id).catch((failure) => { if (mounted.current) setError(failure instanceof Error ? failure.message : "删除失败"); })
                .finally(() => { if (mounted.current) setBusy(false); });
            }}>删除</Button>
          </div>
        </article>)}
      </aside> : null}
    </div>
    {navigation.notice ? <div className="paper-reading-notice" role="status">{navigation.notice}</div> : null}
    <footer className="paper-reading-progress">
      <Tooltip content="返回目录、查找或书签跳转前的位置" relationship="description"><Button size="small" appearance="subtle" icon={<ArrowUndoRegular />} disabled={!navigation.canGoBack} onClick={navigation.goBack}>返回跳转前</Button></Tooltip>
      <progress aria-label="正文阅读位置" max={100} value={Math.round(navigation.progress * 100)} />
      <span>位置 {Math.round(navigation.progress * 100)}%</span>
      {navigation.blocks.length ? <span title="按中文每分钟 300 字、英文每分钟 220 词粗略估算；公式与图表需要额外时间。">{navigation.progress >= 0.995 ? "已到文末" : `约余 ${minutes} 分钟`}</span> : null}
    </footer>
  </div>;
}
