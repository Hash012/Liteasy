import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { PdfReaderToolbar } from "../app/features/pdf/PdfReaderToolbar";

function props(overrides: Partial<ComponentProps<typeof PdfReaderToolbar>> = {}): ComponentProps<typeof PdfReaderToolbar> {
  return {
    activeSearchIndex: 0, currentPage: 1, layoutMode: "continuous", matchCase: false,
    marginCommentsVisible: false, marginCommentConnectorsVisible: false, whiteboardOpen: false,
    onChangeLayoutMode: vi.fn(), onChangeMatchCase: vi.fn(), onChangePage: vi.fn(), onChangeSearchQuery: vi.fn(),
    onChangeWholeWords: vi.fn(), onCloseSearch: vi.fn(), onFindNext: vi.fn(), onFindPrevious: vi.fn(),
    onNavigateNext: vi.fn(), onNavigatePrevious: vi.fn(), onOpenSearch: vi.fn(), onToggleMarginComments: vi.fn(),
    onToggleMarginCommentConnectors: vi.fn(), onToggleTextBoxTool: vi.fn(), onToggleWhiteboard: vi.fn(),
    onZoomIn: vi.fn(), onZoomOut: vi.fn(), pageCount: 10, searchOpen: true, searchQuery: "研究", searchResultCount: 3,
    textBoxToolActive: false, wholeWords: false, zoom: 100, ...overrides,
  };
}
afterEach(() => vi.restoreAllMocks());

test("IME Enter and Escape do not navigate or close document find", () => {
  const input = props();
  render(<PdfReaderToolbar {...input} />);
  const search = screen.getByRole("textbox", { name: "搜索文档内容" });
  fireEvent.keyDown(search, { key: "Enter", isComposing: true });
  fireEvent.keyDown(search, { key: "Escape", isComposing: true });
  fireEvent.keyDown(search, { key: "Enter", keyCode: 229 });
  expect(input.onFindNext).not.toHaveBeenCalled();
  expect(input.onCloseSearch).not.toHaveBeenCalled();
  fireEvent.keyDown(search, { key: "Enter" });
  fireEvent.keyDown(search, { key: "Enter", shiftKey: true });
  expect(input.onFindNext).toHaveBeenCalledOnce();
  expect(input.onFindPrevious).toHaveBeenCalledOnce();
});

test("IME Enter does not commit page navigation", () => {
  const input = props();
  render(<PdfReaderToolbar {...input} />);
  const page = screen.getByRole("spinbutton", { name: "当前页码" });
  fireEvent.change(page, { target: { value: "5" } });
  fireEvent.keyDown(page, { key: "Enter", isComposing: true });
  expect(input.onChangePage).not.toHaveBeenCalled();
  fireEvent.keyDown(page, { key: "Enter" });
  expect(input.onChangePage).toHaveBeenCalledWith(5);
});

test("closing find restores focus to its triggering button", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return <PdfReaderToolbar {...props({ searchOpen: open, onOpenSearch: () => setOpen(true), onCloseSearch: () => setOpen(false) })} />;
  }
  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "在文档中搜索" });
  trigger.focus();
  fireEvent.click(trigger);
  const search = screen.getByRole("textbox", { name: "搜索文档内容" });
  expect(search).toHaveFocus();
  fireEvent.keyDown(search, { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "搜索文档内容" })).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test("Mac find tooltip uses the same platform modifier as workbench commands", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  render(<PdfReaderToolbar {...props()} />);
  expect(screen.getByRole("button", { name: "在文档中搜索" })).toHaveAttribute("title", "在文档中搜索（⌘+F）");
});
