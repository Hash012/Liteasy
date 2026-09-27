import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { indexReadingContent, readReadingHistory, readingLocation, restoreReadingLocation, type ReadingBlock, type ReadingLocation } from "./paperReadingNavigation";

export function usePaperReadingNavigation(contentRef: RefObject<HTMLElement>, scope: string) {
  const storageKey = `liteasy.paper-reading.history.v1:${encodeURIComponent(scope)}`;
  const [initialHistory] = useState(() => readReadingHistory(storageKey));
  const history = useRef(initialHistory);
  const [bookmarks, setBookmarks] = useState(history.current.bookmarks);
  const [index, setIndex] = useState<ReturnType<typeof indexReadingContent>>({ blocks: [], scroller: null, view: "原文" });
  const indexRef = useRef(index);
  const [progress, setProgress] = useState(0);
  const [activeHeading, setActiveHeading] = useState("");
  const [notice, setNotice] = useState("");
  const [backStack, setBackStack] = useState<ReadingLocation[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  function persist() {
    if (!scope) return;
    try { localStorage.setItem(storageKey, JSON.stringify(history.current)); }
    catch { setNotice("阅读记录暂时无法保存在本机，下次打开可能无法恢复。"); }
  }
  function current() {
    const { blocks, scroller, view } = indexRef.current;
    return scroller && blocks.length ? readingLocation(blocks, scroller, view) : undefined;
  }
  function rememberPosition() {
    const location = current();
    if (!location) return;
    history.current.positions[location.view] = location;
    setProgress(location.ratio);
    const { blocks, scroller } = indexRef.current;
    const headings = blocks.filter((block) => block.level);
    const top = scroller!.getBoundingClientRect().top + 40;
    setActiveHeading([...headings].reverse().find((block) => block.element.getBoundingClientRect().top <= top)?.key ?? headings[0]?.key ?? "");
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 400);
  }
  function restorePosition() {
    const { blocks, scroller, view } = indexRef.current;
    const position = history.current.positions[view];
    if (scroller && position) restoreReadingLocation(position, blocks, scroller);
  }

  useLayoutEffect(() => () => {
    const location = current();
    if (location) history.current.positions[location.view] = location;
  }, []);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let frame = 0;
    let resize: ResizeObserver | undefined;
    let scroller: HTMLElement | null = null;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => rememberPosition());
    };
    const rebuild = () => {
      const next = indexReadingContent(root);
      const previous = indexRef.current;
      if (next.scroller === previous.scroller && next.view === previous.view && next.blocks.length === previous.blocks.length
        && next.blocks.every((block, i) => block.element === previous.blocks[i].element && block.text === previous.blocks[i].text)) return;
      scroller?.removeEventListener("scroll", onScroll);
      resize?.disconnect();
      indexRef.current = next;
      setIndex(next);
      scroller = next.scroller;
      if (!scroller || !next.blocks.length) return;
      restorePosition();
      rememberPosition();
      scroller.addEventListener("scroll", onScroll, { passive: true });
      if (typeof ResizeObserver !== "undefined") {
        resize = new ResizeObserver(() => { restorePosition(); rememberPosition(); });
        resize.observe(scroller);
        // Images, formulas and typography can resize the article after the initial layout.
        for (const body of scroller.querySelectorAll(".mineru-markdown")) resize.observe(body);
      }
    };
    rebuild();
    const observer = new MutationObserver(rebuild);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer.current);
      observer.disconnect(); resize?.disconnect(); scroller?.removeEventListener("scroll", onScroll);
      // Use the last live snapshot: refs and DOM may already be detached during cleanup.
      if (scope) try { localStorage.setItem(storageKey, JSON.stringify(history.current)); } catch { /* Session already closed. */ }
    };
  }, [contentRef, scope, storageKey]);

  function jump(location: ReadingLocation, remember = true) {
    const { blocks, scroller, view } = indexRef.current;
    if (location.view !== view) { setNotice(`请先切换至${location.view}，再打开这个阅读位置。`); return false; }
    if (!scroller) return false;
    const previous = current();
    if (remember && previous) setBackStack((stack) => [...stack.slice(-19), previous]);
    restoreReadingLocation(location, blocks, scroller);
    scroller.querySelectorAll("[data-reading-navigation-match]").forEach((element) => element.removeAttribute("data-reading-navigation-match"));
    const target = blocks.find((block) => block.key === location.key);
    if (target) target.element.dataset.readingNavigationMatch = "true";
    rememberPosition();
    setNotice(blocks.some((block) => block.key === location.key) ? "" : "正文内容已变化，已按原阅读进度恢复到附近位置。");
    return true;
  }
  function goToBlock(block: ReadingBlock) {
    const previous = current();
    if (previous) setBackStack((stack) => [...stack.slice(-19), previous]);
    const scroller = indexRef.current.scroller;
    if (!scroller) return;
    scroller.scrollTop += block.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
    scroller.querySelectorAll("[data-reading-navigation-match]").forEach((element) => element.removeAttribute("data-reading-navigation-match"));
    block.element.dataset.readingNavigationMatch = "true";
    rememberPosition(); setNotice("");
  }
  function addBookmark() {
    const location = current();
    if (!location) return;
    if (bookmarks.some((item) => item.location.view === location.view && item.location.key === location.key)) {
      setNotice("这个段落已经有书签。"); return;
    }
    if (bookmarks.length >= 200) { setNotice("本篇已有 200 个书签，请先移除不再需要的书签。"); return; }
    const block = indexRef.current.blocks.find((item) => item.key === location.key);
    const next = [...bookmarks, { id: crypto.randomUUID(), label: block?.text.slice(0, 100) || "阅读位置", location }];
    history.current.bookmarks = next; setBookmarks(next); setNotice("已添加书签。"); persist();
  }
  function removeBookmark(id: string) {
    const next = bookmarks.filter((item) => item.id !== id);
    history.current.bookmarks = next; setBookmarks(next); persist();
  }
  function goBack() {
    const location = backStack[backStack.length - 1];
    if (location && jump(location, false)) setBackStack((stack) => stack.slice(0, -1));
  }
  return { ...index, progress, activeHeading, bookmarks, notice, canGoBack: Boolean(backStack.length),
    jump, goToBlock, goBack, addBookmark, removeBookmark, rememberPosition, restorePosition };
}
