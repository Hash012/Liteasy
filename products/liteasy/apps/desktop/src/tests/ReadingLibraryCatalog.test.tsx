import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ReadingLibraryCatalog } from "../app/features/library/ReadingLibraryCatalog";
import type { ReadingCatalogEntry } from "../app/features/library/readingCatalog.types";

const entries: ReadingCatalogEntry[] = [
  { id: "paper", title: "Attention Is All You Need", authors: ["Ashish Vaswani"], format: "pdf", year: 2017, doi: "10.5555/attention", publication: "NeurIPS", abstract: "A transformer architecture.", tags: ["经典"], collection: "深度学习", addedAt: "2026-01-03", physicalPath: "\\\\?\\D:\\Library\\paper.pdf", liteasyPath: "liteasy://workspace/paper/paper" },
  { id: "book", title: "自然语言处理", authors: ["张三"], format: "epub", year: 2024, tags: ["教材"], readingStatus: "reading", addedAt: "2026-01-02" },
  { id: "note", title: "Reading notes", format: "markdown", addedAt: "2026-01-01" }
];

function fileRows() {
  return within(screen.getByRole("table", { name: "文献与文件列表" })).getAllByRole("row").slice(1);
}

describe("ReadingLibraryCatalog", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  test("only mounts 50 rows but searches files outside the current page", async () => {
    const many = Array.from({ length: 4000 }, (_, n) => ({ id: String(n), title: `Paper ${n}`, format: "pdf" as const, doi: `10.1234/${n}` }));
    render(<ReadingLibraryCatalog entries={many} onOpen={vi.fn()} />);
    expect(fileRows()).toHaveLength(50);
    expect(screen.getByText("4000 / 4000 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页文件" }));
    expect(screen.getByText("第 2 / 80 页 · 每页 50 项")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索文献与文件" }), { target: { value: "10.1234/3999" } });
    await waitFor(() => expect(fileRows()).toHaveLength(1));
    expect(fileRows()[0]).toHaveTextContent("Paper 3999");
    expect(screen.getByText("第 1 / 1 页 · 每页 50 项")).toBeInTheDocument();
  });

  test("single click inspects metadata and double click opens the selected file", async () => {
    const onOpen = vi.fn();
    render(<ReadingLibraryCatalog entries={entries} onOpen={onOpen} renderLocation={() => <button>统一位置入口</button>} />);
    fireEvent.click(fileRows()[0]);
    const details = screen.getByRole("complementary", { name: "文件元信息" });
    expect(within(details).getByText("NeurIPS")).toBeInTheDocument();
    expect(within(details).getByText("A transformer architecture.")).toBeInTheDocument();
    expect(within(details).getByRole("textbox", { name: "实际位置" })).toHaveValue("D:\\Library\\paper.pdf");
    expect(within(details).getByRole("textbox", { name: "Liteasy Path" })).toHaveValue(entries[0].liteasyPath);
    expect(within(details).getByRole("button", { name: "统一位置入口" })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.doubleClick(fileRows()[0]);
    expect(onOpen).toHaveBeenCalledWith(entries[0]);
  });

  test("supports keyboard row navigation and Enter reading", () => {
    const onOpen = vi.fn();
    render(<ReadingLibraryCatalog entries={entries} onOpen={onOpen} />);
    fireEvent.keyDown(fileRows()[0], { key: "ArrowDown" });
    expect(fileRows()[1]).toHaveFocus();
    expect(fileRows()[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(fileRows()[1], { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(entries[1]);
    fireEvent.keyDown(fileRows()[1], { key: "End" });
    expect(fileRows()[2]).toHaveFocus();
    fireEvent.keyDown(fileRows()[2], { key: "Home" });
    expect(fileRows()[0]).toHaveFocus();
  });

  test("shows the EPUB publication identifier, language and publication date", () => {
    render(<ReadingLibraryCatalog entries={[{
      ...entries[1], identifier: "urn:isbn:9780141439518", language: "en-GB", publishedAt: "2002-12-31"
    }]} onOpen={vi.fn()} />);
    fireEvent.click(fileRows()[0]);
    const details = screen.getByRole("complementary", { name: "文件元信息" });
    expect(within(details).getByRole("textbox", { name: "出版标识" })).toHaveValue("urn:isbn:9780141439518");
    expect(within(details).getByText("en-GB")).toBeInTheDocument();
    expect(within(details).getByText("2002-12-31")).toBeInTheDocument();
  });

  test("combines filters and clears a selected detail when it leaves the result set", () => {
    render(<ReadingLibraryCatalog entries={entries} onOpen={vi.fn()} />);
    fireEvent.click(fileRows()[0]);
    fireEvent.change(screen.getByRole("combobox", { name: "筛选文件格式" }), { target: { value: "epub" } });
    fireEvent.change(screen.getByRole("combobox", { name: "筛选阅读状态" }), { target: { value: "reading" } });
    expect(fileRows()).toHaveLength(1);
    expect(fileRows()[0]).toHaveTextContent("自然语言处理");
    expect(within(screen.getByRole("complementary", { name: "文件元信息" })).getByText("查看元信息")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(fileRows()).toHaveLength(3);
  });

  test("saves deduplicated tags, category and reading state through the persistence callback", async () => {
    const onMetadataChange = vi.fn(async () => undefined);
    render(<ReadingLibraryCatalog entries={entries} onOpen={vi.fn()} onMetadataChange={onMetadataChange} />);
    fireEvent.click(fileRows()[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "文件分类" }), { target: { value: "  实验室阅读  " } });
    fireEvent.change(screen.getByRole("textbox", { name: "文件标签" }), { target: { value: "经典, 注意力，经典；待读" } });
    fireEvent.change(screen.getByRole("combobox", { name: "文件阅读状态" }), { target: { value: "finished" } });
    fireEvent.click(screen.getByRole("button", { name: "保存整理信息" }));
    await waitFor(() => expect(onMetadataChange).toHaveBeenCalledWith("paper", { collection: "实验室阅读", tags: ["经典", "注意力", "待读"], readingStatus: "finished" }));
    expect(await screen.findByText("已保存分类、标签和阅读状态。")).toBeInTheDocument();
  });

  test("preserves drafts and reports persistence failure instead of claiming success", async () => {
    render(<ReadingLibraryCatalog entries={entries} onOpen={vi.fn()} onMetadataChange={vi.fn(async () => { throw new Error("磁盘写入失败"); })} />);
    fireEvent.click(fileRows()[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "文件分类" }), { target: { value: "待整理" } });
    fireEvent.click(screen.getByRole("button", { name: "保存整理信息" }));
    expect(await screen.findByText("磁盘写入失败")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "文件分类" })).toHaveValue("待整理");
    expect(screen.getByRole("button", { name: "保存整理信息" })).toBeEnabled();
  });

  test("keeps unavailable metadata inspectable while disabling reading", () => {
    const onOpen = vi.fn();
    render(<ReadingLibraryCatalog entries={[{ ...entries[0], available: false }]} onOpen={onOpen} />);
    fireEvent.click(fileRows()[0]);
    expect(screen.getByRole("button", { name: "开始阅读" })).toBeDisabled();
    fireEvent.doubleClick(fileRows()[0]);
    fireEvent.keyDown(fileRows()[0], { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "DOI" })).toHaveValue("10.5555/attention");
  });

  test("only exposes export and removal for entries whose storage supports them", () => {
    render(<ReadingLibraryCatalog entries={[{ ...entries[0], canExport: false, canRemove: false }, entries[1]]} onOpen={vi.fn()} onExport={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(fileRows()[0]);
    expect(screen.queryByRole("button", { name: "导出原文件" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移出阅读库" })).not.toBeInTheDocument();
    fireEvent.click(fileRows()[1]);
    expect(screen.getByRole("button", { name: "导出原文件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移出阅读库" })).toBeInTheDocument();
  });

  test("copies a citation and a Liteasy Path and exposes import/export/context callbacks", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const onImport = vi.fn();
    const onExport = vi.fn();
    const onAddToContext = vi.fn();
    render(<ReadingLibraryCatalog entries={entries} onOpen={vi.fn()} onImport={onImport} onExport={onExport} onAddToContext={onAddToContext} />);
    fireEvent.click(screen.getByRole("button", { name: "导入文件" }));
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    fireEvent.click(fileRows()[0]);
    fireEvent.click(screen.getByRole("button", { name: "复制引用" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("Ashish Vaswani. (2017). Attention Is All You Need")));
    fireEvent.click(screen.getByRole("button", { name: "复制Liteasy Path" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(entries[0].liteasyPath));
    fireEvent.click(screen.getByRole("button", { name: "导出原文件" }));
    await waitFor(() => expect(onExport).toHaveBeenCalledWith(entries[0]));
    await waitFor(() => expect(screen.getByRole("button", { name: "添加到 Agent 上下文" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "添加到 Agent 上下文" }));
    await waitFor(() => expect(onAddToContext).toHaveBeenCalledWith(entries[0]));
  });
});
