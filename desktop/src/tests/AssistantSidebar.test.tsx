import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";
import { AssistantSidebar } from "../app/layout/AssistantSidebar";

describe("AssistantSidebar", () => {
  test("renders the minimal AI assistant right pane", () => {
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
    expect(screen.getByText("AI Assistant", { selector: ".pane-header" })).toBeInTheDocument();
    expect(screen.getByLabelText("AI助手初始模式入口")).toBeInTheDocument();
  });
});
