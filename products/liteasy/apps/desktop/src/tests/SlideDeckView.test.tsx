import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SlideDeckView } from "../app/features/generative-ui/SlideDeckView";

vi.mock("../app/features/mermaid/MermaidPreview", () => ({
  MermaidPreview: ({ code, title }: { code: string; title: string }) => <div aria-label={title}>{code}</div>
}));

describe("SlideDeckView", () => {
  test("mounts one Markdown slide at a time and loads speaker notes only when opened", async () => {
    render(<SlideDeckView title="论文汇报" slides={[
      { id: "one", title: "结论", markdown: "**核心观点** $x^2$\n\n![图](https://example.org/a.png)", notes: "第一张的**备注**" },
      { id: "two", title: "方法", markdown: "```mermaid\nflowchart LR\nA --> B\n```" }
    ]} />);
    const first = screen.getByRole("article", { name: "第 1 页幻灯片" });
    expect(within(first).getByText("核心观点").tagName).toBe("STRONG");
    expect(first.querySelector(".katex")).toBeInTheDocument();
    expect(within(first).getByRole("img", { name: "图" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Mermaid 图表")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("演讲备注")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示演讲备注" }));
    expect(within(screen.getByLabelText("演讲备注")).getByText("备注").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("button", { name: "下一页幻灯片" }));
    expect(screen.queryByRole("article", { name: "第 1 页幻灯片" })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Mermaid 图表")).toHaveTextContent("A --> B");
    expect(screen.getByRole("button", { name: "下一页幻灯片" })).toBeDisabled();
  });

  test("preserves bullets from saved decks and clamps page selection when a deck shrinks", () => {
    const view = render(<SlideDeckView title="PPT" slides={[{ title: "一", bullets: ["**重点**"] }, { title: "二", bullets: ["结论"] }]} />);
    expect(screen.getByText("重点").tagName).toBe("STRONG");
    fireEvent.change(screen.getByRole("combobox", { name: "选择幻灯片" }), { target: { value: "1" } });
    expect(screen.getByText("结论")).toBeInTheDocument();
    view.rerender(<SlideDeckView title="PPT" slides={[{ title: "一", bullets: ["仍然可见"] }]} />);
    expect(screen.getByText("仍然可见")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一页幻灯片" })).toBeDisabled();
  });
});
