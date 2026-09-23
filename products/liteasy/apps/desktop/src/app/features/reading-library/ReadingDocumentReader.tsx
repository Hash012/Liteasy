import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button, Field, Input, Popover, PopoverSurface, PopoverTrigger, Select, Slider, Tooltip } from "@fluentui/react-components";
import { ArrowLeftRegular, ArrowRightRegular, BookOpenRegular, DismissRegular, FullScreenMaximizeRegular, SearchRegular, TextFontSizeRegular } from "@fluentui/react-icons";
import { MarkdownContent, safeMarkdownUrl } from "../markdown/MarkdownContent";
import type { ParsedReadingDocument, ReadingChapter } from "./readingDocument.types";
import { readingAnchorId } from "./parseReadingFile";
import "./readingDocumentReader.css";

type ReadingPreferences = { fontSize: number; lineHeight: number; width: number; theme: "auto" | "paper" | "warm" | "night" };
type Position = { chapterId: string; ratio: number };
type SearchResult = { chapterId: string; chapterTitle: string; excerpt: string; occurrence: number };
const defaultPreferences: ReadingPreferences = { fontSize: 19, lineHeight: 1.85, width: 760, theme: "auto" };

function readStored(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}
function writeStored(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Reading remains usable with storage unavailable. */ } }
function readPreferences(key: string): ReadingPreferences {
  const value = readStored(key) as Partial<ReadingPreferences> | null;
  return {
    fontSize: typeof value?.fontSize === "number" && value.fontSize >= 14 && value.fontSize <= 30 ? value.fontSize : defaultPreferences.fontSize,
    lineHeight: [1.5, 1.85, 2.1, 2.4].includes(value?.lineHeight ?? 0) ? value!.lineHeight! : defaultPreferences.lineHeight,
    width: [640, 760, 960].includes(value?.width ?? 0) ? value!.width! : defaultPreferences.width,
    theme: ["auto", "paper", "warm", "night"].includes(value?.theme ?? "") ? value!.theme! : "auto"
  };
}
function readPosition(key: string, chapters: ReadingChapter[]): Position {
  const value = readStored(key) as Partial<Position> | null;
  return value && chapters.some((chapter) => chapter.id === value.chapterId)
    ? { chapterId: value.chapterId!, ratio: Number.isFinite(value.ratio) ? Math.min(1, Math.max(0, value.ratio!)) : 0 }
    : { chapterId: chapters[0]?.id ?? "", ratio: 0 };
}

function findMatches(document: ParsedReadingDocument, query: string, onlyChapter?: string): SearchResult[] {
  if (!query.trim()) return [];
  const term = query.trim().toLocaleLowerCase();
  const matches: SearchResult[] = [];
  for (const chapter of document.chapters) {
    if (onlyChapter && chapter.id !== onlyChapter) continue;
    const lower = chapter.plainText.toLocaleLowerCase();
    let from = 0;
    let occurrence = 0;
    for (let found = lower.indexOf(term, from); found !== -1 && matches.length < 100; found = lower.indexOf(term, from)) {
      matches.push({ chapterId: chapter.id, chapterTitle: chapter.title, occurrence, excerpt: `${found > 28 ? "…" : ""}${chapter.plainText.slice(Math.max(0, found - 28), found + term.length + 70).replace(/\s+/g, " ")}` });
      from = found + term.length;
      occurrence += 1;
    }
    if (matches.length >= 100) break;
  }
  return matches;
}

const EpubContent = memo(function EpubContent({ chapter, document }: { chapter: ReadingChapter; document: ParsedReadingDocument }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    const urls = new Map<string, string>();
    const content = new DOMParser().parseFromString(chapter.content, "text/html");
    const resources = new Map(document.resources.map((resource) => [resource.path, resource]));
    for (const image of Array.from(content.querySelectorAll("img[data-reading-image]"))) {
      const resource = resources.get(image.getAttribute("data-reading-image") ?? "");
      if (!resource) continue;
      const url = urls.get(resource.path) ?? URL.createObjectURL(new Blob([resource.bytes.slice().buffer], { type: resource.mimeType }));
      urls.set(resource.path, url);
      image.setAttribute("src", url);
    }
    setHtml(content.body.innerHTML);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [chapter, document]);
  // Only parseReadingFile emits HTML, after rebuilding its allowlisted tags/attributes.
  return <div className="reading-document__epub" dangerouslySetInnerHTML={{ __html: html }} />;
});

