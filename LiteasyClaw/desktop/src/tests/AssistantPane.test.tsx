import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { AssistantPane } from "../app/features/assistant/AssistantPane";
import { createSettingsStore } from "../app/features/settings/settings.store";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function selectInitialAssistantMode(user: ReturnType<typeof userEvent.setup>, mode: "名词解释" | "命令" | "问答") {
  const launcher = screen.getByLabelText("AI助手初始模式入口");
  await user.click(within(launcher).getByRole("button", { name: `${mode}模式` }));
}


test("shows the assistant avatar mode launcher before a conversation starts", async () => {
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

  const launcher = screen.getByLabelText("AI助手初始模式入口");
  expect(screen.queryByLabelText("对话模式切换")).not.toBeInTheDocument();
  expect(within(launcher).getByText("Liteasy 学术助手")).toBeInTheDocument();
  expect(within(launcher).getByRole("button", { name: "名词解释模式" })).toBeInTheDocument();
  expect(within(launcher).getByRole("button", { name: "命令模式" })).toBeInTheDocument();
  expect(within(launcher).getByRole("button", { name: "问答模式" })).toBeInTheDocument();

  await user.click(within(launcher).getByRole("button", { name: "问答模式" }));
  expect(screen.getByText("当前模式：问答")).toBeInTheDocument();

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "总结这篇论文的核心方法");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.queryByLabelText("AI助手初始模式入口")).not.toBeInTheDocument();
  });
  expect(screen.getByText(/云端回答：总结这篇论文的核心方法/)).toBeInTheDocument();
  expect(screen.getByLabelText("对话模式切换")).toBeInTheDocument();
});

test("keeps a placeholder voice-input seam in the assistant composer", async () => {
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

  await user.click(screen.getByRole("button", { name: "语音输入（预留）" }));

  expect(screen.getByText("语音输入接口已预留，当前版本请先使用文本输入。" )).toBeInTheDocument();
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveFocus();
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

  await selectInitialAssistantMode(user, "问答");
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文讲了什么？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("这篇论文讲了什么？")).toBeInTheDocument();
  expect(screen.queryByText(/请先将当前选中文献集导入 AI 流程/)).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveAttribute(
    "title",
    "请先将当前选中文献集导入 AI 流程，再进行问答或解释。"
  );
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

  await selectInitialAssistantMode(user, "问答");
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "总结这篇论文的核心方法");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("总结这篇论文的核心方法")).toBeInTheDocument();
  expect(screen.getByText(/云端回答：总结这篇论文的核心方法/)).toBeInTheDocument();
  expect(screen.getByText(/demo-1 p\.3/)).toBeInTheDocument();
  expect(screen.getByText("审计模型 gpt-5-mini-auditor")).toBeInTheDocument();
  expect(screen.getByText("审计评分 0.84 · 通过")).toBeInTheDocument();
});

test("archives the current assistant session when starting a new one", async () => {
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

  await user.click(screen.getByRole("button", { name: "新建会话" }));

  expect(screen.queryByText("关闭联网推荐")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "历史会话" }));

  expect(screen.getByText("历史会话")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "恢复会话：关闭联网推荐" })).toBeInTheDocument();
  expect(screen.getByText("2 条消息 · 命令")).toBeInTheDocument();
});

test("restores an archived assistant session from history", async () => {
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
  await user.click(screen.getByRole("button", { name: "新建会话" }));
  await user.click(screen.getByRole("button", { name: "历史会话" }));

  await user.click(screen.getByRole("button", { name: "恢复会话：关闭联网推荐" }));

  expect(screen.queryByLabelText("历史会话面板")).not.toBeInTheDocument();
  expect(screen.getByText("当前模式：命令")).toBeInTheDocument();
  expect(screen.getByText("关闭联网推荐")).toBeInTheDocument();
  expect(screen.getByText(/已更新 联网推荐：false/)).toBeInTheDocument();
});

test("executes natural language command aliases through safe actions", async () => {
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

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "别再联网推荐了");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("别再联网推荐了")).toBeInTheDocument();
  expect(screen.getByText(/已更新 联网推荐：false/)).toBeInTheDocument();
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

  await selectInitialAssistantMode(user, "问答");
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

  await selectInitialAssistantMode(user, "问答");
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文的预训练目标是什么？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText(/云端回答：这篇论文的预训练目标是什么？/)).toBeInTheDocument();
  expect(screen.getByText("模型链路：云端模型能力 -> 桌面内置 Mock")).toBeInTheDocument();
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

  await selectInitialAssistantMode(user, "问答");
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文的预训练目标是什么？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await waitFor(() => {
    expect(screen.getByText(/模型服务暂时不可用/)).toBeInTheDocument();
  });
});

test("shows current command examples including organization and recommendation actions", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      selectedSetStatus={{
        importedCount: 0,
        selectedCount: 0,
        selectionLocked: false
      }}
    />
  );

  await selectInitialAssistantMode(user, "命令");

  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveAttribute(
    "title",
    "命令模式可输入“打开组织共享文献库”“关闭联网推荐”“开启用户画像”等受控指令。"
  );
});
