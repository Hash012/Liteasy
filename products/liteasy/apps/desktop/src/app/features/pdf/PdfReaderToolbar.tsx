import { IconAction } from "../../shared/ui/productPrimitives";
import { SearchOptions } from "../search/SearchOptions";
import {
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverSurface,
  PopoverTrigger
} from "@fluentui/react-components";
import {
  ChevronDownRegular,
  ChevronLeftRegular,
  ChevronRightRegular,
  ChevronUpRegular,
  CommentLinkRegular,
  CommentRegular,
  DismissRegular,
  DrawShapeRegular,
  SearchRegular,
  SettingsRegular,
  MoreHorizontalRegular,
  TextFieldRegular,
  TextColumnOneRegular,
  TextColumnTwoRegular,
  WhiteboardRegular,
  ZoomInRegular,
  ZoomOutRegular
} from "@fluentui/react-icons";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { isMacKeyboard } from "../workbench/workbenchCommands";

export type PdfPageLayoutMode = "continuous" | "single" | "spread";

type PdfReaderToolbarProps = {
  readingControls?: ReactNode;
  inkActive?: boolean;
  onToggleInk?: () => void;
  activeSearchIndex: number;
  currentPage: number;
  layoutMode: PdfPageLayoutMode;
  matchCase: boolean;
  marginCommentsVisible: boolean;
  marginCommentConnectorsVisible: boolean;
  whiteboardOpen: boolean;
  onChangeLayoutMode: (mode: PdfPageLayoutMode) => void;
  onChangeMatchCase: (enabled: boolean) => void;
  onChangePage: (page: number) => void;
  onChangeSearchQuery: (query: string) => void;
  onChangeWholeWords: (enabled: boolean) => void;
  onCloseSearch: () => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onNavigateNext: () => void;
  onNavigatePrevious: () => void;
  onOpenSearch: () => void;
  onToggleMarginComments: () => void;
  onToggleMarginCommentConnectors: () => void;
  onToggleTextBoxTool: () => void;
  onToggleWhiteboard: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  pageCount: number;
  parserStatus?: ReactNode;
  searchTags?: readonly string[];
  searchOpen: boolean;
  searchQuery: string;
  searchResultCount: number;
  textBoxToolActive: boolean;
  wholeWords: boolean;
  zoom: number;
};

