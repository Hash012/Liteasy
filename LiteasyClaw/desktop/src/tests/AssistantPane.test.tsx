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


test("shows compact mode chips above the composer before a conversation starts", async () => {
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
  expect(within(launcher).queryByText("Liteasy 学术助手")).not.toBeInTheDocument();
  expect(within(launcher).queryByText("研")).not.toBeInTheDocument();
  expect(screen.getByLabelText("输入前模式选择")).toContainElement(
    within(launcher).getByRole("button", { name: "名词解释模式" })
  );
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
  expect(screen.getByText("请先将当前选中文献集导入 AI 流程，再进行问答或解释。")).toBeInTheDocument();
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
  expect(screen.getByText(/demo-1 p\.2/)).toBeInTheDocument();
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

  await user.click(screen.getByRole("button", { name: "新建" }));

  expect(screen.queryByText("关闭联网推荐")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "历史" }));

  expect(screen.getByText("历史会话")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "恢复会话：关闭联网推荐" })).toBeInTheDocument();
  expect(screen.getByText("4 条消息 · 命令")).toBeInTheDocument();
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
  await user.click(screen.getByRole("button", { name: "新建" }));
  await user.click(screen.getByRole("button", { name: "历史" }));

  await user.click(screen.getByRole("button", { name: "恢复会话：关闭联网推荐" }));

  expect(screen.queryByLabelText("历史会话面板")).not.toBeInTheDocument();
  expect(screen.getByText("当前模式：命令")).toBeInTheDocument();
  expect(screen.getByText("关闭联网推荐")).toBeInTheDocument();
  expect(screen.getByText(/已更新 联网推荐：false/)).toBeInTheDocument();
});

test("starts a separate session when switching modes during a conversation", async () => {
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

  await user.click(within(screen.getByLabelText("对话模式切换")).getByRole("button", { name: "问答" }));

  expect(screen.queryByText("关闭联网推荐")).not.toBeInTheDocument();
  expect(screen.getByLabelText("AI助手初始模式入口")).toBeInTheDocument();
  expect(within(screen.getByLabelText("AI助手初始模式入口")).getByRole("button", { name: "问答模式" })).toHaveClass(
    "active"
  );

  await user.click(screen.getByRole("button", { name: "历史" }));

  expect(screen.getByRole("button", { name: "恢复会话：关闭联网推荐" })).toBeInTheDocument();
  expect(screen.getByText("4 条消息 · 命令")).toBeInTheDocument();
});

test("separates session actions from in-conversation mode switching controls", async () => {
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

  const sessionActions = screen.getByLabelText("会话操作");
  const modeControls = screen.getByLabelText("对话模式切换");

  expect(within(sessionActions).getByRole("button", { name: "新建" })).toBeInTheDocument();
  expect(within(sessionActions).getByRole("button", { name: "历史" })).toBeInTheDocument();
  expect(within(sessionActions).queryByRole("button", { name: "命令" })).not.toBeInTheDocument();
  expect(within(modeControls).getByRole("button", { name: "命令" })).toBeInTheDocument();
  expect(within(modeControls).queryByRole("button", { name: "新建" })).not.toBeInTheDocument();
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
          title: "Survey of Vector Database Management Systems"
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
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇综述如何定义向量数据库系统？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText(/云端回答：这篇综述如何定义向量数据库系统？/)).toBeInTheDocument();
  expect(screen.getByText(/demo-2 · 第 4 页/)).toBeInTheDocument();
  expect(screen.getByText(/vector database management systems/)).toBeInTheDocument();
});