export type ReadingDocumentReaderProps = {
  document: ParsedReadingDocument;
  documentId: string;
  storageScope: string;
  onProgressChange?: (progress: number) => void;
};

/** The keyed boundary isolates position, image URLs and search state when switching books/accounts. */
export function ReadingDocumentReader(props: ReadingDocumentReaderProps) {
  return <ReaderSession key={`${props.storageScope}\u0000${props.documentId}`} {...props} />;
}

function ReaderSession({ document, documentId, storageScope, onProgressChange }: ReadingDocumentReaderProps) {
  const settingsKey = `liteasy.reading.preferences.v1:${encodeURIComponent(storageScope)}`;
  const positionKey = `liteasy.reading.position.v1:${encodeURIComponent(storageScope)}:${encodeURIComponent(documentId)}`;
  const [preferences, setPreferences] = useState(() => readPreferences(settingsKey));
  const [position, setPosition] = useState(() => readPosition(positionKey, document.chapters));
  const positionRef = useRef(position);
  const [sidebar, setSidebar] = useState<"contents" | "search" | null>("contents");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [searchScope, setSearchScope] = useState("book");
  const [focus, setFocus] = useState(false);
  const [jump, setJump] = useState<{ anchor?: string; occurrence?: number; query?: string; nonce: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const progressCallback = useRef(onProgressChange);
  progressCallback.current = onProgressChange;
  const chapterIndex = Math.max(0, document.chapters.findIndex((chapter) => chapter.id === position.chapterId));
  const chapter = document.chapters[chapterIndex];
  const matches = useMemo(() => findMatches(document, deferredQuery, searchScope === "chapter" ? chapter?.id : undefined), [document, deferredQuery, searchScope, chapter?.id]);
  const lengths = useMemo(() => document.chapters.map((item) => Math.max(1, item.plainText.length)), [document]);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const progress = totalLength ? (lengths.slice(0, chapterIndex).reduce((sum, length) => sum + length, 0) + (lengths[chapterIndex] ?? 0) * position.ratio) / totalLength : 0;

  useEffect(() => writeStored(settingsKey, preferences), [settingsKey, preferences]);
  useEffect(() => { progressCallback.current?.(progress); }, [Math.round(progress * 1000)]);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    writeStored(positionKey, positionRef.current);
  }, [positionKey]);

  const updatePosition = (next: Position) => {
    positionRef.current = next;
    setPosition(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => writeStored(positionKey, positionRef.current), 400);
  };
  const goTo = (id: string, anchor?: string, occurrence?: number) => {
    if (!anchor && occurrence === undefined && scrollRef.current) scrollRef.current.scrollTop = 0;
    updatePosition({ chapterId: id, ratio: 0 });
    setJump({ anchor, occurrence, query: deferredQuery, nonce: Date.now() + Math.random() });
  };
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (jump?.anchor || jump?.occurrence !== undefined) return;
    const restore = () => { scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight) * positionRef.current.ratio; };
    restore();
    // EPUB content and decoded images can change height after mounting.
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(restore);
    if (articleRef.current) observer?.observe(articleRef.current);
    return () => observer?.disconnect();
  }, [chapter?.id, preferences.fontSize, preferences.lineHeight, preferences.width]);

  useEffect(() => {
    if (!jump || !articleRef.current) return;
    const performJump = () => {
      const article = articleRef.current;
      if (!article) return;
      article.querySelectorAll("[data-reading-search-hit]").forEach((element) => element.removeAttribute("data-reading-search-hit"));
      if (jump.anchor) {
        const id = readingAnchorId(chapter.id, jump.anchor);
        const target = Array.from(article.querySelectorAll("[id]")).find((element) => element.id === id);
        if (!target) return;
        target.scrollIntoView?.({ block: "start" });
      } else if (jump.query && jump.occurrence !== undefined) {
        const walker = window.document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        let text = "";
        while (walker.nextNode()) { const node = walker.currentNode as Text; nodes.push(node); text += node.textContent; }
        const lower = text.toLocaleLowerCase();
        const term = jump.query.trim().toLocaleLowerCase();
        let index = -term.length;
        for (let occurrence = 0; occurrence <= jump.occurrence; occurrence += 1) { index = lower.indexOf(term, index + term.length); if (index < 0) break; }
        if (index >= 0) {
          let offset = 0;
          const node = nodes.find((item) => { const found = offset + item.length > index; offset += item.length; return found; });
          node?.parentElement?.setAttribute("data-reading-search-hit", "true");
          node?.parentElement?.scrollIntoView?.({ block: "center" });
        } else return;
      }
      const scroller = scrollRef.current;
      if (scroller) {
        const scrollable = scroller.scrollHeight - scroller.clientHeight;
        updatePosition({ chapterId: chapter.id, ratio: scrollable > 0 ? Math.min(1, Math.max(0, scroller.scrollTop / scrollable)) : 0 });
      }
      setJump(null);
    };
    performJump();
    // Await EPUB's bounded image substitution without repeated polling.
    const observer = new MutationObserver(performJump);
    observer.observe(articleRef.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [chapter?.id, jump]);

  if (!chapter) return <p role="status">这份文档没有可阅读的正文。</p>;
  const label = document.format === "epub" ? "EPUB" : document.format === "markdown" ? "Markdown" : "TXT";
  const cssVariables = { "--reading-font-size": `${preferences.fontSize}px`, "--reading-line-height": preferences.lineHeight, "--reading-width": `${preferences.width}px` } as CSSProperties;

  return <div className={`reading-document${focus ? " is-focused" : ""}`} data-reading-theme={preferences.theme} ref={rootRef} style={cssVariables}>
    <header className="reading-document__toolbar">
      <div className="reading-document__tools">
        <Tooltip content="目录" relationship="label"><Button appearance={sidebar === "contents" && !focus ? "subtle" : "transparent"} aria-label="目录" aria-pressed={sidebar === "contents" && !focus} icon={<BookOpenRegular />} onClick={() => { setFocus(false); setSidebar(sidebar === "contents" ? null : "contents"); }} /></Tooltip>
        <Tooltip content="搜索正文" relationship="label"><Button appearance={sidebar === "search" && !focus ? "subtle" : "transparent"} aria-label="搜索正文" aria-pressed={sidebar === "search" && !focus} icon={<SearchRegular />} onClick={() => { setFocus(false); setSidebar(sidebar === "search" ? null : "search"); }} /></Tooltip>
      </div>
      <div className="reading-document__title"><strong title={document.title}>{document.title}</strong><span>{document.authors.join("、") || label}</span></div>
      <div className="reading-document__tools">
        <Popover positioning="below-end">
          <PopoverTrigger disableButtonEnhancement><Tooltip content="阅读外观" relationship="label"><Button appearance="transparent" aria-label="阅读外观" icon={<TextFontSizeRegular />} /></Tooltip></PopoverTrigger>
          <PopoverSurface className="reading-document__preferences">
            <Field label={`字号 ${preferences.fontSize}`}><Slider aria-label="阅读字号" min={14} max={30} step={1} value={preferences.fontSize} onChange={(_, data) => setPreferences((current) => ({ ...current, fontSize: data.value }))} /></Field>
            <Field label="行距"><Select aria-label="阅读行距" value={preferences.lineHeight} onChange={(_, data) => setPreferences((current) => ({ ...current, lineHeight: Number(data.value) }))}><option value="1.5">紧凑</option><option value="1.85">舒适</option><option value="2.1">宽松</option><option value="2.4">疏朗</option></Select></Field>
            <Field label="页面宽度"><Select aria-label="页面宽度" value={preferences.width} onChange={(_, data) => setPreferences((current) => ({ ...current, width: Number(data.value) }))}><option value="640">窄</option><option value="760">适中</option><option value="960">宽</option></Select></Field>
            <Field label="阅读主题"><Select aria-label="阅读主题" value={preferences.theme} onChange={(_, data) => setPreferences((current) => ({ ...current, theme: data.value as ReadingPreferences["theme"] }))}><option value="auto">跟随应用</option><option value="paper">纸白</option><option value="warm">暖纸</option><option value="night">夜读</option></Select></Field>
          </PopoverSurface>
        </Popover>
        <Tooltip content={focus ? "退出专注阅读" : "专注阅读"} relationship="label"><Button appearance="transparent" aria-label={focus ? "退出专注阅读" : "专注阅读"} aria-pressed={focus} icon={focus ? <DismissRegular /> : <FullScreenMaximizeRegular />} onClick={() => setFocus(!focus)} /></Tooltip>
      </div>
    </header>
    <div className="reading-document__body">
      {sidebar && !focus ? <aside className="reading-document__sidebar" aria-label={sidebar === "contents" ? "阅读目录" : "正文搜索"}>
        {sidebar === "contents" ? <><div className="reading-document__section-label">目录 <span>{document.chapters.length} 节</span></div><nav aria-label="章节目录">{document.toc.map((item) => <button aria-current={item.chapterId === chapter.id ? "location" : undefined} className="reading-document__toc-entry" key={item.id} onClick={() => goTo(item.chapterId, item.anchor)} style={{ paddingInlineStart: 12 + item.depth * 12 }}>{item.label}</button>)}</nav></> : <>
          <Input autoFocus aria-label="搜索书内文字" placeholder="搜索书内文字" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => setQuery(data.value)} />
          <Select aria-label="搜索范围" value={searchScope} onChange={(_, data) => setSearchScope(data.value)}><option value="book">整本文档</option><option value="chapter">当前章节</option></Select>
          <p className="reading-document__search-count" role="status">{deferredQuery.trim() ? matches.length ? `${matches.length >= 100 ? "前 " : ""}${matches.length} 处匹配` : "没有找到匹配的文字" : "输入关键词，在正文中快速定位"}</p>
          <div className="reading-document__search-results">{matches.map((match, index) => <button key={`${match.chapterId}-${index}`} onClick={() => goTo(match.chapterId, undefined, match.occurrence)}><strong>{match.chapterTitle}</strong><span>{match.excerpt}</span></button>)}</div>
        </>}
      </aside> : null}
      <div className="reading-document__scroll" ref={scrollRef} tabIndex={0} aria-label="文档阅读区域" onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "ArrowLeft" && chapterIndex > 0) { event.preventDefault(); goTo(document.chapters[chapterIndex - 1].id); }
        if (event.key === "ArrowRight" && chapterIndex + 1 < document.chapters.length) { event.preventDefault(); goTo(document.chapters[chapterIndex + 1].id); }
      }} onScroll={(event) => {
        const element = event.currentTarget;
        const scrollable = element.scrollHeight - element.clientHeight;
        const ratio = scrollable > 0 ? Math.max(0, Math.min(1, element.scrollTop / scrollable)) : 0;
        if (Math.abs(ratio - positionRef.current.ratio) > 0.002) updatePosition({ chapterId: chapter.id, ratio });
      }}>
        <article className="reading-document__page" ref={articleRef} onClick={(event) => {
          const link = (event.target as Element).closest?.("a[data-reading-chapter]");
          if (link) { event.preventDefault(); goTo(link.getAttribute("data-reading-chapter")!, link.getAttribute("data-reading-anchor") ?? undefined); }
        }}>
          <div className="reading-document__chapter-caption">{label} · {chapterIndex + 1} / {document.chapters.length}</div>
          {chapter.format === "html" ? <EpubContent chapter={chapter} document={document} key={chapter.id} /> : chapter.format === "markdown" ? <MarkdownContent value={chapter.content} urlTransform={(url, key) => key === "src" && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(url) ? url : safeMarkdownUrl(url, key) ?? ""} /> : <div className="reading-document__plain-text">{chapter.content}</div>}
          {document.warnings.length ? <details className="reading-document__notes"><summary>文件说明</summary>{document.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details> : null}
          <div className="reading-document__chapter-end"><span>{chapterIndex + 1 === document.chapters.length ? "已到文末" : "本节结束"}</span>{chapterIndex + 1 < document.chapters.length ? <Button appearance="subtle" icon={<ArrowRightRegular />} iconPosition="after" onClick={() => goTo(document.chapters[chapterIndex + 1].id)}>下一节</Button> : <Button appearance="subtle" onClick={() => updatePosition({ chapterId: chapter.id, ratio: 1 })}>标记读完</Button>}</div>
        </article>
      </div>
    </div>
    <footer className="reading-document__footer">
      <Tooltip content="上一节" relationship="label"><Button appearance="transparent" aria-label="上一节" disabled={!chapterIndex} icon={<ArrowLeftRegular />} onClick={() => goTo(document.chapters[chapterIndex - 1].id)} /></Tooltip>
      <span className="reading-document__chapter-name" title={chapter.title}>{chapter.title}</span>
      <progress aria-label="阅读进度" max={100} value={Math.round(progress * 100)} /><span className="reading-document__percentage" aria-label={`已读 ${Math.round(progress * 100)}%`}>{Math.round(progress * 100)}%</span>
      <Tooltip content="下一节" relationship="label"><Button appearance="transparent" aria-label="下一节" disabled={chapterIndex + 1 >= document.chapters.length} icon={<ArrowRightRegular />} onClick={() => goTo(document.chapters[chapterIndex + 1].id)} /></Tooltip>
    </footer>
  </div>;
}