export function PdfReaderToolbar({
  readingControls,
  inkActive,
  onToggleInk,
  activeSearchIndex,
  currentPage,
  layoutMode,
  matchCase,
  marginCommentConnectorsVisible,
  marginCommentsVisible,
  whiteboardOpen,
  onChangeLayoutMode,
  onChangeMatchCase,
  onChangePage,
  onChangeSearchQuery,
  onChangeWholeWords,
  onCloseSearch,
  onFindNext,
  onFindPrevious,
  onNavigateNext,
  onNavigatePrevious,
  onOpenSearch,
  onToggleMarginCommentConnectors,
  onToggleMarginComments,
  onToggleTextBoxTool,
  onToggleWhiteboard,
  onZoomIn,
  onZoomOut,
  pageCount,
  parserStatus,
  searchTags,
  searchOpen,
  searchQuery,
  searchResultCount,
  textBoxToolActive,
  wholeWords,
  zoom
}: PdfReaderToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = toolbarRef.current;
    if (!element) return;
    const measure = () => {
      if (!element.clientWidth) return;
      const fontSize = Number.parseFloat(getComputedStyle(element).fontSize) || 14;
      setCompact(element.clientWidth < Math.max(720, 720 * fontSize / 14));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  const [pageDraft, setPageDraft] = useState(String(currentPage));
  const searchInput = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const wasSearchOpen = useRef(false);

  useEffect(() => {
    if (searchOpen && !wasSearchOpen.current) {
      const focused = document.activeElement;
      returnFocus.current = focused instanceof HTMLElement && focused !== document.body
        ? focused : searchButton.current;
      searchInput.current?.focus();
    } else if (!searchOpen && wasSearchOpen.current) {
      const target = returnFocus.current?.isConnected ? returnFocus.current : searchButton.current;
      target?.focus();
      returnFocus.current = null;
    }
    wasSearchOpen.current = searchOpen;
  }, [searchOpen]);

  useEffect(() => {
    setPageDraft(String(currentPage));
  }, [currentPage]);

  function commitPage(force = false) {
    const page = Number(pageDraft);
    if (!Number.isFinite(page)) {
      setPageDraft(String(currentPage));
      return;
    }
    // Leaving an unchanged page field for zoom must not jump back to the page top.
    if (force || page !== currentPage) onChangePage(page);
  }

  function handlePageKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Enter") {
      commitPage(true);
      event.currentTarget.select();
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Enter") {
      if (event.shiftKey) onFindPrevious();
      else onFindNext();
      event.preventDefault();
    } else if (event.key === "Escape") {
      onCloseSearch();
      event.preventDefault();
    }
  }

  const zoomControls = (
    <div aria-label="PDF 比例缩放" className="pdf-reader-toolbar-group" role="group">
      <IconAction density="compact"
        label="按比例缩小 PDF" appearance="subtle" disabled={zoom <= 70}
        icon={<ZoomOutRegular />} onClick={onZoomOut} size="small" title="按比例缩小 PDF（5%）" />
      <span aria-label={`PDF 显示比例 ${zoom}%`} className="pdf-zoom-value">{zoom}%</span>
      <IconAction density="compact"
        label="按比例放大 PDF" appearance="subtle" disabled={zoom >= 180}
        icon={<ZoomInRegular />} onClick={onZoomIn} size="small" title="按比例放大 PDF（5%）" />
    </div>
  );
  const layoutOptions = <>
    <strong>页面布局</strong>
    <div aria-label="页面布局选项" className="pdf-layout-options" role="group">
      <Button appearance={layoutMode === "continuous" ? "primary" : "subtle"}
        icon={<TextColumnOneRegular />} onClick={() => onChangeLayoutMode("continuous")} title="连续滚动显示全部页面">
        连续
      </Button>
      <Button appearance={layoutMode === "single" ? "primary" : "subtle"}
        icon={<TextColumnOneRegular />} onClick={() => onChangeLayoutMode("single")} title="每次显示一页">
        单页
      </Button>
      <Button appearance={layoutMode === "spread" ? "primary" : "subtle"}
        icon={<TextColumnTwoRegular />} onClick={() => onChangeLayoutMode("spread")} title="并排显示两页">
        双页
      </Button>
    </div>
    <small>单页和双页模式可使用翻页按钮、Page Up 与 Page Down 切换页面。</small>
  </>;

  return (
    <div className="pdf-reader-toolbar-wrap" ref={toolbarRef}>
      <div aria-label="PDF 导航工具栏" className="pdf-reader-toolbar" data-compact={compact} role="toolbar">
        {!compact && readingControls ? <div className="pdf-reader-tools" role="group" aria-label="阅读工具">{readingControls}</div> : null}
        <div aria-label="页面导航" className="pdf-reader-toolbar-group" role="group">
          <IconAction density="compact"
            label="上一页"
            appearance="subtle"
            disabled={currentPage <= 1}
            icon={<ChevronUpRegular />}
            onClick={onNavigatePrevious}
            size="small"
            title="上一页"
          />
          <IconAction density="compact"
            label="下一页"
            appearance="subtle"
            disabled={currentPage >= pageCount}
            icon={<ChevronDownRegular />}
            onClick={onNavigateNext}
            size="small"
            title="下一页"
          />
          <Input
            aria-label="当前页码"
            className="pdf-page-number-input"
            max={pageCount}
            min={1}
            onBlur={() => commitPage()}
            onChange={(_, data) => setPageDraft(data.value)}
            onKeyDown={handlePageKeyDown}
            size="small"
            type="number"
            value={pageDraft}
          />
          <span aria-label={`共 ${pageCount} 页`} className="pdf-page-count">/ {pageCount}</span>
        </div>

        {!compact ? zoomControls : null}

        <div className="pdf-reader-toolbar-spacer" />
        {!compact && parserStatus ? <div className="pdf-parser-status">{parserStatus}</div> : null}
        {textBoxToolActive ? <Button size="small" appearance="primary" onClick={onToggleTextBoxTool}>结束文本框</Button> : null}
        {inkActive ? <Button size="small" appearance="primary" onClick={onToggleInk}>结束手绘</Button> : null}
        {!compact ? <IconAction density="compact" label="显示页边批注" description={marginCommentsVisible ? "隐藏高亮与划线的页边批注" : "显示高亮与划线的页边批注"} appearance={marginCommentsVisible ? "primary" : "subtle"} aria-pressed={marginCommentsVisible} icon={<CommentRegular />} onClick={onToggleMarginComments} /> : null}
        <Popover positioning="below-end"><PopoverTrigger disableButtonEnhancement><IconAction density="compact" label={compact ? "更多阅读工具" : "PDF 批注工具"} icon={<MoreHorizontalRegular />} appearance="subtle" /></PopoverTrigger><PopoverSurface aria-label={compact ? "更多阅读工具" : "PDF 批注工具"} className="pdf-layout-popover pdf-reader-overflow">
          {compact ? <>
            {readingControls ? <div className="pdf-reader-tools" role="group" aria-label="阅读工具">{readingControls}</div> : null}
            {zoomControls}
            {parserStatus ? <div className="pdf-parser-status">{parserStatus}</div> : null}
            {layoutOptions}
            <Button size="small" icon={<CommentRegular />} aria-pressed={marginCommentsVisible} onClick={onToggleMarginComments}>显示页边批注</Button>
          </> : null}
          <Button size="small" icon={<TextFieldRegular />} aria-pressed={textBoxToolActive} onClick={onToggleTextBoxTool}>添加 Markdown 文本框</Button>
          <Button size="small" icon={<DrawShapeRegular />} aria-pressed={Boolean(inkActive)} onClick={onToggleInk}>手绘涂鸦</Button>
          <Button size="small" icon={<WhiteboardRegular />} aria-pressed={whiteboardOpen} onClick={onToggleWhiteboard}>{whiteboardOpen ? "关闭 PDF 白板" : "打开 PDF 白板"}</Button>
          {marginCommentsVisible ? <Button size="small" icon={<CommentLinkRegular />} aria-pressed={marginCommentConnectorsVisible} onClick={onToggleMarginCommentConnectors}>显示批注关联线</Button> : null}
        </PopoverSurface></Popover>
        <IconAction density="compact"
          label="在文档中搜索"
          appearance={searchOpen ? "primary" : "subtle"}
          icon={<SearchRegular />}
          ref={searchButton}
          onClick={() => { onOpenSearch(); if (searchOpen) searchInput.current?.focus(); }}
          size="small"
          title={`在文档中搜索（${isMacKeyboard() ? "⌘" : "Ctrl"}+F）`}
        />
        {!compact ? <Popover positioning="below-end" withArrow>
          <PopoverTrigger disableButtonEnhancement>
            <IconAction density="compact"
              label="页面布局设置"
              appearance="subtle"
              icon={<SettingsRegular />}
              size="small"
              title="页面布局设置"
            />
          </PopoverTrigger>
          <PopoverSurface aria-label="页面布局设置面板" className="pdf-layout-popover">
            {layoutOptions}
          </PopoverSurface>
        </Popover> : null}
      </div>

      {searchOpen ? (
        <div aria-label="文档搜索栏" className="pdf-find-bar" role="search">
          <Input
            aria-label="搜索文档内容"
            ref={searchInput}
            className="pdf-find-input"
            contentBefore={<SearchRegular />}
            onChange={(_, data) => onChangeSearchQuery(data.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="在文档中搜索"
            size="small"
            value={searchQuery}
          />
          <SearchOptions query={searchQuery} onChange={onChangeSearchQuery} tags={searchTags} />
          <span aria-live="polite" className="pdf-find-result-count">
            {searchQuery.trim()
              ? searchResultCount > 0
                ? `${activeSearchIndex + 1} / ${searchResultCount}`
                : "未找到"
              : ""}
          </span>
          <IconAction density="compact"
            label="上一个搜索结果"
            appearance="subtle"
            disabled={searchResultCount === 0}
            icon={<ChevronLeftRegular />}
            onClick={onFindPrevious}
            size="small"
            title="上一个搜索结果（Shift+Enter）"
          />
          <IconAction density="compact"
            label="下一个搜索结果"
            appearance="subtle"
            disabled={searchResultCount === 0}
            icon={<ChevronRightRegular />}
            onClick={onFindNext}
            size="small"
            title="下一个搜索结果（Enter）"
          />
          <Checkbox
            checked={matchCase}
            label="区分大小写"
            onChange={(_, data) => onChangeMatchCase(Boolean(data.checked))}
          />
          <Checkbox
            checked={wholeWords}
            label="全字匹配"
            onChange={(_, data) => onChangeWholeWords(Boolean(data.checked))}
          />
          <IconAction density="compact"
            label="关闭文档搜索"
            appearance="subtle"
            icon={<DismissRegular />}
            onClick={onCloseSearch}
            size="small"
            title="关闭搜索"
          />
        </div>
      ) : null}
    </div>
  );
}
