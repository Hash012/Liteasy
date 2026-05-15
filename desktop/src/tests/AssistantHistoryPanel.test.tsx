import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { AssistantHistoryPanel } from "../app/features/assistant/AssistantHistoryPanel";
import type { AssistantSessionHistoryItem } from "../app/features/assistant/assistantSessionHistory";

describe("AssistantHistoryPanel", () => {
  test("shows an empty history hint", () => {
    render(<AssistantHistoryPanel history={[]} onRestoreSession={vi.fn()} />);

    expect(screen.getByLabelText("历史会话面板")).toBeInTheDocument();
    expect(screen.getByText("暂无历史会话。新建会话后，当前对话会进入这里。")).toBeInTheDocument();
  });

  test("restores a selected archived session", async () => {
    const user = userEvent.setup();
    const onRestoreSession = vi.fn();
    const history: AssistantSessionHistoryItem[] = [
      {
        archivedAt: "2026-05-15T00:00:00.000Z",
        id: "session-1",
        messages: [{ content: "你好", id: "message-1", role: "user" }],
        mode: "qa",
        title: "你好"
      }
    ];

    render(<AssistantHistoryPanel history={history} onRestoreSession={onRestoreSession} />);

    expect(screen.getByText("1 条消息 · 问答")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "恢复会话：你好" }));

    expect(onRestoreSession).toHaveBeenCalledWith("session-1");
  });
});
