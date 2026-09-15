import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ThinReadingMarkdown } from "../app/features/thin-reading/ThinReadingMarkdown";
import type { ThinReadingSummarySentence } from "../app/features/thin-reading/thinReading.types";

vi.mock("../app/features/mermaid/MermaidPreview", () => ({
  MermaidPreview: ({ code, title }: { code: string; title: string }) => <div aria-label={title}>{code}</div>
}));

function sentence(text: string, id = "sentence-one"): ThinReadingSummarySentence {
  return { evidenceIds: [`evidence-${id}`], externalKnowledge: [], id, status: "grounded", text };
}

function renderMarkdown(summary: string, sentences = [sentence(summary)]) {
  const onDeepen = vi.fn();
  const props = {
    anchors: [], generating: false, locale: "zh" as const, marksVisible: false,
    onDeepen, onSelectAnchor: vi.fn(),
    renderReferences: (entry: ThinReadingSummarySentence) => <sup aria-label={`来源 ${entry.id}`}>[1]</sup>,
    sentences, summary
  };
  return { ...render(<ThinReadingMarkdown {...props} />), onDeepen, props };
}

describe("ThinReadingMarkdown", () => {
  test("renders full Markdown structure, math, code, diagrams and footnotes without flattening paragraphs", async () => {
    const summary = `## 方法

使用 **注意力** 和 ~~循环~~。

- [x] 阅读
- [ ] 实验

| 参数 | 值 |
| --- | --- |
| 维度 | 64 |

行内 $E = mc^2$，另一种写法 \\(a=b\\)。

\\[y=Ax\\]

\`\`\`ts
const result = 42;
\`\`\`

\`\`\`mermaid
flowchart LR
 A --> B
\`\`\`

补充说明[^note]。

[^note]: 这是脚注。`;
    const { container } = renderMarkdown(summary);
    expect(screen.getByRole("heading", { name: "方法" })).toBeVisible();
    expect(container.querySelector("strong")).toHaveTextContent("注意力");
    expect(container.querySelector("del")).toHaveTextContent("循环");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(within(screen.getByRole("table")).getByText("64")).toBeVisible();
    expect(container.querySelectorAll(".katex")).toHaveLength(3);
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
    expect(screen.getByText("const result = 42;")).toBeVisible();
    expect(await screen.findByLabelText("Mermaid 图表")).toHaveTextContent("A --> B");
    expect(container.querySelector("[data-footnotes]")).toHaveTextContent("这是脚注。");
    expect(screen.getAllByLabelText("来源 sentence-one")).toHaveLength(1);
  });

  test("uses each term's own sentence sources and preserves code examples and existing links", () => {
    const first = sentence("**第一句**使用 [[[自注意力]]]。", "first");
    const second = { ...sentence("第二句解释 [[[梯度下降]]]。", "second"), externalKnowledge: ["source-external"] };
    const code = sentence("`[[[行内代码]]]`\n\n```text\n[[[代码块]]]\n```\n\n[普通链接](https://example.org)", "code");
    const { onDeepen, rerender, props } = renderMarkdown([first.text, second.text, code.text].join("\n\n"), [first, second, code]);
    fireEvent.click(screen.getByRole("button", { name: "深入阅读“梯度下降”" }));
    expect(onDeepen).toHaveBeenCalledWith("梯度下降", second);
    expect(onDeepen).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("[[[行内代码]]]")).toBeVisible();
    expect(screen.getByText("[[[代码块]]]")).toBeVisible();
    expect(screen.getByRole("link", { name: "普通链接" })).toHaveAttribute("href", "https://example.org");
    expect(screen.getAllByLabelText(/^来源 /)).toHaveLength(3);
    rerender(<ThinReadingMarkdown {...props} generating />);
    expect(screen.getByRole("button", { name: "深入阅读“自注意力”" })).toBeDisabled();
  });

  test("keeps a Markdown table complete when evidence sentences cover separate rows", () => {
    const first = sentence("| 参数 | 值 |\n| --- | --- |\n| 维度 | 64 |", "first");
    const second = sentence("| 层数 | 6 |", "second");
    renderMarkdown(`${first.text}\n${second.text}`, [first, second]);
    const table = screen.getByRole("table");
    expect(within(table).getByText("64")).toBeInTheDocument();
    expect(within(table).getByText("6")).toBeInTheDocument();
    expect(within(table).getAllByLabelText(/^来源 /)).toHaveLength(2);
  });

  test("places each sentence's evidence marker before the next sentence in one paragraph", () => {
    const first = sentence("第一句。", "first");
    const second = sentence("第二句。", "second");
    const { container } = renderMarkdown(first.text + second.text, [first, second]);
    expect(container.querySelector("p")).toHaveTextContent("第一句。[1]第二句。[1]");
  });

  test("keeps repeated legacy association anchors at their exact source occurrence", () => {
    const summary = "attention 和 **attention**。";
    const entry = sentence(summary);
    const { props, rerender } = renderMarkdown(summary);
    const start = summary.lastIndexOf("attention");
    const onSelectAnchor = vi.fn();
    rerender(<ThinReadingMarkdown {...props} anchors={[{
      end: start + "attention".length, evidenceIds: entry.evidenceIds, externalSourceIds: [],
      id: "anchor-2", importance: 1, kind: "concept", searchQuery: "attention",
      start, summarySentenceId: entry.id, text: "attention"
    }]} marksVisible onSelectAnchor={onSelectAnchor} />);
    const mark = screen.getByRole("button", { name: "查看“attention”关联论文" });
    expect(mark.parentElement?.tagName).toBe("STRONG");
    fireEvent.keyDown(mark, { key: "Enter" });
    expect(onSelectAnchor).toHaveBeenCalledWith("anchor-2");
  });
});