test("routes qa generation through the cloud-governed model gateway by default", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      importedChunksByPaperId={{
        "demo-2": [
          {
            page: 4,
            paperId: "demo-2",
            paperTitle: "Survey of Vector Database Management Systems",
            snippet: "vector database management systems manage unstructured data embeddings with indexes and query processing",
            summary: "向量数据库管理系统围绕向量表示、索引和查询处理组织能力。",
            tags: ["向量数据库管理系统", "索引", "查询处理"]
          }
        ]
      }}
      onGenerateArtifact={() => "unused"}
      selectedPapers={[
        {
          id: "demo-2",
          title: "Survey of Vector Database Management Systems"
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
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇综述如何定义向量数据库系统？");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText(/云端回答：这篇综述如何定义向量数据库系统？/)).toBeInTheDocument();
  expect(screen.getByText("模型链路：云端模型能力 -> 桌面内置 Mock")).toBeInTheDocument();
});

test("lets users edit a previous prompt and replaces the following answer", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      selectedPapers={[
        {
          id: "demo-1",
          title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
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
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "总结这篇论文的核心方法");
  await user.click(screen.getByRole("button", { name: "发送" }));

  await user.click(screen.getByRole("button", { name: "重新编辑：总结这篇论文的核心方法" }));

  expect(screen.getByPlaceholderText("输入你的问题或命令")).toHaveValue("总结这篇论文的核心方法");

  await user.clear(screen.getByPlaceholderText("输入你的问题或命令"));
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇论文的实验结论是什么？");
  await user.click(screen.getByRole("button", { name: "更新并发送" }));

  expect(screen.queryByText("总结这篇论文的核心方法")).not.toBeInTheDocument();
  expect(screen.queryByText(/云端回答：总结这篇论文的核心方法/)).not.toBeInTheDocument();
  expect(screen.getByText("这篇论文的实验结论是什么？")).toBeInTheDocument();
  expect(screen.getByText(/云端回答：这篇论文的实验结论是什么？/)).toBeInTheDocument();
});

test("regenerates the latest model answer from the previous user prompt", async () => {
  const user = userEvent.setup();
  const settingsStore = createSettingsStore();
  const answers = ["第一次模型回答", "第二次模型回答"];
  settingsStore.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  render(
    <AssistantPane
      modelTransport={async () => ({
        json: async () => ({
          answer: answers.shift() ?? "备用模型回答",
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      })}
      onGenerateArtifact={() => "unused"}
      selectedPapers={[
        {
          id: "demo-1",
          title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
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
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "总结这篇论文的核心方法");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(await screen.findByText(/第一次模型回答/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "重新生成回复" }));

  await waitFor(() => {
    expect(screen.queryByText(/第一次模型回答/)).not.toBeInTheDocument();
  });
  expect(await screen.findByText(/第二次模型回答/)).toBeInTheDocument();
});

test("does not submit duplicate prompts while a model answer is pending", async () => {
  const user = userEvent.setup();
  const settingsStore = createSettingsStore();
  let resolveAnswer: ((value: {
    answer: string;
    execution: {
      backend: "dev_cloud";
      mode: "live";
      provider: "openai";
    };
  }) => void) | undefined;
  const modelTransport = vi.fn(
    async () =>
      ({
        json: async () =>
          new Promise((resolve) => {
            resolveAnswer = resolve;
          }),
        ok: true,
        status: 200
      }) as const
  );
  settingsStore.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });

  render(
    <AssistantPane
      modelTransport={modelTransport}
      onGenerateArtifact={() => "unused"}
      selectedPapers={[
        {
          id: "demo-1",
          title: "ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction over BERT"
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
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "总结这篇论文的核心方法");
  await user.click(screen.getByRole("button", { name: "发送" }));
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(modelTransport).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText("你的输入")).toHaveLength(1);

  resolveAnswer?.({
    answer: "模型回答",
    execution: {
      backend: "dev_cloud",
      mode: "live",
      provider: "openai"
    }
  });

  expect(await screen.findByText(/模型回答/)).toBeInTheDocument();
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
          title: "Survey of Vector Database Management Systems"
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
  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "这篇综述如何定义向量数据库系统？");
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

test("routes command mode through runtime confirmation before profile sampling changes", async () => {
  const user = userEvent.setup();
  const settingsStore = createSettingsStore();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      profileUnlocked={true}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 1,
        selectionLocked: true
      }}
      settingsStore={settingsStore}
    />
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "开启用户画像");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("开启用户画像")).toBeInTheDocument();
  expect(screen.getByText("用户画像会影响个性化采样与后续回答策略，请确认后再开启。")).toBeInTheDocument();
  expect(settingsStore.getState()["profile.enabled"]).toBe(false);
});

test("renders the expandable runtime context panel inside the assistant", async () => {
  const user = userEvent.setup();

  render(
    <AssistantPane
      onGenerateArtifact={() => "unused"}
      profileUnlocked={true}
      runtimeOrganizationName="Liteasy AI Reading Lab"
      runtimeWorkspace={{
        rootPath: "/tmp/LiteasyLibrary",
        type: "local_library"
      }}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 2,
        selectionLocked: true
      }}
    />
  );

  expect(
    screen.getByText("上下文 · 选中 2 篇 · 已锁定 · 已导入 1/2 · 云账号已连接 · 画像关闭")
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /运行时上下文/ }));

  expect(screen.getByText("Selection")).toBeInTheDocument();
  expect(screen.getByText("需导入")).toBeInTheDocument();
  expect(screen.getByText("本地文献库 · /tmp/LiteasyLibrary")).toBeInTheDocument();
  expect(screen.getByText("已连接 · Liteasy AI Reading Lab")).toBeInTheDocument();
});

