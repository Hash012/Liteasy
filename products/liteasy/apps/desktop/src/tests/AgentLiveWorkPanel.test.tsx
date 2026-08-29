import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AgentLiveWorkPanel } from "../app/features/agent-work/AgentLiveWorkPanel";
import { toUserVisibleAgentWorkMarkdown } from "../app/features/agent-runtime/agentWorkPresentation";

describe("AgentLiveWorkPanel", () => {
  test("renders public work output as Markdown and redacts internal references", () => {
    render(
      <AgentLiveWorkPanel
        markdown={"### 当前进展\n\n- 已定位 evidence-private-42\n- 正在整理 **关键机制**"}
        message="正在生成"
        progress={42}
        runKey="internal-run"
      />
    );

    expect(screen.getByRole("heading", { name: "当前进展" })).toBeInTheDocument();
    expect(screen.getByText("关键机制")).toHaveStyle({ fontWeight: "bold" });
    expect(screen.getByLabelText("实时生成内容")).toHaveTextContent("〔内部引用〕");
    expect(screen.getByLabelText("实时生成内容")).not.toHaveTextContent("evidence-private-42");

    fireEvent.click(screen.getByRole("button", { name: "收起实时生成内容" }));
    expect(screen.queryByLabelText("实时生成内容")).not.toBeInTheDocument();
  });

  test("hides raw structured payloads instead of exposing protocol fields", () => {
    expect(toUserVisibleAgentWorkMarkdown('{"runId":"run-secret","evidenceId":"evidence-secret"}')).toBe("");
  });

  test("keeps a compact preview available while the live panel is collapsed", () => {
    render(
      <AgentLiveWorkPanel
        markdown={"首段\n第二段\n第三段\n第四段\n第五段\n尾段"}
        message="正在生成"
        runKey="preview-run"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "收起实时生成内容" }));

    expect(screen.getByLabelText("实时生成内容摘要")).toHaveTextContent("首段");
    expect(screen.getByLabelText("实时生成内容摘要")).toHaveTextContent("尾段");
    expect(screen.getByLabelText("实时生成内容摘要")).toHaveTextContent("展开查看全部");
  });
});
