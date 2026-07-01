import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";
import { AssistantSidebar } from "../app/layout/AssistantSidebar";

describe("AssistantSidebar", () => {
  test("renders a conventional chat panel with compact controls", () => {
    render(
      <AssistantSidebar
        importedChunksByPaperId={{}}
        importedSelectedCount={0}
        onGenerateArtifact={vi.fn(() => "已创建分析任务。")}
        selectedPaperCount={0}
        selectedPapers={[]}
        selectionLocked={false}
        settingsStore={createSeededSettingsStore()}
      />
    );

    expect(screen.getByLabelText("右栏AI助手")).toBeInTheDocument();
    expect(screen.getByText("Liteasy Chat", { selector: ".pane-header" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建" })).toHaveAttribute("title", "开始一个新的 AI 对话");
    expect(screen.getByRole("button", { name: "历史" })).toHaveAttribute("title", "查看历史会话");
    expect(screen.getByLabelText("AI助手初始模式入口")).toBeInTheDocument();
  });
});
