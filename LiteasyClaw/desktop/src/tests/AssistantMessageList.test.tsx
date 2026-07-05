import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AssistantMessageList } from "../app/features/assistant/AssistantMessageList";
import type { AssistantMessage } from "../app/features/assistant/assistant.types";

describe("AssistantMessageList", () => {
  test("renders the initial launcher and forwards mode selection", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();

    render(<AssistantMessageList messages={[]} mode="command" onModeChange={onModeChange} />);

    expect(screen.getByLabelText("AI助手初始模式入口")).toBeInTheDocument();
    expect(screen.queryByText("受控操作")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "命令模式" })).toHaveAttribute("title", "受控操作");
    await user.click(screen.getByRole("button", { name: "问答模式" }));

    expect(onModeChange).toHaveBeenCalledWith("qa");
  });

  test("renders assistant message citations, audit, and execution trace", () => {
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

    render(<AssistantMessageList messages={messages} mode="qa" onModeChange={vi.fn()} />);

    expect(screen.getByText("助手回复")).toBeInTheDocument();
    expect(screen.getByText("回答内容")).toBeInTheDocument();
    expect(screen.getByText("paper-1 · 第 3 页")).toBeInTheDocument();
    expect(screen.getByText("可信度 0.87")).toBeInTheDocument();
    expect(screen.getByText("审计评分 0.91 · 通过")).toBeInTheDocument();
    expect(screen.getByText(/模型链路：/)).toBeInTheDocument();
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
