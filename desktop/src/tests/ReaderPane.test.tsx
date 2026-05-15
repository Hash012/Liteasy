import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ReaderPane } from "../app/layout/ReaderPane";

describe("ReaderPane", () => {
  test("renders the reader header and forwards artifact start actions", async () => {
    const user = userEvent.setup();
    const onStartAnalysis = vi.fn();

    render(
      <ReaderPane
        analysisHint="可以启动中栏分析。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={onStartAnalysis}
        selectedPaperIds={["paper-1"]}
        selectionLocked={true}
      />
    );

    expect(screen.getByText("Reader", { selector: ".pane-header" })).toBeInTheDocument();
    expect(screen.getByText("选中文献集：1 篇 · 已锁定")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "思维导图" }));

    expect(onStartAnalysis).toHaveBeenCalledWith("mindmap");
  });

  test("disables artifact actions until selected papers are locked", () => {
    render(
      <ReaderPane
        analysisHint="请先锁定。"
        artifactTabs={[]}
        artifactTasks={[]}
        onStartAnalysis={vi.fn()}
        selectedPaperIds={["paper-1"]}
        selectionLocked={false}
      />
    );

    expect(screen.getByRole("button", { name: "树形展开" })).toBeDisabled();
  });
});
