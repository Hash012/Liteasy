import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const diagramRender = vi.hoisted(() => vi.fn());
vi.mock("../app/features/mermaid/MermaidPreview", () => ({
  MermaidPreview: ({ code, title }: { code: string; title: string }) => {
    diagramRender(code);
    if (code === "broken-renderer") throw new Error("Diagram rendering failed");
    return <div aria-label={title}>{code}</div>;
  }
}));

import { MarkdownContent, normalizeMarkdownMathDelimiters } from "../app/features/markdown/MarkdownContent";
import { MineruMarkdown } from "../app/features/import/MineruMarkdown";
import { PdfAnnotationMarkdown } from "../app/features/pdf/PdfAnnotationMarkdown";

describe("shared MarkdownContent", () => {
  test("defers diagrams until streaming completes and keeps completed diagrams mounted during prose updates", async () => {
    diagramRender.mockClear();
    const value = "```mermaid\nflowchart LR\nA --> B\n```";
    const view = render(<MarkdownContent streaming value={value} />);
    expect(screen.getByText("图表生成完成后显示预览。")).toBeInTheDocument();
    expect(diagramRender).not.toHaveBeenCalled();
    view.rerender(<MarkdownContent streaming value={value + "\n\n正在解释"} />);
    expect(diagramRender).not.toHaveBeenCalled();
    view.rerender(<MarkdownContent value={value} />);
    expect(await screen.findByLabelText("Mermaid 图表")).toHaveTextContent("A --> B");
    expect(diagramRender).toHaveBeenCalledTimes(1);
    view.rerender(<MarkdownContent value={value + "\n\n补充说明"} />);
    expect(diagramRender).toHaveBeenCalledTimes(1);
  });

  test("preserves overlarge diagrams as text without loading the renderer", () => {
    diagramRender.mockClear();
    render(<MarkdownContent value={"```mermaid\nflowchart LR\n" + "A --> B\n".repeat(301) + "```"} />);
    expect(screen.getByText("图表内容较多，已保留文本视图。")).toBeInTheDocument();
    expect(diagramRender).not.toHaveBeenCalled();
  });

  test("isolates a diagram rendering failure and retains the surrounding document", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      render(<MarkdownContent value={"正常正文\n\n```mermaid\nbroken-renderer\n```\n\n后续正文"} />);
      expect(await screen.findByText("图表暂时无法显示，已保留文本内容。")).toBeInTheDocument();
      expect(screen.getByText("正常正文")).toBeInTheDocument();
      expect(screen.getByText("后续正文")).toBeInTheDocument();
      expect(screen.getByText("broken-renderer").tagName).toBe("CODE");
    } finally {
      log.mockRestore();
    }
  });

  test("normalizes common math without rewriting incomplete or longer code fences", () => {
    const code = "````text\n\\(literal\\)\n```\n\\[still literal\\]\n";
    expect(normalizeMarkdownMathDelimiters("\\(x\\)\n\n" + code)).toBe("$x$\n\n" + code);
    const closed = code + "````\n\n\\(y\\)";
    expect(normalizeMarkdownMathDelimiters(closed)).toBe(code + "````\n\n$y$");
  });

  test("keeps executable links blocked even when a domain resolver returns their source", () => {
    const { container } = render(<MarkdownContent value={'[危险](javascript:alert) ![危险图](data:text/html;base64,PGgxPkhlbGxvPC9oMT4=)\n\n<script>alert(1)</script>'} urlTransform={(url) => url} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });

  test("keeps OCR HTML tables and resolved images while sanitizing HTML and annotation attachments", () => {
    const image = "data:image/png;base64,aGVsbG8=";
    const { container } = render(<MineruMarkdown content={'<table><tr><td rowspan="2">单元格</td></tr></table><img src="fig.png" alt="论文图" onerror="alert(1)"><script>alert(1)</script>\n\n\\(E=mc^2\\)'} figures={[{ sourcePath: "fig.png", dataUrl: image, alt: "论文图", id: "figure", page: 1 }]} />);
    expect(screen.getByRole("cell")).toHaveAttribute("rowspan", "2");
    expect(screen.getByRole("img", { name: "论文图" })).toHaveAttribute("src", image);
    expect(screen.getByRole("img")).not.toHaveAttribute("onerror");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".katex")).toBeInTheDocument();
    render(<PdfAnnotationMarkdown value="![恶意附件](attachment:bad)" images={{ bad: "javascript:alert(1)" }} />);
    expect(screen.queryByRole("img", { name: "恶意附件" })).not.toBeInTheDocument();
  });

  test("uses readable source markers in narrative prose while preserving code samples", () => {
    render(<MarkdownContent value={"结论 evidence-private-42。\n\n`evidence-private-42`"} />);
    expect(screen.getByText(/结论/)).toHaveTextContent("来源待关联");
    expect(screen.getByText("evidence-private-42").tagName).toBe("CODE");
  });
});
