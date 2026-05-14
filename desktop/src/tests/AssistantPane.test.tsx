import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import { createSettingsStore } from "../app/features/settings/settings.store";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("requires imported selected document set before qa mode can answer", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      selectedSetStatus={{
        importedCount: 0,
        selectedCount: 1,
        selectionLocked: true
      }}
    />
  );

  await user.click(screen.getByRole("button", { name: "问答" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文讲了什么？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("这篇论文讲了什么？")).toBeInTheDocument();
  expect(screen.getByText(/请先将当前选中文献集导入 AI 流程/)).toBeInTheDocument();
});

test("adds grounded user and assistant messages in qa mode when selected set is ready", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 1,
        selectionLocked: true
      }}
    />
  );

  await user.click(screen.getByRole("button", { name: "问答" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "总结这篇论文的核心方法");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("总结这篇论文的核心方法")).toBeInTheDocument();
  expect(screen.getByText(/云端回答：总结这篇论文的核心方法/)).toBeInTheDocument();
  expect(screen.getByText(/demo-1 p\.3/)).toBeInTheDocument();
  expect(screen.getByText("审计模型 gpt-5-mini-auditor")).toBeInTheDocument();
  expect(screen.getByText("审计评分 0.84 · 通过")).toBeInTheDocument();
});

test("records command execution feedback in message history", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 1,
        selectionLocked: true
      }}
    />
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "关闭联网推荐");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("关闭联网推荐")).toBeInTheDocument();
  expect(screen.getByText(/已更新 联网推荐：false/)).toBeInTheDocument();
});

test("uses the user question to retrieve a different cited chunk", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      selectedPapers={[
        {
          id: "demo-2",
          title: "BERT: Pre-training of Deep Bidirectional Transformers"
        }
      ]}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 1,
        selectionLocked: true
      }}
    />
  );

  await user.click(screen.getByRole("button", { name: "问答" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文的预训练目标是什么？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText(/云端回答：这篇论文的预训练目标是什么？/)).toBeInTheDocument();
  expect(screen.getByText(/demo-2 · 第 8 页/)).toBeInTheDocument();
  expect(screen.getByText(/masked language model/)).toBeInTheDocument();
});

test("routes qa generation through the cloud-governed model gateway by default", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      importedChunksByPaperId={{
        "demo-2": [
          {
            page: 8,
            paperId: "demo-2",
            paperTitle: "BERT: Pre-training of Deep Bidirectional Transformers",
            snippet: "masked language model and next sentence prediction are used for pre-training",
            summary: "预训练目标主要包括掩码语言模型和下一句预测。",
            tags: ["预训练目标", "掩码语言模型"]
          }
        ]
      }}
      onGenerateArtifact={() => "unused"}
      selectedPapers={[
        {
          id: "demo-2",
          title: "BERT: Pre-training of Deep Bidirectional Transformers"
        }
      ]}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 1,
        selectionLocked: true
      }}
    />
  );

  await user.click(screen.getByRole("button", { name: "问答" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文的预训练目标是什么？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText(/云端回答：这篇论文的预训练目标是什么？/)).toBeInTheDocument();
  expect(screen.getByText("模型链路：云代理 -> 桌面内置 Mock")).toBeInTheDocument();
});

test("shows a readable assistant error when the model backend is unavailable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network down");
    })
  );

  const user = userEvent.setup();
  const settingsStore = createSettingsStore();
  settingsStore.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      selectedPapers={[
        {
          id: "demo-2",
          title: "BERT: Pre-training of Deep Bidirectional Transformers"
        }
      ]}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 1,
        selectionLocked: true
      }}
      settingsStore={settingsStore}
    />
  );

  await user.click(screen.getByRole("button", { name: "问答" }));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文的预训练目标是什么？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.getByText(/模型服务暂时不可用/)).toBeInTheDocument();
  });
});
