import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { createSeededSettingsStore } from "../app/features/settings/settingsStateHelpers";
import { AssistantSidebar } from "../app/layout/AssistantSidebar";
import { useAssistantAgentController } from "../app/controllers/agent/useAssistantAgentController";

const modelTransport = async ({ body }: { body?: string }) => ({
  json: async () => ({
    answer: String(body).includes("总结这篇论文的检索方法")
      ? "云端回答：总结这篇论文的检索方法"
      : "云端模型测试响应",
    execution: { backend: "dev_cloud", mode: "live", provider: "openai" }
  }),
  ok: true,
  status: 200
});

test("product AssistantSidebar executes chat commands through the injected public Agent client", async () => {
  const user = userEvent.setup();
  const applyTheme = vi.fn(() => "已应用卡通风格。");
  const settingsStore = createSeededSettingsStore();

  function ProductAssistant() {
    const agent = useAssistantAgentController({
      importedChunksByPaperId: {
        "paper-1": [
          {
            page: 1,
            paperId: "paper-1",
            paperTitle: "Paper One",
            snippet: "The paper evaluates a late-interaction retrieval method.",
            summary: "late interaction",
            tags: ["retrieval"]
          }
        ]
      },
      importedSelectedCount: 1,
      modelTransport,
      onApplyThemePreset: applyTheme,
      onGenerateArtifact: () => "unused",
      profileUnlocked: false,
      selectedPaperCount: 1,
      selectedPapers: [{ id: "paper-1", title: "Paper One" }],
      selectionLocked: true,
      settingsStore
    });

    return (
      <AssistantSidebar
        agentClient={agent.agentClient}
        executionJournal={agent.executionJournal}
        importedSelectedCount={1}
        modelTransport={modelTransport}
        onApplyThemePreset={applyTheme}
        onGenerateArtifact={() => "unused"}
        selectedPaperCount={1}
        selectedPapers={[{ id: "paper-1", title: "Paper One" }]}
        selectionLocked
        settingsStore={settingsStore}
      />
    );
  }

  render(<ProductAssistant />);

  await user.type(
    screen.getByPlaceholderText("输入你的问题或命令"),
    "/让 UI 变成卡通风格"
  );
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => expect(applyTheme).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("计划：应用卡通风格")).toBeInTheDocument();
  expect(await screen.findByLabelText("动态界面：已应用卡通风格。")).toBeInTheDocument();

  await user.type(
    screen.getByPlaceholderText("输入你的问题或命令"),
    "总结这篇论文的检索方法"
  );
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => expect(screen.getByText(/云端回答：总结这篇论文的检索方法/)).toBeInTheDocument());
  expect(screen.getByText("原文定位")).toBeInTheDocument();
  expect(screen.getByText("模型审计")).toBeInTheDocument();
  expect(screen.getByText(/模型链路：/)).toBeInTheDocument();
});
