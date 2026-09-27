import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ReadingDocumentReader } from "../app/features/reading-library/ReadingDocumentReader";
import type { ParsedReadingDocument } from "../app/features/reading-library/readingDocument.types";

vi.mock("../app/features/mermaid/MermaidPreview", () => ({ MermaidPreview: ({ code }: { code: string }) => <div aria-label="图表">{code}</div> }));

const book: ParsedReadingDocument = {
  title: "研究手册", authors: ["张研究"], format: "markdown", resources: [], warnings: [],
  chapters: [
    { id: "one", title: "基础", format: "markdown", content: "# 基础\n\n第一节介绍 $x^2$。", plainText: "第一节介绍基础。" },
    { id: "two", title: "发现", format: "markdown", content: "# 发现\n\n第二节包含新发现。\n\n```mermaid\nflowchart LR\nA --> B\n```", plainText: "第二节包含新发现。" }
  ],
  toc: [{ id: "toc-one", label: "基础", chapterId: "one", depth: 0 }, { id: "toc-two", label: "发现", chapterId: "two", depth: 0 }]
};
const reader = (documentId = "book-a", storageScope = "account-a", document = book) => <FluentProvider theme={webLightTheme}><ReadingDocumentReader document={document} documentId={documentId} storageScope={storageScope} /></FluentProvider>;

describe("ReadingDocumentReader", () => {
  beforeEach(() => localStorage.clear());

  test("renders only the active chapter with math, follows contents and renders diagrams", async () => {
    const { container } = render(reader());
    expect(screen.getByText(/第一节介绍/)).toBeInTheDocument();
    expect(container.querySelector(".katex")).toBeInTheDocument();
    expect(screen.queryByText(/第二节包含/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发现" }));
    expect(screen.queryByText(/第一节介绍/)).not.toBeInTheDocument();
    expect(screen.getByText(/第二节包含/)).toBeInTheDocument();
    expect(await screen.findByLabelText("图表")).toHaveTextContent("A --> B");
  });

  test("searches the whole book, jumps to results, and supports chapter search", async () => {
    render(reader());
    fireEvent.click(screen.getByRole("button", { name: "搜索正文" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索书内文字" }), { target: { value: "新发现" } });
    expect(await screen.findByText("1 处匹配")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "搜索范围" }), { target: { value: "chapter" } });
    expect(screen.getByText("没有找到匹配的文字")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "搜索范围" }), { target: { value: "book" } });
    fireEvent.click(screen.getByRole("button", { name: /发现 第二节包含新发现/ }));
    expect(screen.getByRole("heading", { name: "发现" })).toBeInTheDocument();
  });

  test("persists appearance and per-book progress, isolated by account", async () => {
    const view = render(reader());
    fireEvent.click(screen.getByRole("button", { name: "阅读外观" }));
    fireEvent.change(screen.getByRole("combobox", { name: "阅读主题" }), { target: { value: "night" } });
    fireEvent.change(screen.getByRole("slider", { name: "阅读字号" }), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "发现" }));
    const scroll = screen.getByLabelText("文档阅读区域");
    Object.defineProperties(scroll, { scrollHeight: { value: 1200 }, clientHeight: { value: 400 } });
    fireEvent.scroll(scroll, { target: { scrollTop: 400 } });
    view.unmount();
    expect(JSON.parse(localStorage.getItem("liteasy.reading.position.v1:account-a:book-a")!)).toEqual({ chapterId: "two", ratio: 0.5 });
    const reopened = render(reader());
    expect(screen.getByRole("heading", { name: "发现" })).toBeInTheDocument();
    expect(reopened.container.querySelector(".reading-document")).toHaveAttribute("data-reading-theme", "night");
    expect(reopened.container.querySelector(".reading-document")).toHaveStyle({ "--reading-font-size": "25px" });
    reopened.rerender(reader("book-a", "account-b"));
    expect(screen.getByRole("heading", { name: "基础" })).toBeInTheDocument();
    expect(reopened.container.querySelector(".reading-document")).toHaveAttribute("data-reading-theme", "auto");
  });

  test("creates image URLs only for the mounted chapter and revokes them on switching/unmounting", async () => {
    const create = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    const revoke = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    try {
      const epub: ParsedReadingDocument = { ...book, format: "epub", resources: [{ path: "one.png", mimeType: "image/png", bytes: new Uint8Array([1]) }, { path: "two.png", mimeType: "image/png", bytes: new Uint8Array([2]) }], chapters: book.chapters.map((chapter, index) => ({ ...chapter, format: "html", content: `<p>${chapter.title}</p>${`<img data-reading-image="${index ? "two" : "one"}.png" alt="章节插图" />`.repeat(index ? 1 : 2)}` })) };
      const view = render(reader("epub", "account-a", epub));
      await waitFor(() => expect(screen.getAllByRole("img", { name: "章节插图" })[0]).toHaveAttribute("src", "blob:first"));
      expect(create).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "发现" }));
      await waitFor(() => expect(screen.getByRole("img", { name: "章节插图" })).toHaveAttribute("src", "blob:second"));
      expect(revoke).toHaveBeenCalledWith("blob:first");
      view.unmount();
      expect(revoke).toHaveBeenCalledWith("blob:second");
    } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
  });

  test("focus mode hides the navigation with an accessible return control", () => {
    render(reader());
    fireEvent.click(screen.getByRole("button", { name: "专注阅读" }));
    expect(screen.queryByRole("navigation", { name: "章节目录" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "退出专注阅读" }));
    expect(screen.getByRole("navigation", { name: "章节目录" })).toBeInTheDocument();
  });
});
