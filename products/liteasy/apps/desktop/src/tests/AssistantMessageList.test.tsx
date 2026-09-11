import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AssistantMessageList } from "../app/features/assistant/AssistantMessageList";
import type { AssistantMessage } from "../app/features/assistant/assistant.types";

describe("AssistantMessageList", () => {
  test("renders an empty initial message region without persistent mode copy", async () => {
    const onModeChange = vi.fn();

    render(<AssistantMessageList messages={[]} mode="command" onModeChange={onModeChange} />);

    expect(screen.getByLabelText("AI助手初始消息区")).toBeInTheDocument();
    expect(screen.queryByText("受控操作")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "命令模式" })).not.toBeInTheDocument();
    expect(onModeChange).not.toHaveBeenCalled();
  });

  test("renders readable citations without internal IDs and opens their source", async () => {
    const user = userEvent.setup();
    const onOpenCitation = vi.fn();
    const messages: AssistantMessage[] = [
      {
        audit: {
          model: "gpt-audit",
          rationale: "引用充分",
          score: 0.91,
          verdict: "pass"
        },
        citations: [{ page: 3, paperId: "paper-1", snippet: "attention mechanism" }],
        confidence: 0.87,
        content: "回答内容",
        executionTrace: {
          accessMode: "cloud_proxy",
          auditModel: "gpt-audit",
          generationModel: "gpt-main",
          gateway: "cloud_proxy"
        },
        id: "assistant-1",
        role: "assistant"
      }
    ];

    render(<AssistantMessageList messages={messages} mode="qa" onModeChange={vi.fn()} papers={[{ id: "paper-1", title: "Attention Paper" }]} onOpenCitation={onOpenCitation} />);

    expect(screen.getByText("回答内容")).toBeInTheDocument();
    await user.click(screen.getByText("查看引用原文"));
    await user.click(screen.getByRole("button", { name: "Attention Paper · 第 3 页" }));
    expect(onOpenCitation).toHaveBeenCalledWith(messages[0].citations![0]);
    expect(screen.queryByText(/paper-1/)).not.toBeInTheDocument();
    expect(screen.getByText("审计评分 0.91 · 通过")).toBeInTheDocument();
    expect(screen.getByText(/模型链路：/)).toBeInTheDocument();
  });

  test("uses compact unlabelled conversation rows and keeps message actions outside their content", () => {
    const messages: AssistantMessage[] = [
      { content: "这是我的问题", id: "user-message", role: "user" },
      { content: "这是直接排版的回复", id: "assistant-message", role: "assistant" }
    ];

    const { container } = render(
      <AssistantMessageList messages={messages} mode="qa" onModeChange={vi.fn()} />
    );

    expect(screen.getByLabelText("你的消息")).toHaveClass("assistant-message-wrap", "user");
    expect(screen.getByLabelText("AI 回复")).toHaveClass("assistant-message-wrap", "assistant");
    expect(screen.queryByText("你")).not.toBeInTheDocument();
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
    expect(container.querySelector(".assistant-message-actions")?.parentElement)
      .toHaveClass("assistant-message-wrap");
  });

  test("offers copy, favorite and regenerate actions for an assistant reply", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    const onRegenerateMessage = vi.fn();
    const onToggleFavoriteMessage = vi.fn();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    render(
      <AssistantMessageList
        messages={[{
          content: "可复制的回答",
          id: "assistant-actions",
          role: "assistant"
        }]}
        mode="qa"
        onModeChange={vi.fn()}
        onRegenerateMessage={onRegenerateMessage}
        onToggleFavoriteMessage={onToggleFavoriteMessage}
      />
    );

    await user.click(screen.getByRole("button", { name: "复制回复" }));
    await user.click(screen.getByRole("button", { name: "收藏回复" }));
    await user.click(screen.getByRole("button", { name: "重新生成回复" }));

    expect(writeText).toHaveBeenCalledWith("可复制的回答");
    expect(onToggleFavoriteMessage).toHaveBeenCalledWith("assistant-actions");
    expect(onRegenerateMessage).toHaveBeenCalledWith("assistant-actions");
  });

  test("folds a long user message to five lines and lets the user expand it", async () => {
    const user = userEvent.setup();
    render(
      <AssistantMessageList
        messages={[{
          content: "第一行\n第二行\n第三行\n第四行\n第五行\n第六行",
          id: "long-user-message",
          role: "user"
        }]}
        mode="qa"
        onModeChange={vi.fn()}
      />
    );

    const content = screen.getByText(/第一行/);
    expect(content).toHaveClass("collapsed");
    const toggle = screen.getByRole("button", { name: "展开完整消息" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(content).not.toHaveClass("collapsed");
    expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute("aria-expanded", "true");
  });

  test("offers delivery controls for a message queued behind an active run", async () => {
    const user = userEvent.setup();
    const onInterrupt = vi.fn();
    const onWait = vi.fn();
    const onWithdraw = vi.fn();
    render(
      <AssistantMessageList
        messages={[{
          content: "补充检查第三个实验",
          id: "queued-user-message",
          queuedDelivery: { policy: "after_tool" },
          role: "user"
        }]}
        mode="qa"
        onInterruptForQueuedMessage={onInterrupt}
        onModeChange={vi.fn()}
        onWaitForRunForQueuedMessage={onWait}
        onWithdrawQueuedMessage={onWithdraw}
      />
    );

    expect(screen.getByText("已暂存 · 当前工具调用结束后生效")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "撤回" }));
    await user.click(screen.getByRole("button", { name: "立即中断并执行" }));
    await user.click(screen.getByRole("button", { name: "本轮完成后执行" }));
    expect(onWithdraw).toHaveBeenCalledWith("queued-user-message");
    expect(onInterrupt).toHaveBeenCalledWith("queued-user-message");
    expect(onWait).toHaveBeenCalledWith("queued-user-message");
  });

  test("renders user-safe public workflow audit summaries without internal identifiers", () => {
    const messages: AssistantMessage[] = [
      {
        content: "思维导图已生成",
        id: "assistant-public-audit",
        publicWorkflowAudits: [
          {
            auditLevel: "brief",
            checks: [
              { label: "任务范围", status: "passed" },
              { label: "证据与来源", status: "blocked" },
              {
                label: "自动修复",
                status: "blocked",
                summary: "已尝试自动修复，但仍需人工复核。"
              }
            ],
            disclosure: "public",
            issueLabels: ["选中文献证据覆盖不足"],
            status: "blocked"
          }
        ],
        role: "assistant"
      }
    ];

    render(<AssistantMessageList messages={messages} mode="qa" onModeChange={vi.fn()} />);

    expect(screen.getByText("公开审计过程")).toBeInTheDocument();
    expect(screen.getByText("选中文献证据覆盖不足")).toBeInTheDocument();
    expect(screen.getByText("证据与来源：需复核")).toBeInTheDocument();
    expect(screen.getByText("已尝试自动修复，但仍需人工复核。")).toBeInTheDocument();
    expect(screen.queryByText(/trace-|run-|session-|stepId/)).not.toBeInTheDocument();
  });

  test("keeps Agent work details collapsible while exposing streamed content, tool calls, and output", async () => {
    const user = userEvent.setup();
    const messages: AssistantMessage[] = [
      {
        agentActivity: {
          connectionText: "连接已结束 · 已收到完整结果",
          entries: [
            {
              content: "调用参数已隐藏。",
              id: "tool-1",
              kind: "tool",
              label: "工具调用：artifact.generate",
              status: "completed"
            },
            {
              content: "已创建可查看的产物。",
              id: "output-1",
              kind: "output",
              label: "产物已请求",
              status: "completed"
            }
          ],
          generatedContent: "正在组织可追溯的分析结论。",
          status: "completed",
          statusText: "Agent 已完成本次工作"
        },
        content: "正在组织可追溯的分析结论。",
        id: "assistant-activity",
        role: "assistant"
      }
    ];

    render(<AssistantMessageList messages={messages} mode="qa" onModeChange={vi.fn()} />);

    expect(screen.getByLabelText("Agent 工作状态")).toBeInTheDocument();
    expect(screen.getByText("正在组织可追溯的分析结论。")).toBeInTheDocument();
    expect(screen.getByText("工具调用：artifact.generate")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "输出 产物已请求" }));
    expect(screen.getByText("已创建可查看的产物。")).toBeInTheDocument();
  });

  test("does not display structured Agent metadata as realtime content", () => {
    const messages: AssistantMessage[] = [
      {
        agentActivity: {
          connectionText: "连接已结束 · 已收到完整结果",
          entries: [
            {
              content: '{"internalToolArguments":{"paperId":"secret-paper"}}',
              id: "tool-result",
              kind: "tool",
              label: "工具调用：检索论文",
              status: "completed"
            }
          ],
          generatedContent: '{"runId":"internal-run","step":"retrieve"}',
          status: "completed",
          statusText: "已完成检索"
        },
        content: "",
        id: "assistant-safe-activity",
        role: "assistant"
      }
    ];

    render(<AssistantMessageList messages={messages} mode="qa" onModeChange={vi.fn()} />);

    expect(screen.getByText("工具调用：检索论文")).toBeInTheDocument();
    expect(screen.queryByText(/internal-run|internalToolArguments|secret-paper/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "工具 工具调用：检索论文" }))
      .not.toHaveAttribute("aria-expanded");
  });

  test("forwards dynamic action refs with their DSL trace id", async () => {
    const user = userEvent.setup();
    const onDynamicAction = vi.fn();
    const messages: AssistantMessage[] = [
      {
        content: "",
        id: "assistant-ui",
        role: "assistant",
        uiDsl: {
          actions: [
            {
              actionId: "theme.reset",
              id: "reset-theme",
              input: {},
              label: "恢复默认",
              riskLevel: "low"
            }
          ],
          audit: {
            createdAt: "2026-07-05T00:00:00.000Z",
            generatedBy: "rule",
            traceId: "trace-message-ui"
          },
          dataSources: [],
          id: "ui-message",
          intentPlanId: "plan-message",
          root: {
            component: "ActionBar",
            id: "actions",
            props: {
              actionIds: ["reset-theme"]
            }
          },
          surface: "assistant",
          version: "liteasy-ui-dsl/v1"
        }
      }
    ];

    render(
      <AssistantMessageList
        messages={messages}
        mode="command"
        onDynamicAction={onDynamicAction}
        onModeChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "恢复默认" }));

    expect(onDynamicAction).toHaveBeenCalledWith(messages[0].uiDsl?.actions[0], "trace-message-ui");
  });
});
