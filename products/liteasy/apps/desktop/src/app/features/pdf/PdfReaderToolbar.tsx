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
  SearchRegular,
  SettingsRegular,
  TextFieldRegular,
  TextColumnOneRegular,
  TextColumnTwoRegular,
  WhiteboardRegular,
  ZoomInRegular,
  ZoomOutRegular
} from "@fluentui/react-icons";
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

export type PdfPageLayoutMode = "continuous" | "single" | "spread";

type PdfReaderToolbarProps = {
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
  searchOpen: boolean;
  searchQuery: string;
  searchResultCount: number;
  textBoxToolActive: boolean;
  wholeWords: boolean;
  zoom: number;
};

export function PdfReaderToolbar({
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
  searchOpen,
  searchQuery,
  searchResultCount,
  textBoxToolActive,
  wholeWords,
  zoom
}: PdfReaderToolbarProps) {
  const [pageDraft, setPageDraft] = useState(String(currentPage));

  useEffect(() => {
    setPageDraft(String(currentPage));
  }, [currentPage]);

  function commitPage() {
    const page = Number(pageDraft);
    if (!Number.isFinite(page)) {
      setPageDraft(String(currentPage));
      return;
    }
    onChangePage(page);
  }

  function handlePageKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      commitPage();
      event.currentTarget.select();
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      if (event.shiftKey) onFindPrevious();
      else onFindNext();
      event.preventDefault();
    } else if (event.key === "Escape") {
      onCloseSearch();
      event.preventDefault();
    }
  }

  return (
    <div className="pdf-reader-toolbar-wrap">
      <div aria-label="PDF 导航工具栏" className="pdf-reader-toolbar" role="toolbar">
        <div aria-label="页面导航" className="pdf-reader-toolbar-group" role="group">
          <Button
            aria-label="上一页"
            appearance="subtle"
            disabled={currentPage <= 1}
            icon={<ChevronUpRegular />}
            onClick={onNavigatePrevious}
            size="small"
            title="上一页"
          />
          <Button
            aria-label="下一页"
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
            onBlur={commitPage}
            onChange={(_, data) => setPageDraft(data.value)}
            onKeyDown={handlePageKeyDown}
            size="small"
            type="number"
            value={pageDraft}
          />
          <span aria-label={`共 ${pageCount} 页`} className="pdf-page-count">/ {pageCount}</span>
        </div>

        <div aria-label="PDF 比例缩放" className="pdf-reader-toolbar-group" role="group">
          <Button
            aria-label="按比例缩小 PDF"
            appearance="subtle"
            disabled={zoom <= 70}
            icon={<ZoomOutRegular />}
            onClick={onZoomOut}
            size="small"
            title="按比例缩小 PDF（5%）"
          />
          <span aria-label={`PDF 显示比例 ${zoom}%`} className="pdf-zoom-value">{zoom}%</span>
          <Button
            aria-label="按比例放大 PDF"
            appearance="subtle"
            disabled={zoom >= 180}
            icon={<ZoomInRegular />}
            onClick={onZoomIn}
            size="small"
            title="按比例放大 PDF（5%）"
          />
        </div>

        <div className="pdf-reader-toolbar-spacer" />
        {parserStatus ? <div className="pdf-parser-status">{parserStatus}</div> : null}
        <Button
          aria-label="在 PDF 中添加 Markdown 文本框"
          appearance={textBoxToolActive ? "primary" : "subtle"}
          aria-pressed={textBoxToolActive}
          icon={<TextFieldRegular />}
          onClick={onToggleTextBoxTool}
          size="small"
          title={textBoxToolActive ? "文本框工具已启用；点击页面放置" : "添加 Markdown 文本框"}
        />
        <Button
          aria-label="打开 PDF 白板"
          appearance={whiteboardOpen ? "primary" : "subtle"}
          aria-pressed={whiteboardOpen}
          icon={<WhiteboardRegular />}
          onClick={onToggleWhiteboard}
          size="small"
          title={whiteboardOpen ? "收起 PDF 右侧白板" : "打开 PDF 右侧白板"}
        />
        <Button
          aria-label="显示页边批注"
          appearance={marginCommentsVisible ? "primary" : "subtle"}
          aria-pressed={marginCommentsVisible}
          icon={<CommentRegular />}
          onClick={onToggleMarginComments}
          size="small"
          title={marginCommentsVisible ? "隐藏高亮与划线的页边批注" : "显示高亮与划线的页边批注"}
        />
        <Button
          aria-label="显示批注关联线"
          appearance={marginCommentConnectorsVisible && marginCommentsVisible ? "primary" : "subtle"}
          aria-pressed={marginCommentConnectorsVisible}
          disabled={!marginCommentsVisible}
          icon={<CommentLinkRegular />}
          onClick={onToggleMarginCommentConnectors}
          size="small"
          title={marginCommentConnectorsVisible ? "隐藏原文与页边批注之间的关联线" : "显示原文与页边批注之间的关联线"}
        />
        <Button
          aria-label="在文档中搜索"
          appearance={searchOpen ? "primary" : "subtle"}
          icon={<SearchRegular />}
          onClick={onOpenSearch}
          size="small"
          title="在文档中搜索（Ctrl+F）"
        />
        <Popover positioning="below-end" withArrow>
          <PopoverTrigger disableButtonEnhancement>
            <Button
              aria-label="页面布局设置"
              appearance="subtle"
              icon={<SettingsRegular />}
              size="small"
              title="页面布局设置"
            />
          </PopoverTrigger>
          <PopoverSurface aria-label="页面布局设置面板" className="pdf-layout-popover">
            <strong>页面布局</strong>
            <div aria-label="页面布局选项" className="pdf-layout-options" role="group">
              <Button
                appearance={layoutMode === "continuous" ? "primary" : "subtle"}
                icon={<TextColumnOneRegular />}
                onClick={() => onChangeLayoutMode("continuous")}
                title="连续滚动显示全部页面"
              >
                连续
              </Button>
              <Button
                appearance={layoutMode === "single" ? "primary" : "subtle"}
                icon={<TextColumnOneRegular />}
                onClick={() => onChangeLayoutMode("single")}
                title="每次显示一页"
              >
                单页
              </Button>
              <Button
                appearance={layoutMode === "spread" ? "primary" : "subtle"}
                icon={<TextColumnTwoRegular />}
                onClick={() => onChangeLayoutMode("spread")}
                title="并排显示两页"
              >
                双页
              </Button>
            </div>
            <small>单页和双页模式可使用翻页按钮、Page Up 与 Page Down 切换页面。</small>
          </PopoverSurface>
        </Popover>
      </div>

      {searchOpen ? (
        <div aria-label="文档搜索栏" className="pdf-find-bar" role="search">
          <Input
            aria-label="搜索文档内容"
            autoFocus
            className="pdf-find-input"
            contentBefore={<SearchRegular />}
            onChange={(_, data) => onChangeSearchQuery(data.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="在文档中搜索"
            size="small"
            value={searchQuery}
          />
          <span aria-live="polite" className="pdf-find-result-count">
            {searchQuery.trim()
              ? searchResultCount > 0
                ? `${activeSearchIndex + 1} / ${searchResultCount}`
                : "未找到"
              : ""}
          </span>
          <Button
            aria-label="上一个搜索结果"
            appearance="subtle"
            disabled={searchResultCount === 0}
            icon={<ChevronLeftRegular />}
            onClick={onFindPrevious}
            size="small"
            title="上一个搜索结果（Shift+Enter）"
          />
          <Button
            aria-label="下一个搜索结果"
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
          <Button
            aria-label="关闭文档搜索"
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
