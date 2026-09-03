import { render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

vi.mock("../app/features/mermaid/MermaidPreview", () => ({
  MermaidPreview: ({ code, title }: { code: string; title: string }) => (
    <div aria-label={title}>{code}</div>
  )
}));

import { AssistantMarkdown } from "../app/features/assistant/AssistantMarkdown";

describe("AssistantMarkdown", () => {
  test("renders GFM, math, code, Mermaid and accessible web images", () => {
    render(
      <AssistantMarkdown value={`# 结果

| 项目 | 值 |
| --- | --- |
| 准确率 | 95% |

行内公式 $E = mc^2$。

\`\`\`ts
const answer = 42;
\`\`\`

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

![实验曲线](https://example.com/chart.png "实验结果")`} />
    );

    expect(screen.getByRole("heading", { name: "结果" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("95%")).toBeInTheDocument();
    expect(document.querySelector(".katex")).toBeInTheDocument();
    expect(screen.getByText("const answer = 42;")).toBeInTheDocument();
    expect(screen.getByLabelText("Mermaid 图表")).toHaveTextContent("A --> B");
    expect(screen.getByRole("img", { name: "实验曲线" })).toHaveAttribute(
      "src",
      "https://example.com/chart.png"
    );
  });

  test("does not embed unsafe image or link protocols", () => {
    render(<AssistantMarkdown value="[危险链接](javascript:alert(1)) ![危险图片](file:///tmp/a.png)" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("图片地址不可访问")).toBeInTheDocument();
  });

  test("renders dollar, parenthesis and bracket LaTeX delimiters while preserving code", () => {
    render(<AssistantMarkdown value={`$a+b$\n\n$$c=d$$\n\n\\(e=f\\)\n\n\\[g=h\\]\n\n\`\\(not math\\)\``} />);

    expect(document.querySelectorAll(".katex")).toHaveLength(4);
    expect(screen.getByText("\\(not math\\)")).toBeInTheDocument();
  });
});