test("uses runtime context readiness before starting a mind map from the assistant", async () => {
  const user = userEvent.setup();
  const onGenerateArtifact = vi.fn(() => "已开始思维导图分析。");

  render(
    <AssistantPane
      onGenerateArtifact={onGenerateArtifact}
      selectedSetStatus={{
        importedCount: 1,
        selectedCount: 2,
        selectionLocked: true
      }}
    />
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "生成思维导图");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("请先导入当前选中文献集，再生成思维导图。")).toBeInTheDocument();
  expect(onGenerateArtifact).not.toHaveBeenCalled();
});

test("shows semantic command plan previews in command mode", async () => {
  const user = userEvent.setup();
  const onApplyLayoutPreset = vi.fn(() => "已切换为双栏布局。");

  render(
    <AssistantPane
      onApplyLayoutPreset={onApplyLayoutPreset}
      onGenerateArtifact={() => "unused"}
      selectedSetStatus={{
        importedCount: 0,
        selectedCount: 0,
        selectionLocked: false
      }}
    />
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "把窗口切分成两个");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("计划：切换为双栏布局")).toBeInTheDocument();
  expect(screen.getByText("已切换为双栏布局。")).toBeInTheDocument();
  expect(onApplyLayoutPreset).toHaveBeenCalledWith({
    preset: "two_column"
  });
});

test("uses the model semantic planner for command mode when it returns valid JSON", async () => {
  const user = userEvent.setup();
  const settingsStore = createSettingsStore();
  settingsStore.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const onApplyThemePreset = vi.fn(() => "已应用卡通风格。");

  render(
    <AssistantPane
      modelTransport={async () => ({
        json: async () => ({
          answer: JSON.stringify({
            actions: [
              {
                actionId: "theme.apply_preset",
                input: {
                  preset: "playful",
                  tone: "cartoon"
                }
              }
            ],
            confidence: "high",
            intentId: "theme.apply",
            planId: "model-plan-theme",
            requiredContext: [],
            requiresConfirmation: false,
            riskLevel: "low",
            summary: "应用卡通风格"
          }),
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      })}
      onApplyThemePreset={onApplyThemePreset}
      onGenerateArtifact={() => "unused"}
      selectedSetStatus={{
        importedCount: 0,
        selectedCount: 0,
        selectionLocked: false
      }}
      settingsStore={settingsStore}
    />
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "让界面像儿童科普书");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("计划：应用卡通风格")).toBeInTheDocument();
  expect(screen.getByText("已应用卡通风格。")).toBeInTheDocument();
  expect(onApplyThemePreset).toHaveBeenCalledWith({
    preset: "playful",
    tone: "cartoon"
  });
});

test("falls back to the local semantic planner when model command planning fails", async () => {
  const user = userEvent.setup();
  const settingsStore = createSettingsStore();
  settingsStore.apply({
    intent: "update_setting",
    target: "models.cloud_proxy_endpoint",
    value: "https://liteasy.example.com/model-proxy"
  });
  const onApplyLayoutPreset = vi.fn(() => "已切换为双栏布局。");

  render(
    <AssistantPane
      modelTransport={async () => ({
        json: async () => ({
          answer: "bad-json",
          execution: {
            backend: "dev_cloud",
            mode: "live",
            provider: "openai"
          }
        }),
        ok: true,
        status: 200
      })}
      onApplyLayoutPreset={onApplyLayoutPreset}
      onGenerateArtifact={() => "unused"}
      selectedSetStatus={{
        importedCount: 0,
        selectedCount: 0,
        selectionLocked: false
      }}
      settingsStore={settingsStore}
    />
  );

  await user.type(screen.getByPlaceholderText("输入你的问题或命令"), "把窗口切分成两个");
  await user.click(screen.getByRole("button", { name: "发送" }));

  expect(screen.getByText("计划：切换为双栏布局")).toBeInTheDocument();
  expect(screen.getByText("已切换为双栏布局。")).toBeInTheDocument();
  expect(onApplyLayoutPreset).toHaveBeenCalledWith({
    preset: "two_column"
  });
});
