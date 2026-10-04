import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";
import { AssistantSidebar } from "../app/layout/AssistantSidebar";

describe("AssistantSidebar", () => {
  test("filters the context picker with library tags forwarded by the sidebar", async () => {
    const user = userEvent.setup();
    render(<AssistantSidebar importedSelectedCount={0} onGenerateArtifact={vi.fn(() => "ok")}
      selectedPaperCount={0} selectedPapers={[]} selectionLocked={false} settingsStore={createSeededSettingsStore()}
      availablePapers={[{ id: "memory", title: "Memory research", sourcePath: "/library/memory.pdf" }, { id: "translation", title: "Memory translation", sourcePath: "/library/translation.pdf" }]}
      searchEntries={[{ id: "memory", title: "Memory research", format: "pdf", tags: ["精读"] }, { id: "translation", title: "Memory translation", format: "pdf", tags: ["翻译"] }]} />);
    await user.click(screen.getByRole("button", { name: "添加上下文" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索全部上下文资产" }), { target: { value: '/memory/i tag:精读 -tag:翻译 format:pdf' } });
    expect(screen.getByRole("button", { name: "预览 Memory research" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "预览 Memory translation" })).not.toBeInTheDocument();
  });
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
    expect(screen.queryByText("AI 对话", { selector: ".pane-header" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "对话顶栏" })).toBeInTheDocument();
    expect(screen.getByLabelText("当前会话")).toHaveTextContent("新对话");
    expect(screen.queryByText("普通对话")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建" })).toHaveAttribute("title", "开始一个新的 AI 对话");
    expect(screen.getByRole("button", { name: "历史" })).toHaveAttribute("title", "查看历史会话");
    expect(screen.getByLabelText("AI助手初始消息区")).toBeInTheDocument();
  });
});
